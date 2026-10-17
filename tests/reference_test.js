// Compares the engine with an independent harmonic-balance solution of the same model (research/reference).
// Run: node tests/reference_test.js. Regenerate the reference with python3 research/reference/run_reference.py.
const { run } = require('../research/reference/engine_points.js');
const ref = require('../research/reference/reference.json').cases;
const dB = (x) => 20 * Math.log10(x);
const failures = [], floorOnly = []; let worst = 0;
for (const { case: c, f, hb } of ref) {
  const e = run(c);
  if (Math.abs(e.f - f) > 1e-9) failures.push(`${c.name}: the engine now simulates ${e.f} Hz, the reference was solved at ${f} Hz; regenerate it`);
  const row = [];
  for (let k = 0; k < 4; k++) {
    const a = dB(e.hd[k]), b = dB(hb.hd[k]);
    if (b < -110) continue; // below the steady-state tolerance of the engine
    const d = a - b; worst = Math.max(worst, Math.abs(d)); row.push(`H${k + 2} ${a.toFixed(2)}/${b.toFixed(2)}`);
    if (Math.abs(d) <= 0.02) continue;
    // a difference whose own size is below -110 dB re the fundamental is below that tolerance too
    if (Math.abs(Math.pow(10, a / 20) - Math.pow(10, b / 20)) < Math.pow(10, -110 / 20)) { floorOnly.push(`${c.name} H${k + 2} ${d.toFixed(3)} dB`); continue; }
    failures.push(`${c.name}: H${k + 2} ${a.toFixed(3)} dB against ${b.toFixed(3)} dB`);
  }
  const dx = Math.abs(e.xdc - hb.xdc);
  if (dx > Math.max(2e-4, 0.01 * Math.abs(hb.xdc))) failures.push(`${c.name}: offset ${e.xdc.toFixed(4)} mm against ${hb.xdc.toFixed(4)} mm`);
  if (Math.abs(e.spl - hb.spl) > 0.01) failures.push(`${c.name}: fundamental ${e.spl.toFixed(3)} dB against ${hb.spl.toFixed(3)} dB`);
  console.log(`${c.name.padEnd(62)} ${row.join('  ')}  offset ${e.xdc.toFixed(4)}/${hb.xdc.toFixed(4)} mm`);
}
console.log(`${ref.length} cases, largest harmonic difference above -110 dB ${worst.toFixed(4)} dB`);
if (floorOnly.length) console.log('beyond 0.02 dB but smaller than -110 dB re the fundamental, so within the engine\'s tolerance: ' + floorOnly.join('; '));
if (failures.length) { console.log('Reference check failed:\n  ' + failures.join('\n  ')); process.exit(1); } else console.log('reference matches');
