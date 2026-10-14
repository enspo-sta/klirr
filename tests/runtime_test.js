// Exercises the account-storage and download paths with a mock of the artifact runtime (window.claude.use).
// Run: npm run build && node tests/runtime_test.js
const { chromium } = require('playwright');
const path = require('path');
const SHOTS = path.resolve(__dirname, '..', 'shots'); require('fs').mkdirSync(SHOTS, { recursive: true });

const MOCK = `
(() => {
  // the mock database lives on the Node side so it survives reloads deterministically
  const store = {};
  const ready = window.__mockLoad().then((j) => Object.assign(store, JSON.parse(j || '{}')));
  const persist = () => window.__mockSave(JSON.stringify(store));
  const listeners = [];
  const segs = (p) => p.split('/');
  const SEG = /^[A-Za-z0-9_\\-.~:@+]+$/;
  function check(p, even) {
    const s = segs(p);
    if (s.some((x) => !SEG.test(x) || x === '.' || x === '..')) throw new TypeError('bad segment in ' + p);
    if ((s.length % 2 === 0) !== even) throw new TypeError('wrong parity (' + s.length + ') for ' + p);
  }
  const meta = { fromCache: false, hasPendingWrites: false };
  function snapOf(coll) {
    const n = segs(coll).length + 1;
    const docs = Object.keys(store).filter((k) => k.startsWith(coll + '/') && segs(k).length === n).sort()
      .map((k) => ({ id: segs(k).pop(), exists: true, data: () => Object.freeze(JSON.parse(JSON.stringify(store[k]))), metadata: meta }));
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta };
  }
  function notify(docPath) { const coll = segs(docPath).slice(0, -1).join('/'); for (const l of listeners) if (l.coll === coll) setTimeout(() => l.cb(snapOf(coll)), 5); }
  const err = (code, m) => Object.assign(new Error(m), { code });
  function docRef(p) {
    check(p, true);
    return {
      id: segs(p).pop(), path: p,
      get: async () => ({ id: segs(p).pop(), exists: p in store, data: () => store[p], metadata: meta }),
      set: async (data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw err('invalid_argument', 'body must be an object');
        if (JSON.stringify(data).length > 262144) throw err('invalid_argument', 'document over 256 KiB');
        store[p] = JSON.parse(JSON.stringify(data)); persist(); window.__writes = (window.__writes || 0) + 1; notify(p);
      },
      update: async () => { throw err('invalid_argument', 'not used'); },
      delete: async () => { delete store[p]; persist(); window.__deletes = (window.__deletes || 0) + 1; notify(p); },
      collection: (sub) => collRef(p + '/' + sub),
    };
  }
  function collRef(p) {
    check(p, false);
    return {
      path: p, doc: (id) => docRef(p + '/' + (id || Math.random().toString(36).slice(2))),
      get: async () => snapOf(p),
      onSnapshot: (cb) => { const l = { coll: p, cb }; listeners.push(l); setTimeout(() => cb(snapOf(p)), 25); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; },
    };
  }
  const db = { doc: docRef, collection: collRef };
  const user = { id: async () => 'u_mock42', isOwner: async () => true, canEdit: async () => true, can: async () => true };
  const downloads = { save: async ({ filename, data }) => { window.__downloads = (window.__downloads || []).concat([{ filename, bytes: typeof data === 'string' ? data.length : (data.size || data.byteLength) }]); return { status: 'saved' }; } };
  window.claude = { use: (name) => ready.then(() => new Promise((res) => setTimeout(() => res(name === 'db' ? db : name === 'user' ? user : name === 'downloads' ? downloads : null), 40))) };
  window.__store = store;
})();
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  let mockJson = '{}';
  await page.exposeFunction('__mockLoad', () => mockJson);
  await page.exposeFunction('__mockSave', (j) => { mockJson = j; });
  await page.addInitScript(MOCK);
  const url = 'file://' + path.resolve(__dirname, '..', 'dist', 'harness.html');
  await page.goto(url);
  await page.waitForFunction(() => /account/.test(document.querySelector('#store-state')?.textContent || ''), null, { timeout: 20000 });
  console.log('store state:', await page.textContent('#store-state'));
  const keys = () => page.evaluate(() => Object.keys(window.__store).sort());

  // 1. rename the first setup -> the whole example list is stored on the first edit
  await page.click('#tab-setups'); await page.waitForTimeout(300);
  await page.fill('#su-name', 'Mock renamed setup'); await page.dispatchEvent('#su-name', 'change');
  await page.waitForTimeout(1500);
  let k = await keys();
  const setupKeys = k.filter((x) => x.includes('/library/setups/'));
  console.log('setup docs after first edit:', setupKeys.length, '(local setups:', await page.evaluate(() => App.setups.length) + ')');
  const renamed = await page.evaluate(() => Object.entries(window.__store).find(([p, v]) => p.includes('/setups/') && v.name === 'Mock renamed setup'));
  console.log('renamed setup stored:', !!renamed, renamed ? renamed[0] : '');

  // 2. new driver, change a parameter
  await page.click('#tab-drivers'); await page.waitForTimeout(300);
  await page.click('#view-drivers button:has-text("New driver")'); await page.waitForTimeout(300);
  await page.fill('#dr-ts-Bl', '9.5'); await page.dispatchEvent('#dr-ts-Bl', 'change');
  await page.waitForTimeout(1500);
  k = await keys();
  const drvKeys = k.filter((x) => x.includes('/library/drivers/'));
  const blStored = await page.evaluate(() => Object.entries(window.__store).filter(([p]) => p.includes('/drivers/')).map(([p, v]) => v.ts && v.ts.Bl));
  console.log('driver docs:', drvKeys.length, 'Bl stored:', JSON.stringify(blStored));

  // 3. editable copy of a measured driver (large document with curves and measurements)
  await page.click('#view-drivers .drv-item:has-text("Purifi PTT8.0X04-NAB-02")'); await page.waitForTimeout(300);
  await page.click('#view-drivers button:has-text("Make an editable copy")'); await page.waitForTimeout(1500);
  const sizes = await page.evaluate(() => Object.entries(window.__store).filter(([p]) => p.includes('/drivers/')).map(([p, v]) => [v.label, JSON.stringify(v).length]));
  console.log('driver documents (label, bytes):', JSON.stringify(sizes));

  // 4. downloads: driver export and bundle export
  await page.click('#view-drivers .card-h .btn-row button:text-is("Export")'); await page.waitForTimeout(400);
  await page.click('#view-drivers summary:has-text("Import drivers or setups")'); await page.waitForTimeout(200);
  await page.click('#view-drivers button:has-text("Export yours")'); await page.waitForTimeout(400);
  console.log('downloads:', JSON.stringify(await page.evaluate(() => window.__downloads || [])));

  // 5. import a bundle with an unsafe id; it must be sanitised and the setup must follow it
  const bundle = JSON.stringify({ klirr: 1, drivers: [{ id: 'my driver/1 é', label: 'Imported test driver', model: 'Imported test driver', role: 'woofer', ts: { Re: 5.6, Le: 0.5, Bl: 8, Mms: 20, Cms: 0.9, Rms: 1.2, Sd: 150, Xmax: 6 }, nl: {} }],
    setups: [{ id: 'setup with spaces', name: 'Imported test setup', colorIdx: 3, active: false, space: 'half', ways: [{ driverId: 'my driver/1 é', count: 1, enclosure: { type: 'sealed', Vb: 12 } }] }] });
  await page.fill('#imp-text', bundle); await page.click('#view-drivers details button.primary:has-text("Import")'); await page.waitForTimeout(1500);
  console.log('import message:', await page.textContent('#view-drivers .card details p.hint'));
  const imp = await page.evaluate(() => { const d = App.userDrivers.find((x) => x.label === 'Imported test driver'); const s = App.setups.find((x) => x.name === 'Imported test setup'); return { did: d && d.id, sid: s && s.id, ref: s && s.ways[0].driverId, stored: Object.keys(window.__store).filter((p) => p.includes('mported') || (d && p.endsWith('/' + d.id)) || (s && p.endsWith('/' + s.id))) }; });
  console.log('imported ids:', JSON.stringify(imp));

  // 6. delete the new driver
  await page.click('#view-drivers .drv-item:has-text("New driver")'); await page.waitForTimeout(300);
  await page.click('#view-drivers .card-h .btn-row button.danger:text-is("Delete")'); await page.waitForTimeout(150);
  await page.click('#view-drivers .card-h .btn-row button.btn.sm.danger:not(.ghost)'); await page.waitForTimeout(800);
  console.log('driver docs after delete:', (await keys()).filter((x) => x.includes('/library/drivers/')).length, 'deletes:', await page.evaluate(() => window.__deletes || 0));

  // 7. reload with browser storage cleared: everything must come back from the account store
  console.log('mock store docs before reload:', await page.evaluate(() => Object.keys(window.__store).length), 'node-side bytes:', mockJson.length);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) localStorage.removeItem(k); });
  await page.reload();
  await page.waitForFunction(() => /account/.test(document.querySelector('#store-state')?.textContent || ''), null, { timeout: 20000 });
  console.log('mock store docs after reload:', await page.evaluate(() => Object.keys(window.__store).length), 'node-side bytes:', mockJson.length);
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ setups: App.setups.map((s) => s.name), drivers: App.userDrivers.map((d) => d.label), chip0: document.querySelector('#chips .chip .nm')?.textContent }));
  console.log('after reload:', JSON.stringify(after));
  if (after.chip0 !== 'Mock renamed setup' || !after.drivers.includes('Imported test driver')) errors.push('account data did not come back after a reload');
  // the analyses still run on the restored setups
  await page.click('#tab-distortion'); await page.waitForTimeout(200);
  await page.waitForFunction(() => /Finished/.test(document.querySelector('#view-distortion .status')?.textContent || ''), null, { timeout: 120000 });
  console.log('distortion after reload:', await page.textContent('#view-distortion .status'));
  console.log('errors/warnings:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
