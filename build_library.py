"""Builds library.json, the built-in driver library, from the extraction outputs in research/.

Run from anywhere: python3 build_library.py. Every number comes from research/lsi/*/extracted.json (pixel extraction),
research/lsi/outhd/hd_extracted.json (measured harmonic distortion), research/lsi/xp/fit_ranges.json (Klippel's fit range
±xp, measured from the plots) and research/erin/index.json (the review pages' small-signal tables, read as text).
Nothing here is estimated except the SB34NRXL75-8 entry, which says so.
"""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
R = lambda *p: os.path.join(HERE, 'research', *p)
ex = {}
for f in [R('lsi', 'outc', 'extracted.json'), R('lsi', 'out', 'extracted.json')]:
    for r in json.load(open(f)): ex[r['name']] = r
hd = {r['name']: r for r in json.load(open(R('lsi', 'outhd', 'hd_extracted.json')))}
erin = json.load(open(R('erin', 'index.json')))
xp = json.load(open(R('lsi', 'xp', 'fit_ranges.json')))['drivers']  # Klippel's fit range ±xp, measured from the plots by research/lsi/xp_extract.py
RET = '2026-09-26'
IMG = {
 'ptt8': ('purifi_ptt80x04-nab-02', {'all': 'https://dl.dropboxusercontent.com/s/y2nj3jb722e3jq8/LSI.png?dl=0'}),
 'ptt65x': ('purifi_ptt6.5x04-naa-08', {'all': 'https://dl.dropboxusercontent.com/s/l8o5etz6lrtmt2q/LSI.png?dl=0'}),
 'ptt65m': ('purifi_ptt6.5m-08-nfa-01a', {'all': 'https://dl.dropboxusercontent.com/s/0p7dk17dwb6120h/lsi.png?dl=0'}),
}
B = 'https://erinsaudiocorner.com/images/Reviews/Drivers/'
def sep(path, bl='Force%20factor%20Bl%20(X).png', kms='Stiffness%20of%20suspension%20Kms%20(X).png', le='Electrical%20inductance%20L(X,%20I=0).png'):
    return {'bl': B + path + '/' + bl, 'kms': B + path + '/' + kms, 'le': B + path + '/' + le}
IMG.update({
 'ptt65w': ('purifi_ptt65w04', sep('Purifi/Purifi_PTT65W04')),
 'ptt4w': ('purifi_4', sep('Purifi/Purifi_PTT4.0W04-01A')),
 'sb17cac': ('sbacoustics_sb17cac35-4', sep('SB_Acoustics/SB17CAC35-4')),
 'ss18wu': ('scanspeak18wu4741t00', sep('Scanspeak/18WU4741T-00')),
 'dynmw182': ('dyn_mw182', sep('Dyn_Audio/MW182')),
 'seas': ('seas-w18nx001', sep('Seas/W18nx-001', 'Force-factor-Bl-X.png', 'Stiffness-of-suspension-Kms-X.png', 'Electrical-inductance-LX-I0.png')),
})
META = {
 'ptt8': ('Purifi', 'PTT8.0X04-NAB-02', 'woofer', 8),
 'ptt65x': ('Purifi', 'PTT6.5X04-NAA-08', 'woofer', 6.5),
 'ptt65m': ('Purifi', 'PTT6.5M08-NFA-01A', 'midrange', 6.5),
 'ptt65w': ('Purifi', 'PTT6.5W04-01A', 'woofer', 6.5),
 'ptt4w': ('Purifi', 'PTT4.0W04-01A', 'midwoofer', 4),
 'sb17cac': ('SB Acoustics', 'SB17CAC35-4', 'midwoofer', 6.5),
 'ss18wu': ('ScanSpeak', 'Illuminator 18WU/4741T-00', 'midwoofer', 7),
 'dynmw182': ('Dynaudio', 'MW182', 'woofer', 10),
 'seas': ('SEAS', 'W18NX-001', 'midwoofer', 7),
}
EXTRA_SOURCE = {
 'dynmw182': [{'sid': 's2', 'publisher': 'Dynaudio', 'title': 'Esotec / Esotar2 Series manual', 'url': 'https://dynaudio.com/hubfs/Car%20Audio/Downloads/esotec_esotar_manual.pdf', 'retrieved': '2026-10-15',
               'what': 'Frame diameter 239 mm (pages 5 and 8), used only for the size label; no simulation value comes from it.'}],
}
EXTRA_NOTE = {
 'ptt65m': ['The x axes of the stiffness and inductance plots were calibrated from the order of the detected gridlines, with tick labels read by eye where OCR could not read them (method recorded per axis in research/lsi/outc/extracted.json); every other axis of the nine drivers was read by OCR.'],
 'dynmw182': ['Sold and reviewed as a 10-inch woofer (Esotec MW 182). Dynaudio\'s Esotec and Esotar2 manual gives a frame 239 mm across (https://dynaudio.com/hubfs/Car%20Audio/Downloads/esotec_esotar_manual.pdf, pages 5 and 8); the effective piston area of 235 cm², a piston 173 mm across, is the value in the review and in retailers\' copies of the specification.'],
}
lib = []
for key, (brand, model, role, size) in META.items():
    page, imgs = IMG[key]
    info = erin[page]; p = info['params']
    ts = {k: p[k] for k in ['Re', 'Bl', 'Mms', 'Cms', 'Rms', 'Sd'] if k in p}
    note = []
    for k in ['Le', 'L2', 'R2']:
        if k in p: ts[k] = p[k]
    if 'Le' not in ts:
        xs, ys = ex[key + '_le']['x'], ex[key + '_le']['y']  # linear interpolation at x = 0
        i = next(k for k in range(1, len(xs)) if xs[k] >= 0)
        le0 = ys[i - 1] + (0 - xs[i - 1]) * (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1])
        ts['Le'] = round(le0, 4); ts['L2'] = 0; ts['R2'] = 0
        note.append('The review table has no Le, L2 or R2; Le is Le(x = 0) read from the pixel-extracted LSI inductance curve and the L2/R2 branch is omitted.')
    nl = {}
    ext = {}
    for c, q in (('bl', 'bl'), ('kms', 'kms'), ('le', 'le')):
        r = ex[key + '_' + c]
        nl[c] = {'type': 'points', 'x': r['x'], 'y': r['y'], 'fit': 10}
        ext[c] = {'image': imgs.get(c, imgs.get('all')), 'crop': r['crop'], 'x_axis': r['x_axis'], 'y_axis': r['y_axis'], 'range_mm': [round(r['range'][0], 2), round(r['range'][1], 2)]}
    d = {
        'id': 'eac-' + key, 'brand': brand, 'model': model, 'label': f'{brand} {model}', 'role': role, 'size_in': size,
        'badge': 'measured', 'ts': ts, 'nl': nl,
        'sources': [{'sid': 's1', 'publisher': "Erin's Audio Corner", 'title': info['title'], 'url': info['url'], 'retrieved': RET,
                     'what': 'Small-signal parameters from the review\'s Klippel LPM table (text); Bl(x), Kms(x) and Le(x) pixel-extracted from the review\'s Klippel LSI plots.'}] + EXTRA_SOURCE.get(key, []),
        'extraction': {'method': 'pixel', 'tool': 'OCR-read tick labels paired with detected gridlines, least-squares axis fit (every labelled tick is a check tick, max residual < 1 px), exact-colour mask, per-column continuity tracking, 161-point uniform resample', 'curves': ext,
                       'fit_range': {'xp_mm': xp[key]['xp_mm'], 'how': "Extent of the black segment the Klippel plots draw for the fit range (legend 'Xp- < X < Xp+'), measured with the extraction's axis calibration by research/lsi/xp_extract.py, median of the three plots."}},
        'fitRange': xp[key]['xp_mm'],
        'notes': ' '.join(note + EXTRA_NOTE.get(key, []) + ['Curves set the shape of each nonlinearity; absolute small-signal values come from the LPM table.']),
    }
    lib.append(d)
# SB34NRXL75-8: datasheet small-signal parameters; Bl(x) is a geometric estimate
lib.append({
    'id': 'sb-sb34nrxl75-8-est', 'brand': 'SB Acoustics', 'model': 'SB34NRXL75-8', 'label': 'SB Acoustics SB34NRXL75-8', 'role': 'woofer', 'size_in': 12,
    'badge': 'estimate', 'ts': {'Re': 6.2, 'Le': 1.2, 'L2': 0, 'R2': 0, 'Bl': 16.6, 'Mms': 93, 'Cms': 0.56, 'Rms': 2.35, 'Sd': 508, 'Xmax': 10, 'Pe': 200},
    'nl': {'bl': {'type': 'param', 'xlim': 11.4, 'thr': 0.82, 'shape': 6, 'offset': 0}},
    'sources': [{'sid': 's1', 'publisher': 'SB Acoustics', 'title': '12" SB34NRXL75-8 datasheet', 'url': 'https://sbacoustics.com/wp-content/uploads/2020/02/12in-SB34NRXL75-8.pdf', 'retrieved': RET,
                 'what': 'Small-signal parameters, voice-coil height 28 mm, air-gap height 8 mm, linear coil travel 20 mm peak to peak.'}],
    'notes': 'ESTIMATE, not a measurement. Bl(x) is a flat-top shape placed so Bl falls to 82 % at 11.4 mm, from the coil/gap geometry (Bl flat to (28 − 8)/2 = 10 mm, then falling as the coil leaves the gap). Kms(x) and Le(x) are unknown and treated as linear. The datasheet gives no L2/R2. Replace with Klippel LSI data when available.',
})
# measured harmonic distortion overlays (pixel-extracted from the same reviews)
for key in ['ptt8', 'ptt65x', 'ptt65m']:
    d = next(x for x in lib if x['id'] == 'eac-' + key)
    page = IMG[key][0]; ms = []
    for lvl in (86, 96):
        r = hd[f'{key}_hd{lvl}']
        img = next(u for u in erin[page]['images'] if f'Harmonic%20Distortion%20%28{lvl}dB' in u)
        ms.append({'kind': 'hd', 'level_db': lvl, 'label': f'Measured HD, {lvl} dB at 1 m',
                   'conditions': f"{lvl} dB @ 1 m as labelled by Erin's Audio Corner (Klippel distortion analyzer)", 'source': 's1', 'image': img,
                   'series': r['series'], 'extraction': {'x_axis': r['x_axis'], 'y_axis': r['y_axis']}})
    d['measurements'] = ms
json.dump(lib, open(os.path.join(HERE, 'library.json'), 'w'), separators=(',', ':'))
print(len(lib), 'drivers,', len(json.dumps(lib, separators=(',', ':'))) // 1024, 'KB')
for d in lib: print(d['id'], d['ts'])
