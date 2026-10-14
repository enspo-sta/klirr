// Compare simulated H2/H3 with Erin's measured curves (pixel-extracted) for three Purifi drivers
const E = require('../engine.js'); const { API } = E;
const lib = require('../library.json');
const meas = {}; for (const r of require('../research/lsi/outhd/hd_extracted.json')) meas[r.name] = r.series;
const at = (s, f) => { let a = s[0]; for (let i = 1; i < s.length; i++) { const b = s[i]; if (b[0] >= f) { const t = (Math.log(f) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0])); return a[1] + t * (b[1] - a[1]); } a = b; } return NaN; };
const freqs = [30, 40, 50, 60, 80, 100, 150, 200, 300, 500];
// The Guide's table "Simulation against measured distortion" (96 dB, small-signal Kms): [f, simH2, measH2, simH3, measH3], whole dB.
// If the engine, the library or the extraction changes, this check fails until the Guide's table is updated to match.
const GUIDE = {
  ptt65m: [[30, -18, -17, -16, -13], [40, -22, -22, -22, -21], [60, -30, -34, -32, -30], [100, -44, -57, -45, -44], [150, -54, -55, -57, -53]],
  ptt65x: [[30, -26, -22, -12, -16], [40, -30, -30, -24, -26], [60, -41, -40, -41, -41], [100, -52, -46, -62, -41], [150, -56, -55, -79, -61]],
  ptt8: [[30, -32, -23, -29, -29], [40, -43, -30, -40, -41], [60, -60, -43, -53, -42], [100, -62, -56, -71, -55], [150, -65, -52, -87, -56]],
};
const failures = [];
for (const key of ['ptt8', 'ptt65x', 'ptt65m']) {
  const base = lib.find((d) => d.id === 'eac-' + key);
  for (const variant of ['table', 'curve']) {
    const d = JSON.parse(JSON.stringify(base)); d.abs = { kms: variant };
    const setup = { id: 'a', ways: [{ driver: d, count: 1, enclosure: { type: 'ib' }, filters: [] }], space: 'half', distance: 1 };
    for (const lvl of [86, 96]) {
      const r = API.hdSweep({ setups: [setup], freqs, level: { mode: 'splref', value: lvl, fref: 500 }, harmonics: 3, mechanisms: false }, null)[0];
      const m = meas[`${key}_hd${lvl}`];
      let e2 = 0, e3 = 0, n = 0; const rows = [];
      r.f.forEach((f, i) => {
        const s2 = 20 * Math.log10(r.hd[i][0]), s3 = 20 * Math.log10(r.hd[i][1]);
        const m2 = at(m.H2, f), m3 = at(m.H3, f);
        if (f <= 60) { e2 += s2 - m2; e3 += s3 - m3; n++; }
        rows.push(`${f}:${s2.toFixed(0)}/${m2.toFixed(0)} ${s3.toFixed(0)}/${m3.toFixed(0)}`);
        if (variant === 'table' && lvl === 96) {
          const g = GUIDE[key].find((q) => q[0] === f);
          const got = [Math.round(s2), Math.round(m2), Math.round(s3), Math.round(m3)];
          if (g && got.some((v, j) => v !== g[j + 1])) failures.push(`${key} ${f} Hz: now ${got.join('/')}, Guide says ${g.slice(1).join('/')}`);
        }
      });
      console.log(`${key} Kms ${variant.padEnd(5)} ${lvl} dB V=${r.V[0].toFixed(2)} | mean sim−meas ≤60 Hz: H2 ${(e2 / n).toFixed(1)} dB, H3 ${(e3 / n).toFixed(1)} dB | f: simH2/measH2 simH3/measH3 → ${rows.join(' | ')}`);
    }
  }
}
if (failures.length) { console.log('Guide table out of date:\n  ' + failures.join('\n  ')); process.exit(1); } else console.log('Guide table matches');
