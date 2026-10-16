"""Measure Klippel's fit range ±xp in each extracted Klippel plot.

Klippel's large-signal identification draws each curve over -Xprot < x < Xprot, the largest displacement the
protection system allowed, and draws the part it fitted, the working range xp- < x < xp+ where the coil spends more
than 99 % of the time, in black (the plot legends say "Xp- < X < Xp+"). Klippel evaluates its displacement limits
only inside that range and reports a limit as "greater than" its shorter side when the threshold is not reached there
(https://docs.klippel.de/db-lab/latest/transducer-parameter-identification/lsi3/lsi3.html).

This script finds, in every plot, the columns where the curve is drawn black and converts their extent to mm with
the x-axis calibration the extraction already found (tick references from out/ and outc/extracted.json). The rest
position line and the dashed line beside it are skipped. Each driver's range is the median over its three plots,
because one plot can hide part of the black segment under another line.

    cd research/lsi/images        # after python3 ../fetch_sources.py
    python3 ../xp_extract.py . ../out/extracted.json ../outc/extracted.json ../xp/fit_ranges.json

Needs numpy and Pillow.
"""
import json, os, statistics, sys
import numpy as np
from PIL import Image

BLACK = 70      # all three channels below this count as black
COLOUR = 80     # a channel difference above this counts as the curve colour
REST = 0.35     # mm either side of x = 0 skipped (the thick rest-position line and the dashed line beside it)


def measure(img_dir, rec):
    a = np.asarray(Image.open(os.path.join(img_dir, rec['file'])).convert('RGB')).astype(int)
    px = np.array([p for p, _ in rec['x_axis']['refs']], float)
    mm = np.array([m for _, m in rec['x_axis']['refs']], float)
    k, c = np.polyfit(px, mm, 1)  # mm = k·px + c, from the extraction's own tick references (whole-image pixels)
    lo, hi = json.loads(rec['range']) if isinstance(rec['range'], str) else rec['range']
    xa, xb = int(np.floor((lo - 0.05 - c) / k)), int(np.ceil((hi + 0.05 - c) / k))
    ys = [y for y, _ in rec['y_axis']['refs']]
    ya, yb = int(min(ys)) - 8, int(max(ys)) + 1
    if rec.get('crop'):
        cx0, cy0, cx1, cy1 = rec['crop']
        xa, xb, ya, yb = max(xa, cx0), min(xb, cx1), max(ya, cy0), min(yb, cy1)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    black = (R < BLACK) & (G < BLACK) & (B < BLACK)
    cols = [x for x in range(xa, xb + 1) if abs(k * x + c) >= REST and black[ya:yb, x].sum() >= 2]
    if not cols:
        return None
    left = [x for x in cols if k * x + c < 0]
    right = [x for x in cols if k * x + c > 0]
    return {'black_mm': [round(float(k * min(left) + c), 2) if left else None, round(float(k * max(right) + c), 2) if right else None],
            'plotted_mm': [round(lo, 2), round(hi, 2)]}


def main():
    img_dir, *inputs, dst = sys.argv[1:]
    recs = {}
    for path in inputs:
        for r in json.load(open(path)):
            recs[r['name']] = r
    plots, drivers = {}, {}
    for name in sorted(recs):
        m = measure(img_dir, recs[name])
        plots[name] = m
        key = name.rsplit('_', 1)[0]
        drivers.setdefault(key, []).append(m)
    out = {'method': __doc__.strip().split('\n\n')[0] + ' Median of the three plots per driver.', 'plots': plots, 'drivers': {}}
    for key, ms in sorted(drivers.items()):
        neg = [m['black_mm'][0] for m in ms if m and m['black_mm'][0] is not None]
        pos = [m['black_mm'][1] for m in ms if m and m['black_mm'][1] is not None]
        if neg and pos:
            out['drivers'][key] = {'xp_mm': [round(statistics.median(neg), 2), round(statistics.median(pos), 2)], 'plots_used': [len(neg), len(pos)]}
            print(key, out['drivers'][key])
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    json.dump(out, open(dst, 'w'), indent=1)


if __name__ == '__main__':
    main()
