"""Pixel extraction of Klippel LSI curves (Bl(x), Kms(x), Le(x)) from dB-Lab plot exports.

Adapted from David's pixel-extraction reference pipeline (extract_plot.py): flatten RGBA first,
crop to the plot, calibrate both axes from OCR-read tick labels paired with detected gridlines
(least squares, every labelled tick is a check tick; max residual must stay below 1 px), mask the
curve by its exact colour, trace per column with continuity tracking, then write raw points plus
calibration metadata and a debug overlay for visual verification.
"""
import json, math, subprocess, sys, os, re
import numpy as np
from PIL import Image, ImageDraw

GRID = (204, 204, 204)

def load(path):
    im = Image.open(path)
    if im.mode == 'RGBA':
        bg = Image.new('RGB', im.size, (255, 255, 255)); bg.paste(im, mask=im.split()[3]); im = bg
    return im.convert('RGB')

def runs(idx):
    out = []
    for v in idx:
        if out and v - out[-1][-1] <= 1: out[-1].append(v)
        else: out.append([v])
    return out

def gridlines(a, axis, frac=0.2):
    r, gg, b = a[..., 0], a[..., 1], a[..., 2]
    g = (np.abs(r - gg) < 3) & (np.abs(gg - b) < 3) & (r >= 200) & (r <= 230)
    prof = g.mean(axis=0) if axis == 'v' else g.mean(axis=1)
    idx = np.nonzero(prof > frac)[0]
    return [float(np.mean(r)) for r in runs(list(idx))], prof

def ocr_numbers(img, psm=11):
    tmp = '/tmp/_ocr.png'
    big = img.resize((img.width * 3, img.height * 3), Image.LANCZOS)
    big.save(tmp)
    out = subprocess.run(['tesseract', tmp, 'stdout', '--psm', str(psm), '-c', 'tessedit_char_whitelist=-0123456789.', 'tsv'], capture_output=True, text=True).stdout
    res = []
    for line in out.splitlines()[1:]:
        p = line.split('\t')
        if len(p) < 12 or not p[11].strip(): continue
        t = p[11].strip()
        if not re.fullmatch(r'-?\d+(\.\d+)?', t): continue
        l, tp, w, h = (int(p[6]) / 3, int(p[7]) / 3, int(p[8]) / 3, int(p[9]) / 3)
        res.append({'v': float(t), 'cx': l + w / 2, 'cy': tp + h / 2, 'conf': float(p[10])})
    return res

def fit_axis(pairs):
    px = np.array([p[0] for p in pairs]); val = np.array([p[1] for p in pairs])
    A = np.vstack([px, np.ones_like(px)]).T
    (m, c), *_ = np.linalg.lstsq(A, val, rcond=None)
    resid_px = np.abs((val - c) / m - px)
    return m, c, float(resid_px.max()), resid_px.tolist()

def extract(cfg, outdir):
    im = load(cfg['file'])
    if cfg.get('crop'):
        x0, y0, x1, y1 = cfg['crop']; im = im.crop((x0, y0, x1, y1))
    else:
        x0 = y0 = 0
    a = np.array(im).astype(int)
    H, W, _ = a.shape
    vl, _ = gridlines(a, 'v'); hl, _ = gridlines(a, 'h')
    # plot interior: between outermost gridlines (frame lines are also 204 grey)
    left, right = min(vl), max(vl); top, bottom = min(hl), max(hl)
    # --- OCR tick labels: one small crop per gridline, where its label must sit
    def ocr_one(box, allowed=None):
        # several preprocessing variants; the most frequent parse that is an allowed tick value wins
        votes = {}
        for scale, thr, psm in ((4, 150, 7), (5, 170, 7), (3, 140, 7), (6, 160, 8), (4, 190, 7)):
            crop = im.crop(box).convert('L')
            crop = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS).point(lambda v, t=thr: 0 if v < t else 255)
            pad = Image.new('L', (crop.width + 60, crop.height + 60), 255); pad.paste(crop, (30, 30))
            pad.save('/tmp/_ocr1.png')
            t = subprocess.run(['tesseract', '/tmp/_ocr1.png', 'stdout', '--psm', str(psm), '-c', 'tessedit_char_whitelist=-0123456789.'], capture_output=True, text=True).stdout.strip().replace(' ', '')
            if re.fullmatch(r'-?\d+(\.\d+)?', t):
                v = float(t)
                if allowed is None or any(abs(v - a) < 1e-9 for a in allowed): votes[v] = votes.get(v, 0) + 1
        if not votes: return None
        return max(votes.items(), key=lambda kv: kv[1])[0]
    def pair(labels, lines, key):
        # pair each OCR label with its nearest gridline, then keep the largest self-consistent set:
        # a label misread by OCR cannot fit the same linear mapping within 1 px (every tick is a check tick)
        ps = []
        for t in labels:
            cand = [g for g in lines if abs(g - t[key]) < 12]
            if cand: ps.append((min(cand, key=lambda g: abs(g - t[key])), t['v']))
        ps = list({(round(p, 2), v) for p, v in ps})
        best = []
        for i in range(len(ps)):
            for j in range(i + 1, len(ps)):
                (p1, v1), (p2, v2) = ps[i], ps[j]
                if p1 == p2 or v1 == v2: continue
                m = (v2 - v1) / (p2 - p1)
                inl = [(p, v) for p, v in ps if abs((v - v1) / m + p1 - p) < 1.0]
                if len(inl) > len(best): best = inl
        return sorted(best, key=lambda q: q[1])
    # y axis first (labels left of the leftmost frame line)
    yl, xl = [], []
    lw = cfg.get('ylab_w', 95)
    for gy in hl:
        v = ocr_one((max(0, int(left) - lw), int(gy) - 16, int(left) - 4, int(gy) + 16), cfg.get('yticks'))
        if v is not None: yl.append({'v': v, 'cx': left - 20, 'cy': gy})
    ypairs = pair(yl, hl, 'cy')
    if cfg.get('yticks'): ypairs = [q for q in ypairs if any(abs(q[1] - v) < 1e-9 for v in cfg['yticks'])]
    assert len(ypairs) >= 3, f"too few y calibration pairs {ypairs} (ocr {[(t['v'],round(t['cy'])) for t in yl]})"
    my_, cy_, _, _ = fit_axis(ypairs)
    if cfg.get('yticks'):
        ylow = (min(cfg['yticks']) - cy_) / my_; yhigh = (max(cfg['yticks']) - cy_) / my_
    else:
        ylow = max(p for p, v in ypairs); yhigh = min(p for p, v in ypairs)
    bottom = ylow
    above = [h for h in hl if h < yhigh - 3]
    top = max(above) if above else yhigh  # frame line above the highest labelled gridline
    # x axis labels sit just below the lowest labelled y gridline
    for gx in vl:
        v = ocr_one((int(gx) - 34, int(bottom) + 6, int(gx) + 34, int(bottom) + cfg.get('xlab_h', 46)), cfg.get('xticks'))
        if v is not None: xl.append({'v': v, 'cx': gx, 'cy': bottom + 20})
    xpairs = pair(xl, vl, 'cx')
    if cfg.get('xticks'): xpairs = [q for q in xpairs if any(abs(q[1] - v) < 1e-9 for v in cfg['xticks'])]
    xcal_method = 'ocr'
    if len(xpairs) < 3 and cfg.get('xticks'):
        # fallback: the labelled gridlines are the longest evenly spaced run of vertical lines; when that run has
        # exactly as many lines as there are tick labels (read visually from the image), assign them in order.
        xt = sorted(cfg['xticks']); step = xt[1] - xt[0]
        vs = sorted(vl); best = []
        for i in range(len(vs)):
            for j in range(i + 1, len(vs)):
                sp = vs[j] - vs[i]
                if sp < 15: continue
                run = [vs[i]]
                while True:
                    nxt = [v for v in vs if abs(v - (run[-1] + sp)) < 1.5]
                    if not nxt: break
                    run.append(nxt[0])
                if len(run) > len(best): best = run
        # a hidden gridline (cursor line at x = 0) breaks the run; rebuild by spacing from the detected lines
        if len(best) < len(xt):
            for i in range(len(vs)):
                for j in range(i + 1, len(vs)):
                    for k in (2, 3, 4):
                        sp = (vs[j] - vs[i]) / k
                        if sp < 15: continue
                        cand = [vs[i] + n * sp for n in range(len(xt))]
                        hits = sum(1 for c in cand if any(abs(c - v) < 1.5 for v in vs))
                        if hits >= len(xt) - 1 and hits > len([b for b in best]):
                            best = [min(vs, key=lambda v: abs(v - c)) if any(abs(c - v) < 1.5 for v in vs) else c for c in cand]
        if len(best) == len(xt):
            anchors = {v: p for p, v in xpairs}
            ok = all(abs(best[xt.index(v)] - p) < 1.5 for v, p in anchors.items() if v in xt)
            if ok:
                xpairs = [(best[n], xt[n]) for n in range(len(xt)) if any(abs(best[n] - v) < 1.5 for v in vs)]
                xcal_method = 'gridline order with visually read labels' + (' + ocr anchors' if anchors else '')
    assert len(xpairs) >= 3, f"too few x calibration pairs {xpairs} (ocr {[(t['v'],round(t['cx'])) for t in xl]})"
    xl_, xr_ = min(p for p, v in xpairs), max(p for p, v in xpairs)
    lefts = [v for v in vl if v < xl_ - 3]; rights = [v for v in vl if v > xr_ + 3]
    left = max(lefts) if lefts else xl_
    right = min(rights) if rights else xr_
    mx, cxo, rx, rxs = fit_axis(xpairs); my, cyo, ry, rys = fit_axis(ypairs)
    assert rx < 1.0 and ry < 1.0, f"calibration residual too large: x {rx:.2f}px y {ry:.2f}px"
    X = lambda px: mx * px + cxo; Y = lambda py: my * py + cyo
    # --- curve mask
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    col = cfg['color']
    if col == 'red': cm = (r > 200) & (g < 60) & (b < 60)
    elif col == 'blue': cm = (b > 200) & (r < 60) & (g < 60)
    elif col == 'green': cm = (g > 100) & (g < 160) & (r < 50) & (b < 50)
    else: raise ValueError(col)
    black = (r < 50) & (g < 50) & (b < 50)
    mask = cm | black
    inner = np.zeros_like(mask); inner[int(top) + 2:int(bottom) - 1, int(left) + 2:int(right) - 1] = True
    mask &= inner
    # blank user-specified exclusion boxes (legend or logo inside the plot, in crop coordinates)
    for bx in cfg.get('exclude', []):
        mask[bx[1]:bx[3], bx[0]:bx[2]] = False
    ph = bottom - top
    cols = {}
    for c in range(int(left) + 2, int(right) - 1):
        rr = runs(list(np.nonzero(mask[:, c])[0]))
        rr = [q for q in rr if len(q) < 0.25 * ph]  # drop vertical lines (cursor at x = 0, dashed marker)
        if rr: cols[c] = [(float(np.mean(q)), len(q)) for q in rr]
    # continuity tracking from a seed column with a single run near the middle
    keys = sorted(cols)
    mid = (left + right) / 2
    seeds = [c for c in keys if len(cols[c]) == 1 and abs(c - mid) < 0.3 * (right - left)]
    seed = min(seeds, key=lambda c: abs(c - mid))
    track = {seed: cols[seed][0][0]}
    for direction in (1, -1):
        prev = track[seed]; slope = 0.0; lastc = seed
        c = seed + direction
        while left < c < right:
            if c in cols:
                pred = prev + slope * (c - lastc)
                best = min(cols[c], key=lambda q: abs(q[0] - pred))
                if abs(best[0] - pred) < max(6, 3 * abs(c - lastc)):
                    newslope = (best[0] - prev) / (c - lastc)
                    slope = 0.7 * slope + 0.3 * newslope if abs(c - lastc) < 4 else newslope
                    prev = best[0]; lastc = c; track[c] = best[0]
            c += direction
    pts = sorted((X(c), Y(yv)) for c, yv in track.items())
    xs = np.array([p[0] for p in pts]); ys = np.array([p[1] for p in pts])
    # resample on a uniform grid within the traced range
    n = cfg.get('n', 161)
    xg = np.linspace(xs.min(), xs.max(), n)
    yg = np.interp(xg, xs, ys)
    # debug overlay
    ov = load(cfg['file']).copy(); d = ImageDraw.Draw(ov)
    for c, yv in track.items(): d.point((c + x0, yv + y0), fill=(255, 0, 255))
    for p, v in xpairs: d.line([(p + x0, bottom + y0 - 8), (p + x0, bottom + y0 + 8)], fill=(0, 200, 0), width=3)
    for p, v in ypairs: d.line([(left + x0 - 8, p + y0), (left + x0 + 8, p + y0)], fill=(0, 200, 0), width=3)
    ov_path = os.path.join(outdir, cfg['name'] + '_overlay.png')
    ovc = ov.crop((x0, y0, x0 + W, y0 + H)) if cfg.get('crop') else ov
    ovc.save(ov_path)
    return {
        'name': cfg['name'], 'file': cfg['file'], 'crop': cfg.get('crop'),
        'x_axis': {'refs': [[round(p + x0, 2), v] for p, v in xpairs], 'max_resid_px': round(rx, 3), 'mm_per_px': mx, 'method': xcal_method},
        'y_axis': {'refs': [[round(p + y0, 2), v] for p, v in ypairs], 'max_resid_px': round(ry, 3), 'unit_per_px': my},
        'traced_columns': len(track), 'range': [float(xs.min()), float(xs.max())],
        'x': [round(float(v), 3) for v in xg], 'y': [round(float(v), 5) for v in yg],
        'overlay': ov_path,
    }

if __name__ == '__main__':
    cfgs = json.load(open(sys.argv[1])); outdir = sys.argv[2]; os.makedirs(outdir, exist_ok=True)
    results = []
    for cfg in cfgs:
        try:
            r = extract(cfg, outdir); results.append(r)
            print(f"{cfg['name']:<22} OK  x-cal {len(r['x_axis']['refs'])} ticks resid {r['x_axis']['max_resid_px']:.2f}px  y-cal {len(r['y_axis']['refs'])} ticks resid {r['y_axis']['max_resid_px']:.2f}px  cols {r['traced_columns']}  range {r['range'][0]:.2f}..{r['range'][1]:.2f}  y(0) {np.interp(0, r['x'], r['y']):.4f}")
        except Exception as e:
            print(f"{cfg['name']:<22} FAIL {e}")
    json.dump(results, open(os.path.join(outdir, 'extracted.json'), 'w'), indent=1)
