"""Pixel extraction of harmonic-distortion curves (log frequency x axis, dB y axis) from Klippel-style
HD plots published by Erin's Audio Corner. Same calibration discipline as lsi_extract.py: OCR tick labels
under/next to each detected gridline, robust least-squares axis fit, every labelled tick a check tick,
max residual < 1 px; exact-colour masks; per-column centroid; raw points + calibration metadata + overlay."""
import json, re, sys, os, math
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(__file__))
from lsi_extract import load, runs, gridlines, fit_axis, tesseract

COL = {
    'H2': lambda r, g, b: (b > 200) & (r < 60) & (g < 60),
    'H3': lambda r, g, b: (np.abs(r - 128) < 40) & (g < 50) & (np.abs(b - 128) < 40) & (np.abs(r - b) < 30),
    'THD': lambda r, g, b: (r > 200) & (g < 60) & (b < 60),
}

def parse_num(t):
    t = t.replace(' ', '')
    m = re.fullmatch(r'(-?\d+(?:\.\d+)?)(k?)', t)
    if not m: return None
    return float(m.group(1)) * (1000 if m.group(2) else 1)

def ocr_votes(im, box, allowed):
    votes = {}
    for scale, thr, psm in ((4, 150, 7), (5, 170, 7), (3, 140, 7), (6, 160, 8), (4, 190, 7)):
        crop = im.crop(box).convert('L')
        crop = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS).point(lambda v, t=thr: 0 if v < t else 255)
        pad = Image.new('L', (crop.width + 60, crop.height + 60), 255); pad.paste(crop, (30, 30))
        t = tesseract(pad, '--psm', str(psm), '-c', 'tessedit_char_whitelist=-0123456789.k').strip()
        v = parse_num(t)
        if v is not None and any(abs(v - a) < 1e-9 for a in allowed): votes[v] = votes.get(v, 0) + 1
    return max(votes.items(), key=lambda kv: kv[1])[0] if votes else None

def robust(ps, tf=lambda v: v):
    best = []
    for i in range(len(ps)):
        for j in range(i + 1, len(ps)):
            (p1, v1), (p2, v2) = ps[i], ps[j]
            if p1 == p2 or v1 == v2: continue
            m = (tf(v2) - tf(v1)) / (p2 - p1)
            inl = [(p, v) for p, v in ps if abs((tf(v) - tf(v1)) / m + p1 - p) < 1.0]
            if len(inl) > len(best): best = inl
    return sorted(best, key=lambda q: q[1])

def extract(cfg, outdir):
    im = load(cfg['file']); a = np.array(im).astype(int); H, W, _ = a.shape
    frac = cfg.get('grid_frac', 0.2)  # the 2020 charts draw dotted minor gridlines; a higher threshold keeps only the major ones
    vl, _ = gridlines(a, 'v', frac); hl, _ = gridlines(a, 'h', frac)
    left = cfg.get('left', min(vl))  # pixel column of the plot's left edge, where the y labels end
    yt = cfg['yticks']; xt = cfg['xticks']
    yl = []
    for gy in hl:
        v = ocr_votes(im, (max(0, int(left) - 90), int(gy) - 16, int(left) - 4, int(gy) + 16), yt)
        if v is not None: yl.append((gy, v))
    ypairs = robust(yl)
    assert len(ypairs) >= 3, f'y pairs {ypairs}'
    my, cy, ry, _ = fit_axis(ypairs)
    bottom = (min(yt) - cy) / my; top = (max(yt) - cy) / my
    xl = []
    for gx in vl:
        v = ocr_votes(im, (int(gx) - 40, int(bottom) + 6, int(gx) + 40, int(bottom) + 48), xt)
        if v is not None: xl.append((gx, v))
    xpairs = robust(xl, math.log10)
    assert len(xpairs) >= 3, f'x pairs {xpairs} from {xl}'
    lp = [(p, math.log10(v)) for p, v in xpairs]
    mx, cxo, rx, _ = fit_axis(lp)
    assert rx < 1.0 and ry < 1.0, f'residual x {rx} y {ry}'
    F = lambda px: 10 ** (mx * px + cxo); Y = lambda py: my * py + cy
    xleft = (math.log10(min(xt)) - cxo) / mx; xright = (math.log10(max(xt)) - cxo) / mx
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    out = {'name': cfg['name'], 'file': cfg['file'], 'x_axis': {'log': True, 'refs': [[round(p, 2), v] for p, v in xpairs], 'max_resid_px': round(rx, 3)},
           'y_axis': {'refs': [[round(p, 2), v] for p, v in ypairs], 'max_resid_px': round(ry, 3)}, 'series': {}}
    ov = im.copy(); d = ImageDraw.Draw(ov)
    for name in cfg['series']:
        m = COL[name](r, g, b)
        inner = np.zeros_like(m); inner[int(top) + 1:int(bottom), int(xleft) + 1:int(xright)] = True; m &= inner
        pts = []
        for c in range(int(xleft) + 1, int(xright)):
            rows = np.nonzero(m[:, c])[0]
            if rows.size == 0: continue
            rr = runs(list(rows))
            if len(rr) > 1:  # keep the run nearest the previous point
                prev = pts[-1][1] if pts else None
                q = min(rr, key=lambda q: abs(np.mean(q) - prev)) if prev is not None else max(rr, key=len)
            else: q = rr[0]
            pts.append((c, float(np.mean(q))))
        for c, yv in pts: d.point((c, yv), fill=(0, 0, 0) if name != 'H3' else (0, 160, 0))
        # resample to 1/24 octave
        fs = np.array([F(c) for c, _ in pts]); vs = np.array([Y(yv) for _, yv in pts])
        grid = [f for f in 20 * 2 ** (np.arange(0, 240) / 24) if fs.min() <= f <= fs.max()]
        out['series'][name] = [[round(float(f), 1), round(float(np.interp(math.log10(f), np.log10(fs), vs)), 2)] for f in grid]
    for p, v in xpairs: d.line([(p, bottom - 8), (p, bottom + 8)], fill=(0, 200, 0), width=3)
    for p, v in ypairs: d.line([(left - 8, p), (left + 8, p)], fill=(0, 200, 0), width=3)
    ovp = os.path.join(outdir, cfg['name'] + '_overlay.png'); ov.save(ovp); out['overlay'] = ovp
    return out

if __name__ == '__main__':
    cfgs = json.load(open(sys.argv[1])); outdir = sys.argv[2]; os.makedirs(outdir, exist_ok=True)
    res = []
    for cfg in cfgs:
        try:
            o = extract(cfg, outdir); res.append(o)
            s = o['series']
            print(cfg['name'], 'x ticks', len(o['x_axis']['refs']), 'resid', o['x_axis']['max_resid_px'], '| y ticks', len(o['y_axis']['refs']), 'resid', o['y_axis']['max_resid_px'], '|', {k: (len(v), v[0][0], v[-1][0]) for k, v in s.items()})
        except Exception as e:
            print(cfg['name'], 'FAIL', e)
    json.dump(res, open(os.path.join(outdir, 'hd_extracted.json'), 'w'), indent=1)
