// The three suspension stiffness options against Erin's 2020 harmonic distortion measurements of five drivers that
// played no part in choosing the default: PTT4.0W04, SB17CAC35-4, PTT6.5W04, 18WU/4741T-00 and MW182.
// Six levels each, driven at the voltages in research/erin/drive_levels_2020.json, infinite baffle, half space, 1 m.
// Run: node tests/cmp_erin2020.js            (prints the comparison)
//      node tests/cmp_erin2020.js --json F   (also writes it to F)
const fs = require('fs');
const { API, util } = require('../engine.js');
const lib = require('../library.json');
const meas = {}; for (const r of require('../research/lsi/outhd2020/hd_extracted.json')) meas[r.name] = r.series;
const DRIVE = require('../research/erin/drive_levels_2020.json').drivers;
const at = (s, f) => { if (f < s[0][0]) return NaN; let a = s[0]; for (let i = 1; i < s.length; i++) { const b = s[i]; if (b[0] >= f) { const t = (Math.log(f) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0])); return a[1] + t * (b[1] - a[1]); } a = b; } return NaN; };
const dB = (x) => 20 * Math.log10(x);
const FREQS = [30, 40, 50, 60, 80, 100, 150, 200, 300, 500];
const BASS = 100; // the summary uses f <= 100 Hz, where the suspension matters
const VARIANTS = ['table', 'offset', 'curve'];
const bandOf = (s) => s.split('-').map((v) => parseFloat(v));

const out = { freqs: FREQS, variants: VARIANTS, drivers: {} };
for (const [id, dl] of Object.entries(DRIVE)) {
  const base = lib.find((d) => d.id === id);
  const setupOf = (variant) => { const d = JSON.parse(JSON.stringify(base)); d.abs = { kms: variant }; return { id: 'a', ways: [{ driver: d, count: 1, enclosure: { type: 'ib' }, filters: [] }], space: 'half', distance: 1 }; };
  // level check: Klirr's linear SPL at 1 V averaged in dB over the review's band, against the level the multitone legend gives for 1 V
  const [b0, b1] = bandOf(dl.band);
  const bf = []; for (let f = b0; f <= b1 * 1.0001; f *= Math.pow(2, 1 / 12)) bf.push(f);
  const lin = API.linearCurves(setupOf('table'), bf).spl;
  const lin1V = lin.reduce((a, b) => a + b, 0) / lin.length;
  const rec = { label: base.label, band: dl.band, level_at_1V: { erin: dl.level_at_1V_db, klirr: +lin1V.toFixed(2) }, frames: [] };
  for (const fr of dl.hd_frames) {
    const m = meas[fr.name];
    const row = { level_db: fr.level_db, V: fr.V, variants: {} };
    for (const variant of VARIANTS) {
      const r = API.hdSweep({ setups: [setupOf(variant)], freqs: FREQS, level: { mode: 'voltage', value: fr.V }, harmonics: 3, mechanisms: false }, null)[0];
      const pts = FREQS.map((f, i) => ({ f, simH2: +dB(r.hd[i][0]).toFixed(2), simH3: +dB(r.hd[i][1]).toFixed(2), measH2: +at(m.H2, f).toFixed(2), measH3: +at(m.H3, f).toFixed(2),
        xpk: +r.ways[i][0].xpk.toFixed(2), outOfFit: !!r.ways[i][0].outOfFit, outOfRange: !!r.ways[i][0].outOfRange, converged: r.converged[i] !== false }));
      const bass = pts.filter((p) => p.f <= BASS && isFinite(p.measH2) && isFinite(p.measH3));
      const mean = (k) => bass.reduce((a, p) => a + p['sim' + k] - p['meas' + k], 0) / bass.length;
      const mabs = (k) => bass.reduce((a, p) => a + Math.abs(p['sim' + k] - p['meas' + k]), 0) / bass.length;
      row.variants[variant] = { points: pts, bass: { n: bass.length, H2: { mean: +mean('H2').toFixed(2), abs: +mabs('H2').toFixed(2) }, H3: { mean: +mean('H3').toFixed(2), abs: +mabs('H3').toFixed(2) } } };
    }
    rec.frames.push(row);
  }
  out.drivers[id] = rec;
}
// summaries over one set of points shared by all three options, f <= 100 Hz:
//   all:  every level
//   high: the three highest levels, where the coil moves far, and only points where it stays inside Klippel's fit range
//         under every option (beyond it the curves rest on less than 1 % of the measurement)
const SETS = {
  all: (k, i, pts) => true,
  high: (k, i, pts) => k >= 3 && pts.every((p) => !p.outOfFit),
};
out.summary = {};
for (const [set, sel] of Object.entries(SETS)) {
  out.summary[set] = {};
  for (const v of VARIANTS) {
    const s = { H2: { mean: 0, abs: 0 }, H3: { mean: 0, abs: 0 }, n: 0, perDriver: {} };
    for (const [id, rec] of Object.entries(out.drivers)) {
      const d = { H2: { mean: 0, abs: 0 }, H3: { mean: 0, abs: 0 }, n: 0 };
      rec.frames.forEach((fr, k) => FREQS.forEach((f, i) => {
        const pts = VARIANTS.map((w) => fr.variants[w].points[i]); const p = fr.variants[v].points[i];
        if (f > BASS || !isFinite(p.measH2) || !isFinite(p.measH3) || !sel(k, i, pts)) return;
        for (const q of ['H2', 'H3']) { const e = p['sim' + q] - p['meas' + q]; d[q].mean += e; d[q].abs += Math.abs(e); }
        d.n++;
      }));
      for (const q of ['H2', 'H3']) { s[q].mean += d[q].mean; s[q].abs += d[q].abs; d[q].mean = +(d[q].mean / d.n).toFixed(2); d[q].abs = +(d[q].abs / d.n).toFixed(2); }
      s.n += d.n; s.perDriver[id] = d;
    }
    for (const q of ['H2', 'H3']) { s[q].mean = +(s[q].mean / s.n).toFixed(2); s[q].abs = +(s[q].abs / s.n).toFixed(2); }
    out.summary[set][v] = s;
  }
}

for (const [id, rec] of Object.entries(out.drivers)) {
  console.log(`${rec.label}: level at 1 V, Erin ${rec.level_at_1V.erin} dB, Klirr ${rec.level_at_1V.klirr} dB (average ${rec.band})`);
  for (const fr of rec.frames) {
    console.log(`  ${fr.level_db} dB, ${fr.V.toFixed(2)} V: ` + VARIANTS.map((v) => { const b = fr.variants[v].bass; return `${v} H2 ${b.H2.mean.toFixed(1)} (|${b.H2.abs.toFixed(1)}|) H3 ${b.H3.mean.toFixed(1)} (|${b.H3.abs.toFixed(1)}|)`; }).join(' · '));
  }
}
for (const set of Object.keys(SETS)) {
  console.log(`\nsim − measured, dB, f ≤ ${BASS} Hz, ${set}: mean (mean absolute)`);
  for (const v of VARIANTS) {
    const s = out.summary[set][v];
    console.log(`${v.padEnd(7)} H2 ${s.H2.mean.toFixed(1)} (${s.H2.abs.toFixed(1)})  H3 ${s.H3.mean.toFixed(1)} (${s.H3.abs.toFixed(1)})  n ${s.n} | ` +
      Object.entries(s.perDriver).map(([id, d]) => `${id.slice(4)} ${d.H2.mean.toFixed(1)}/${d.H3.mean.toFixed(1)} (${d.H2.abs.toFixed(1)}/${d.H3.abs.toFixed(1)})`).join('  '));
  }
}
// How much the option moves Klirr's multitone distortion in the band of Erin's multitone Test 1 (80 to 1600 Hz), at the
// highest voltage in each review's multitone legend, taken as the RMS of the whole stimulus
const MT = { fLo: 80, fHi: 1600, perOct: 6 };
out.multitone = {};
let mtTotal = 0; const mtBands = [];
for (const [id, dl] of Object.entries(DRIVE)) {
  const base = lib.find((d) => d.id === id);
  const Vtop = Math.max(...Object.keys(dl.multitone_legend_db).map(Number));
  const res = {};
  for (const variant of VARIANTS) {
    const d = JSON.parse(JSON.stringify(base)); d.abs = { kms: variant };
    const setup = { id: 'a', ways: [{ driver: d, count: 1, enclosure: { type: 'ib' }, filters: [] }], space: 'half', distance: 1 };
    // SPL of the linear output when the stimulus RMS is Vtop, spread equally over the tones
    const tf = API.linearCurves(setup, util.fracOctaveFreqs(MT.fLo, MT.fHi, MT.perOct)).spl;
    const level = 10 * Math.log10(tf.reduce((a, s) => a + Math.pow(10, s / 10), 0) * Vtop * Vtop / tf.length);
    const r = API.multitone({ setups: [setup], fLo: MT.fLo, fHi: MT.fHi, perOct: MT.perOct, level, mechanisms: false }, null)[0];
    res[variant] = { totalDb: +r.totalDb.toFixed(2), bands: r.bands.map((b) => [+b.fc.toFixed(1), +b.ratioDb.toFixed(2)]) };
  }
  for (const v of VARIANTS.slice(1)) {
    mtTotal = Math.max(mtTotal, Math.abs(res[v].totalDb - res.table.totalDb));
    res[v].bands.forEach((b, i) => mtBands.push(Math.abs(b[1] - res.table.bands[i][1])));
  }
  out.multitone[id] = { V: Vtop, ...res };
}
mtBands.sort((a, b) => a - b);
const mtMedian = mtBands[Math.floor(mtBands.length / 2)], mtMax = mtBands[mtBands.length - 1];
console.log(`\nmultitone ${MT.fLo}–${MT.fHi} Hz at the top legend voltage: the option moves the total by at most ${mtTotal.toFixed(1)} dB, third-octave bands by a median ${mtMedian.toFixed(1)} dB and at most ${mtMax.toFixed(1)} dB`);
// the large-signal curve's stiffness at rest as a share of the small-signal table, on every measured driver
const ratios = lib.filter((d) => d.badge === 'measured' && d.nl && d.nl.kms).map((d) => { const c = API.compileDriver(d); return c.curves.kms.y0 * 1e3 / c.ts.Kms; });
const rLo = Math.round(Math.min(...ratios) * 100), rHi = Math.round(Math.max(...ratios) * 100);
console.log(`curve stiffness at rest: ${rLo} to ${rHi} % of the small-signal table on ${ratios.length} drivers; the default scales it by ${(1 / Math.max(...ratios)).toFixed(1)} to ${(1 / Math.min(...ratios)).toFixed(1)}`);
const j = process.argv.indexOf('--json'); if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 1));

// The Guide's table "Suspension stiffness against five more drivers" (src/template.html) must match these summaries.
const failures = [];
{
  const html = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'template.html'), 'utf8');
  const a = html.indexOf('Suspension stiffness against five more drivers'), sec = html.slice(a, html.indexOf('</table>', a));
  const NAME = { table: 'Small-signal table, curve shape scaled (default)', offset: 'Small-signal table plus the curve\'s change', curve: 'Large-signal curve as measured' };
  const fmt = (x) => (x < 0 ? '−' : '+') + Math.abs(x).toFixed(1);
  for (const v of VARIANTS) {
    const m = sec.match(new RegExp('<tr><td>' + NAME[v].replace(/[()+]/g, '\\$&') + '</td>((?:<td class="n">[^<]*</td>){4})</tr>'));
    if (!m) { failures.push(`no row for ${NAME[v]} in the Guide's table`); continue; }
    const cells = [...m[1].matchAll(/<td class="n">([^<]*)<\/td>/g)].map((c) => c[1]);
    const want = ['high', 'all'].flatMap((set) => ['H2', 'H3'].map((q) => `${fmt(out.summary[set][v][q].mean)} (${out.summary[set][v][q].abs.toFixed(1)})`));
    want.forEach((w, i) => { if (cells[i] !== w) failures.push(`${NAME[v]}, column ${i + 1}: the Guide says ${cells[i]}, the engine gives ${w}`); });
  }
  const after = html.slice(a, html.indexOf('<h2>', a));
  const n = after.match(/(\d+) points at the three highest levels and (\d+) at all six/);
  if (!n || +n[1] !== out.summary.high.table.n || +n[2] !== out.summary.all.table.n) failures.push(`point counts in the Guide (${n && n.slice(1).join(', ')}) differ from ${out.summary.high.table.n}, ${out.summary.all.table.n}`);
  const mt = after.match(/total by at most ([\d.]+) dB, and its third-octave bands by a median of ([\d.]+) dB and at most ([\d.]+) dB/);
  const mtWant = [mtTotal, mtMedian, mtMax].map((x) => x.toFixed(1));
  if (!mt || mt.slice(1).join() !== mtWant.join()) failures.push(`multitone sentence in the Guide says ${mt && mt.slice(1).join(', ')}, the engine gives ${mtWant.join(', ')}`);
  const rs = html.match(/is (\d+) to (\d+) % of the small-signal table on all (\w+) measured drivers/);
  if (!rs || +rs[1] !== rLo || +rs[2] !== rHi || rs[3] !== 'nine' || ratios.length !== 9) failures.push(`stiffness ratio sentence in the Guide says ${rs && rs.slice(1).join(', ')}, the library gives ${rLo}, ${rHi} on ${ratios.length}`);
}
if (failures.length) { console.log('Guide table check failed:\n  ' + failures.join('\n  ')); process.exit(1); } else console.log('Guide stiffness table matches');
