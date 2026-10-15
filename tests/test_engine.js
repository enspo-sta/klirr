// Validation tests for the Klirr engine. Run: node tests/test_engine.js
const E = require('../engine.js');
const { API, util } = E;
const log = (...a) => console.log(...a);
const t0 = Date.now();
// the Guide quotes these results; a failed check means the engine changed and the Guide's validation section must be updated with it
const failures = [];
const check = (ok, what) => { if (!ok) { failures.push(what); log('   CHECK FAILED:', what); } };

// Purifi PTT8.0X04-NAB-02 small-signal parameters as measured by Erin's Audio Corner (LPM table)
const PTT8 = { id: 'ptt8', label: 'PTT8 (linear)', ts: { Re: 3.55, Le: 0.111, L2: 0.282, R2: 0.74, Bl: 8.208, Mms: 42.935, Cms: 0.709, Rms: 1.028, Sd: 235.06, Xmax: 9.3 } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const setupOf = (drv, enc, extra) => ({ id: 's', ways: [Object.assign({ driver: drv, count: 1, enclosure: enc || { type: 'ib' }, filters: [] }, extra || {})], space: 'half', distance: 1 });

// ---------- T1: linear consistency (time domain with all nonlinearities off vs frequency-domain model)
{
  log('T1 linear consistency: time-domain (nonlinear terms off) vs frequency-domain model');
  const encs = [
    ['infinite baffle', { type: 'ib' }],
    ['sealed 15 L, leak Ql 20', { type: 'sealed', Vb: 15, Ql: 20 }],
    ['vented 40 L @ 30 Hz', { type: 'vented', Vb: 40, Ql: 10, port: { d_mm: 70, n: 1, Fb: 30, Qp: 60, xi: 1 } }],
    ['passive radiator 20 L', { type: 'pr', Vb: 20, Ql: 10, pr: { Sd: 235, Mmp: 120, Cmp: 0.6, Qmp: 8, n: 2 } }],
  ];
  let worst = 0, floor = -Infinity;
  for (const [name, enc] of encs) {
    const cs = API.compileSetup(setupOf(PTT8, enc, { filters: [{ type: 'hp', align: 'bw', order: 2, f: 20 }] }));
    const fs = API.chooseFs(cs, 2000);
    const row = [];
    for (const f of [18, 30, 55, 120, 400, 1500]) {
      const V = 2.83;
      const pt = util.hdPoint(cs, util.NL_NONE, fs, f, V, 3);
      const lin = util.splOf(util.cabs(API.linearSetup(cs, pt.f, 2 * fs).p) * V);
      const err = pt.spl - lin; worst = Math.max(worst, Math.abs(err)); floor = Math.max(floor, 20 * Math.log10(pt.hd[0] + 1e-30));
      row.push(`${f}Hz ${pt.spl.toFixed(3)}/${lin.toFixed(3)} (Δ${err.toFixed(4)}; HD2 ${(20 * Math.log10(pt.hd[0] + 1e-30)).toFixed(0)} dB)`);
    }
    log('  ', name.padEnd(28), '| fs', fs, '|', row.join(' | '));
  }
  log('   worst |Δ| =', worst.toFixed(5), 'dB; highest HD2', floor.toFixed(0), 'dB');
  check(worst < 0.001, 'T1 linear consistency worse than 0.001 dB (' + worst.toFixed(5) + ')');
  check(floor < -210, 'T1 numerical distortion floor above -210 dB (' + floor.toFixed(0) + ')');
}

// ---------- T2: weak-nonlinearity scaling laws
{
  log('T2 weak-nonlinearity scaling (HD2 ∝ A, HD3 ∝ A²)');
  const drvSym = clone(PTT8); drvSym.nl = { bl: { type: 'param', xlim: 5, thr: 0.82, shape: 2, offset: 0 } };
  const drvAsym = clone(PTT8); drvAsym.nl = { kms: { type: 'poly', coef: [1.41, 0.08], range: 12 } }; // linear term → asymmetric
  for (const [name, d] of [['symmetric Bl(x)', drvSym], ['asymmetric Kms(x)', drvAsym]]) {
    const cs = API.compileSetup(setupOf(d));
    const fs = API.chooseFs(cs, 500);
    const a = util.hdPoint(cs, util.NL_ALL, fs, 40, 0.5, 5), b = util.hdPoint(cs, util.NL_ALL, fs, 40, 1.0, 5);
    const dB = (x) => 20 * Math.log10(x);
    log(`   ${name}: +6.02 dB drive → HD2 ${(dB(b.hd[0]) - dB(a.hd[0])).toFixed(2)} dB, HD3 ${(dB(b.hd[1]) - dB(a.hd[1])).toFixed(2)} dB   (x_pk ${a.ways[0].xpk.toFixed(2)} → ${b.ways[0].xpk.toFixed(2)} mm)`);
    if (name.startsWith('symmetric')) check(Math.abs(dB(b.hd[1]) - dB(a.hd[1]) - 12.04) < 0.05, 'T2 symmetric Bl(x) H3 slope not 12.04 dB');
    else check(Math.abs(dB(b.hd[0]) - dB(a.hd[0]) - 6.02) < 0.05, 'T2 asymmetric Kms(x) H2 slope not 6.02 dB');
  }
}

// ---------- T3: step-size convergence with all nonlinearities on
{
  log('T3 step-size convergence');
  const d = clone(PTT8);
  d.nl = { bl: { type: 'param', xlim: 7, thr: 0.82, shape: 4, offset: 0.8 }, kms: { type: 'param', xlim: 8, thr: 0.75, shape: 2, offset: -0.5 }, le: { type: 'param', xref: 8, inPct: 25, outPct: -15 } };
  const cs = API.compileSetup(setupOf(d, { type: 'vented', Vb: 40, Ql: 10, port: { d_mm: 70, Fb: 30 } }));
  for (const f of [30, 300, 2000]) {
    const out = [];
    for (const fs of [96000, 192000, 384000]) { const p = util.hdPoint(cs, util.NL_ALL, fs, f, 8, 5); out.push([fs, 20 * Math.log10(p.hd[0]), 20 * Math.log10(p.hd[1]), p.spl]); }
    log(`   ${f} Hz:`, out.map((o) => `fs ${o[0] / 1000}k HD2 ${o[1].toFixed(3)} HD3 ${o[2].toFixed(3)} SPL ${o[3].toFixed(3)}`).join(' | '));
    for (const k of [1, 2]) if (out[0][k] > -120) check(Math.abs(out[0][k] - out[2][k]) < 0.005, `T3 ${f} Hz H${k + 1} moves ${(out[0][k] - out[2][k]).toFixed(4)} dB between 96 and 384 kHz`);
  }
}

// ---------- T4: Klippel Table IV — parameter variation that gives 10 % distortion at the peak displacement
{
  log('T4 Klippel Table IV replication (two-tone f1 = fs, f2 = 8.5·fs, 4:1, free air, Doppler off)');
  const base = clone(PTT8);
  const fs0 = API.derived(API.tsOf(base)).fs;
  const X = 5; // mm
  const cases = [
    ['Bl = b0 + b2·x², Blmin 82 %', { bl: { type: 'poly', coef: [8.208, 0, -8.208 * 0.18 / (X * X)], range: 2.2 * X } }, 'd3'],
    ['Bl = b0 + b4·x⁴, Blmin 82 %', { bl: { type: 'poly', coef: [8.208, 0, 0, 0, -8.208 * 0.18 / Math.pow(X, 4)], range: 1.6 * X } }, 'd3'],
    ['Cms = c0 + c2·x², Cmin 74 %', { kms: { type: 'poly', quantity: 'cms', coef: [0.709, 0, -0.709 * 0.26 / (X * X)], range: 1.8 * X } }, 'dt'],
    ['Cms = c0 + c4·x⁴, Cmin 77 %', { kms: { type: 'poly', quantity: 'cms', coef: [0.709, 0, 0, 0, -0.709 * 0.23 / Math.pow(X, 4)], range: 1.4 * X } }, 'dt'],
    ['Cms = c0 + c1·x, Cmin 78 %', { kms: { type: 'poly', quantity: 'cms', coef: [0.709, -0.709 * 0.22 / X], range: 3 * X } }, 'dt'],
  ];
  // Le case: Le(x) = l0 + l1 x with |Ze(x,f2) − Ze(0,f2)|/|Ze(0,f2)| = 10 % at X (solve l1)
  {
    const f2 = 8.5 * fs0, w = 2 * Math.PI * f2; const ts = base.ts;
    const Ze = (r) => { const s = { re: 0, im: w }; const L = ts.Le * 1e-3 * r, L2 = ts.L2 * 1e-3 * r, R2 = ts.R2 * r; const zl = { re: 0, im: w * L }; const num = { re: -w * w * 0 + 0, im: w * L2 * R2 }; const den = { re: R2, im: w * L2 }; const d2 = den.re * den.re + den.im * den.im; const z2 = { re: (num.re * den.re + num.im * den.im) / d2, im: (num.im * den.re - num.re * den.im) / d2 }; return { re: ts.Re + zl.re + z2.re, im: zl.im + z2.im }; };
    const z0 = Ze(1); const m0 = Math.hypot(z0.re, z0.im);
    let lo = 0, hi = 1; for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; const za = Ze(1 + mid), zb = Ze(1 - mid); const dev = Math.max(Math.hypot(za.re - z0.re, za.im - z0.im), Math.hypot(zb.re - z0.re, zb.im - z0.im)) / m0; if (dev > 0.10) hi = mid; else lo = mid; }
    const g = lo; // relative inductance change at ±X
    cases.push(['Le = l0 + l1·x, Zmax 10 %', { le: { type: 'poly', coef: [0.111, -0.111 * g / X], range: 3 * X } }, 'd2']);
  }
  const GUIDE = [10.2, 9.8, 7.2, 12.1, 6.8, 9.8]; // the 'Klirr' column of the Guide's Table IV comparison, in case order
  let ci = 0;
  for (const [name, nl, metric] of cases) {
    const d = clone(base); d.nl = nl;
    const cs = API.compileSetup(setupOf(d));
    const fs = API.chooseFs(cs, 20 * fs0);
    const flags = Object.assign({}, util.NL_ALL, { doppler: false });
    // find U1 such that the peak displacement equals X
    let lo = 0.1, hi = 60, pt;
    for (let it = 0; it < 22; it++) {
      const mid = Math.sqrt(lo * hi);
      pt = util.imdPoint(cs, flags, fs, fs0, 8.5 * fs0, mid, mid / 4, false);
      if (pt.ways[0].xpk > X) hi = mid; else lo = mid;
    }
    pt = util.imdPoint(cs, flags, fs, fs0, 8.5 * fs0, lo, lo / 4, false);
    const c = pt.comp; const dt = Math.sqrt(c.h2f1 ** 2 + c.h3f1 ** 2) / c.f1; // harmonics of f1 (2nd+3rd dominate)
    const val = metric === 'd3' ? pt.d3 : metric === 'd2' ? pt.d2 : dt;
    log(`   ${name.padEnd(30)} x_pk ${pt.ways[0].xpk.toFixed(2)} mm → ${metric} = ${(val * 100).toFixed(1)} %   (d2 ${(pt.d2 * 100).toFixed(1)} %, d3 ${(pt.d3 * 100).toFixed(1)} %, dt ${(dt * 100).toFixed(1)} %)`);
    check(Math.abs(val * 100 - GUIDE[ci]) < 0.15, `T4 ${name}: ${(val * 100).toFixed(1)} % but the Guide says ${GUIDE[ci]} %`); ci++;
  }
}

// ---------- T5: Doppler only, compared with the phase-modulation formula
{
  log('T5 Doppler only vs phase modulation: arithmetic d2 = 2π·f2·X/c; Beers–Belar X_D formula uses the root-sum-square (1/√2 of it)');
  const cs = API.compileSetup(setupOf(PTT8));
  const flags = Object.assign({}, util.NL_NONE, { doppler: true });
  for (const [f1, f2, U] of [[40, 2000, 6], [60, 1000, 10], [30, 3000, 4]]) {
    const fs = API.chooseFs(cs, f2 + 3 * f1);
    const pt = util.imdPoint(cs, flags, fs, f1, f2, U, U / 4, false);
    const X = pt.ways[0].xpk * 1e-3; // includes the small f2 displacement; use f1-only estimate below
    const pt1 = util.hdPoint(cs, util.NL_NONE, fs, f1, U, 2);
    const X1 = pt1.ways[0].xpk * 1e-3;
    const pred = 2 * Math.PI * pt.f2 * X1 / E.AIR.c;
    log(`   f1 ${f1} Hz, f2 ${f2} Hz: X(f1) ${(X1 * 1e3).toFixed(2)} mm, simulated d2 ${(pt.d2 * 100).toFixed(3)} %, predicted ${(pred * 100).toFixed(3)} %, ratio ${(pt.d2 / pred).toFixed(4)}; Beers–Belar ${(X1 * 1e3 * f2 / 770).toFixed(3)} %`);
    check(Math.abs(pt.d2 / pred - 1) < 0.005, `T5 Doppler d2 off the phase-modulation formula by more than 0.5 % at f1 ${f1} Hz`);
  }
}

// ---------- T6: port compression onset (Vanderkooy model)
{
  log('T6 vented box at Fb: fundamental compression and port velocity vs drive');
  const enc = { type: 'vented', Vb: 40, Ql: 10, port: { d_mm: 50, n: 1, Fb: 30, Qp: 60, xi: 1 } };
  const cs = API.compileSetup(setupOf(PTT8, enc));
  const fs = API.chooseFs(cs, 300);
  for (const V of [1, 4, 8, 16, 32]) {
    const nl = util.hdPoint(cs, Object.assign({}, util.NL_NONE, { port: true, air: true }), fs, 30, V, 5);
    const lin = util.splOf(util.cabs(API.linearSetup(cs, nl.f, 2 * fs).p) * V);
    log(`   ${String(V).padStart(2)} V: port peak ${nl.ways[0].vport.toFixed(1)} m/s, SPL ${nl.spl.toFixed(2)} dB (linear ${lin.toFixed(2)}), compression ${(lin - nl.spl).toFixed(2)} dB, THD ${(nl.thd * 100).toFixed(2)} %`);
  }
}

// ---------- T7: LR4 two-way sum (linear) and a filtered nonlinear sweep smoke test
{
  log('T7 two-way LR4 summation (linear) and timing');
  const d = clone(PTT8); d.nl = { bl: { type: 'param', xlim: 7, thr: 0.82, shape: 4 } };
  const setup = { id: 'tw', space: 'half', distance: 1, ways: [
    { driver: d, count: 1, enclosure: { type: 'sealed', Vb: 20 }, filters: [{ type: 'lp', align: 'lr', order: 4, f: 500 }] },
    { driver: d, count: 1, enclosure: { type: 'sealed', Vb: 20 }, filters: [{ type: 'hp', align: 'lr', order: 4, f: 500 }] },
  ] };
  const lc = API.linearCurves(setup, [200, 350, 500, 700, 1200]);
  log('   sum SPL @ 200/350/500/700/1200 Hz:', lc.spl.map((v) => v.toFixed(2)).join(' / '));
  const t = Date.now();
  const r = API.hdSweep({ setups: [setup], freqs: util.fracOctaveFreqs(40, 4000, 3), level: { mode: 'splref', value: 94, fref: 500 }, harmonics: 5, mechanisms: false }, null);
  log(`   HD sweep 21 points: ${Date.now() - t} ms, fs ${r[0].fs}`);
}
// ---------- T11: the Guide's limits table against the published limits and the engine
{
  log('T11 Guide table "Pixel extraction checked against published limits"');
  const fs = require('fs'), path = require('path');
  const lib = require('../library.json'), pub = require('../research/erin/limits.json').pages;
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'template.html'), 'utf8');
  const sec = html.slice(html.indexOf('Pixel extraction checked against published limits'), html.indexOf('Simulation against measured distortion'));
  const clean = (t) => t.replace(/&gt;/g, '>').trim();
  const rows = [...sec.matchAll(/<tr><td>([^<]+)<\/td><td class="n">([^<]+)<\/td><td class="n">([^<]+)<\/td><td class="n">([^<]+)<\/td><\/tr>/g)];
  check(rows.length === 9, `T11 expected 9 rows in the Guide's limits table, found ${rows.length}`);
  const crit = [['xbl82', 'Bl min=82%'], ['xc75', 'C min=75%'], ['xl10', 'Z max=10 %']];
  for (const [, label, ...cells] of rows) {
    const d = lib.find((x) => x.label === label); check(!!d, `T11 no library driver labelled ${label}`); if (!d) continue;
    const page = Object.values(pub).find((p) => p.url === d.sources[0].url); check(!!page, `T11 no published limits for ${label}`); if (!page) continue;
    const lim = API.driverSummary(d).lim;
    crit.forEach(([key, c], j) => {
      const [g, k] = clean(cells[j]).split(' / ');
      const p = page.limits.find((q) => q.criterion === c);
      const v = lim[key]; const klirr = (v.beyond ? '>' : '') + v.x.toFixed(1);
      check(p && p.value_mm === g, `T11 ${label} ${c}: the Guide says ${g} published, research/erin/limits.json says ${p && p.value_mm}`);
      check(klirr === k, `T11 ${label} ${c}: the Guide says Klirr ${k}, the engine gives ${klirr}`);
    });
  }
  log(`   ${rows.length} drivers checked`);
}
log('total time', Date.now() - t0, 'ms');
if (failures.length) { log(failures.length + ' check(s) failed'); process.exit(1); } else log('all checks passed');
