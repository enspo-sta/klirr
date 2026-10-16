// Runs the Klirr engine on the reference cases and prints one JSON array (used by run_reference.py and
// tests/reference_test.js). usage: node engine_points.js cases.json
const path = require('path');
const E = require(path.join(__dirname, '..', '..', 'engine.js')); const { API, util } = E;
const lib = require(path.join(__dirname, '..', '..', 'library.json'));
function run(c) {
  const drv = JSON.parse(JSON.stringify(lib.find((d) => d.id === c.driverId)));
  if (c.abs) drv.abs = c.abs;
  const setup = { id: 'x', space: 'half', distance: 1, ways: [{ driver: drv, count: 1, enclosure: c.enc || { type: 'ib' }, filters: [], drive: c.drive || 'voltage' }] };
  const cs = API.compileSetup(setup);
  const fs = API.chooseFs(cs, c.f * 10);
  const pt = util.hdPoint(cs, Object.assign({}, util.NL_ALL, c.flags || {}), fs, c.f, c.V, 5);
  return { name: c.name, f: pt.f, hd: pt.hd, xdc: pt.ways[0].xdc, xpk: pt.ways[0].xpk, spl: pt.spl, windows: pt.windows };
}
module.exports = { run };
if (require.main === module) {
  const cases = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(cases.map(run)));
}
