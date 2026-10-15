"""Regenerates research/reference/reference.json: the harmonic-balance solution of each reference case.

hb.py solves the periodic steady state of the same lumped-parameter model directly in the frequency domain, from
equations written out independently of engine.js (no time stepping, settling or lookup tables). The engine is run
first only to learn the exact tone frequency it simulates (coherent sampling rounds it); the reference is then
solved at that frequency. tests/reference_test.js compares the engine with this file.

    python3 research/reference/run_reference.py      # needs numpy and node

Rerun it when the built-in curves in library.json change, and commit the result with them.
"""
import json, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hb  # noqa: E402

lib = {d['id']: d for d in json.load(open(os.path.join(HERE, '..', '..', 'library.json')))}


def vented(Vb, d_mm, Fb, Qp=60, xi=1.0, n=1):
    V0 = Vb * 1e-3; Sp = n * np.pi * (d_mm * 1e-3) ** 2 / 4; wb = 2 * np.pi * Fb
    Leff = hb.C0 ** 2 * Sp / (wb ** 2 * V0); Map = hb.RHO * Sp * Leff; dh = d_mm * 1e-3
    return dict(type='vented', V0=V0, Sp=Sp, Map=Map, Rp=wb * Map / Qp, xi=xi, vc=0.375 / dh, vw=0.075 / dh)


def pr_box(Vb, Sd_cm2, Mmp_g, Cmp, Qmp, xlim_mm=0, thr=0.5, shape=2, n=1):
    V0 = Vb * 1e-3; Sdr = Sd_cm2 * 1e-4; Mmp = Mmp_g * 1e-3; Kmp = 1 / (Cmp * 1e-3); wr = np.sqrt(Kmp / Mmp)
    return dict(type='pr', V0=V0, Sr=n * Sdr, Mr=n * Mmp, Kr=n * Kmp, Rr=n * wr * Mmp / Qmp, prXlim=xlim_mm * 1e-3, prThr=thr, prShape=shape)


cases = []


def add(name, did, f, V, enc_engine=None, enc_hb=None, drive='voltage', abs_kms='table', K=24):
    cases.append(dict(name=name, driverId=did, f=f, V=V, enc=enc_engine or {'type': 'ib'}, flags={'doppler': False}, drive=drive,
                      abs={'kms': abs_kms}, _hb=enc_hb or {'type': 'ib'}, _K=K))


for f in [20, 30, 40, 60, 100, 300]: add(f'PTT8 infinite baffle {f} Hz 5.87 V', 'eac-ptt8', f, 5.87)
for f in [30, 60]: add(f'PTT8 infinite baffle {f} Hz 5.87 V, stiffness from the curve', 'eac-ptt8', f, 5.87, abs_kms='curve')
for f in [30, 50, 80, 150, 1000]: add(f'PTT6.5M infinite baffle {f} Hz 6.14 V', 'eac-ptt65m', f, 6.14, K=32)
for f in [30, 60]: add(f'PTT6.5X infinite baffle {f} Hz 8.41 V', 'eac-ptt65x', f, 8.41, K=32)
for f in [20, 32, 50, 100]: add(f'PTT8 sealed 15 L {f} Hz 4.61 V', 'eac-ptt8', f, 4.61, {'type': 'sealed', 'Vb': 15}, {'type': 'sealed', 'V0': 0.015})
for f in [30, 45, 70]: add(f'PTT8 vented 40 L at 30 Hz, 50 mm port, {f} Hz 8 V', 'eac-ptt8', f, 8.0, {'type': 'vented', 'Vb': 40, 'port': {'d_mm': 50, 'n': 1, 'Fb': 30, 'Qp': 60, 'xi': 1}}, vented(40, 50, 30), K=32)
for f in [25, 40]: add(f'PTT8 passive radiator 20 L {f} Hz 4 V', 'eac-ptt8', f, 4.0, {'type': 'pr', 'Vb': 20, 'pr': {'Sd': 235, 'Mmp': 120, 'Cmp': 0.6, 'Qmp': 8, 'n': 1, 'xlim': 8, 'thr': 0.5, 'shape': 2}}, pr_box(20, 235, 120, 0.6, 8, 8), K=32)
add('PTT6.5M infinite baffle 100 Hz current drive 2.5 V', 'eac-ptt65m', 100, 2.5, drive='current')
add('SEAS W18NX-001 (no L2/R2 branch) infinite baffle 40 Hz 4 V', 'eac-seas', 40, 4.0)

public = [{k: v for k, v in c.items() if not k.startswith('_')} for c in cases]
tmp = os.path.join(HERE, '_cases.json'); json.dump(public, open(tmp, 'w'))
eng = json.loads(subprocess.run(['node', os.path.join(HERE, 'engine_points.js'), tmp], capture_output=True, text=True, check=True).stdout)
os.remove(tmp)
out = []
for c, p, e in zip(cases, public, eng):
    r = hb.solve(hb.driver_model(lib[c['driverId']], c['abs']['kms']), c['_hb'], e['f'], c['V'], K=c['_K'], drive=c['drive'])
    assert r['resid'] < 1e-8, (c['name'], r['resid'])
    out.append(dict(case=p, f=e['f'], hb={k: r[k] for k in ('hd', 'xdc', 'xpk', 'spl', 'resid')}))
    print(f"{c['name']:<62} H2 {20 * np.log10(r['hd'][0]):8.2f} H3 {20 * np.log10(r['hd'][1]):8.2f} dB  engine {20 * np.log10(e['hd'][0]):8.2f} {20 * np.log10(e['hd'][1]):8.2f}")
json.dump({'about': __doc__.strip().split('\n\n')[0], 'cases': out}, open(os.path.join(HERE, 'reference.json'), 'w'), indent=1)
