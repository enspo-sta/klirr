const E = require('../engine.js'); const { API, util } = E;
const clone = (o) => JSON.parse(JSON.stringify(o));
const PTT8 = { id: 'ptt8', label: 'PTT8 param', ts: { Re: 3.55, Le: 0.111, L2: 0.282, R2: 0.74, Bl: 8.208, Mms: 42.935, Cms: 0.709, Rms: 1.028, Sd: 235.06, Xmax: 9.3 },
  nl: { bl: { type: 'param', xlim: 9, thr: 0.82, shape: 4, offset: 0.5 }, kms: { type: 'param', xlim: 9, thr: 0.75, shape: 2, offset: -0.4 }, le: { type: 'param', xref: 8, inPct: 12, outPct: -8 } } };
const setup = { id: 'a', ways: [{ driver: PTT8, count: 1, enclosure: { type: 'sealed', Vb: 15 }, filters: [] }], space: 'half', distance: 1 };
let t = Date.now();
const sum = API.driverSummary(PTT8);
console.log('driverSummary', Date.now() - t, 'ms', JSON.stringify(sum.lim), 'fs', sum.der.fs.toFixed(2), 'Qts', sum.der.Qts.toFixed(3), 'Vas L', (sum.der.Vas * 1e3).toFixed(1), 'SPL2.83', sum.der.spl283.toFixed(2));
t = Date.now();
const imd = API.imdSweep({ setups: [setup], points: [70, 80, 90, 94, 100].map((L) => ({ f1: 40, f2: 400, ratioDb: 12.04, level: { ref: 'f1', value: L } })), mechanisms: true }, null);
console.log('imdSweep 5 levels + mechanisms', Date.now() - t, 'ms');
for (const p of imd[0].points) console.log('  spl1', p.spl1.toFixed(1), 'spl2', p.spl2.toFixed(1), 'd2 %', (p.d2 * 100).toFixed(3), 'd3 %', (p.d3 * 100).toFixed(3), 'xpk', p.ways[0].xpk.toFixed(2), 'spectrum?', !!p.spectrum, p.spectrum ? p.spectrum.mag.length : '');
console.log('  mech', Object.keys(imd[0].mech).map((k) => k + ':' + imd[0].mech[k].map((m) => (m.d2 * 100).toFixed(2) + '/' + (m.d3 * 100).toFixed(2)).join(',')).join(' | '));
t = Date.now();
const mt = API.multitone({ setups: [setup], fLo: 20, fHi: 2000, perOct: 6, level: 90, mechanisms: false }, null);
console.log('multitone', Date.now() - t, 'ms', 'tones', mt[0].nTones, 'N', mt[0].N, 'total dist', mt[0].totalDb.toFixed(1), 'dB; bands', mt[0].bands.map((b) => b.fc.toFixed(0) + ':' + b.ratioDb.toFixed(1)).join(' '));
t = Date.now();
const ms = API.maxSpl({ setups: [setup], freqs: util.fracOctaveFreqs(20, 500, 3), criteria: { thd: 10, xlim: [9.3] } }, null);
console.log('maxSpl', Date.now() - t, 'ms'); ms[0].f.forEach((f, i) => console.log('  ', f.toFixed(1), ms[0].spl[i] && ms[0].spl[i].toFixed(1), ms[0].limit[i]));
t = Date.now();
const wf = API.waveform({ setup, f: 30, level: { mode: 'spl', value: 100 } });
console.log('waveform', Date.now() - t, 'ms', wf.all.t.length, 'pts; x range', Math.min(...wf.all.ways[0].x).toFixed(2), Math.max(...wf.all.ways[0].x).toFixed(2));
// auralize: 3 s synthetic bass + voice at 48 kHz
const fa = 48000, n = 3 * fa; const L = new Float32Array(n), R = new Float32Array(n);
for (let i = 0; i < n; i++) { const tt = i / fa; const env = Math.min(1, tt * 10); L[i] = env * (0.5 * Math.sin(2 * Math.PI * 41 * tt) + 0.2 * Math.sin(2 * Math.PI * 440 * tt * (1 + 0.003 * Math.sin(2 * Math.PI * 5 * tt)))); R[i] = L[i]; }
t = Date.now();
const au = API.auralize({ setup, fsAudio: fa, channels: [L, R], level: 95 }, null);
console.log('auralize 3 s stereo', Date.now() - t, 'ms', 'M', au.M, 'resid ratio', au.stats.ratioDb.toFixed(1), 'dB', 'rms spl', au.stats.rmsSpl.toFixed(1), 'peak spl', au.stats.peakSpl.toFixed(1), 'xpk', au.channels[0].xpk.map((v) => v.toFixed(2)), 'xdc', au.channels[0].xdc.map((v) => v.toFixed(3)));
// residual of linear vs itself sanity: a linear-only driver should give ~ -inf (only Doppler)
const lin = clone(PTT8); delete lin.nl;
const au2 = API.auralize({ setup: { id: 'b', ways: [{ driver: lin, count: 1, enclosure: { type: 'sealed', Vb: 15 }, filters: [] }], space: 'half', distance: 1 }, fsAudio: fa, channels: [L], level: 95 }, null);
console.log('auralize linear driver (Doppler only) resid ratio', au2.stats.ratioDb.toFixed(1), 'dB');
