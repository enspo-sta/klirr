// Import from the driver database (enspo-sta/elementval-drivers) in the assembled page: a driver file from database/drivers,
// several chosen at once, the viewer's JSON export, the older single drivers.json, and the files that hold no curves.
// The fixtures are made-up numbers in the database's formats: the database itself is private and is never copied here.
// Run: npm run build && node tests/import_test.js
const { chromium } = require('playwright');
const path = require('path');
const SHOTS = path.resolve(__dirname, '..', 'shots'); require('fs').mkdirSync(SHOTS, { recursive: true });

// ---- fixtures in the database's formats (EXTENDING.md and schema/kinds.json there)
const logF = (n, f0, f1) => Array.from({ length: n }, (_, i) => +(f0 * Math.pow(f1 / f0, i / (n - 1))).toFixed(2));
const curve = (fs, fn) => fs.map((x) => ({ x, y: +fn(x).toFixed(2) }));
const F = logF(25, 20, 20000);
const ratioSet = (o) => Object.assign({
  type: 'HD (orders) vs frequency @ 4 V', kind: 'hd-frequency', method: 'automated pixel reading', source: 'HiFiCompass (tw-1_0.3m_4v.png, automated reading)',
  confidence: 'medium', conditions: { drive_v: 4, distance_mm: 300, hpf: 'HPF2-50', lab: 'HiFiCompass', spl_db: 90 }, chartType: 'line',
  axes: { x: { label: 'Frequency', unit: 'Hz', scale: 'log' }, y: { label: 'Harmonic ratio', unit: 'dB re fund' } },
  calibration: { image: 'https://example.com/charts/tw-1_0.3m_4v.png' },
  source_remarks: [{ text: 'The bump at 150 Hz is the test baffle.', url: 'https://example.com/hfc-review', date: '2026-10-11' }],
  series: [{ name: 'H2', points: curve(F, () => -50) }, { name: 'H3', points: curve(F, () => -60) }, { name: 'H4', points: curve(F, () => -70) }, { name: 'H5', points: curve(F, () => -80) }, { name: 'THD', points: curve(F, () => -49) }],
}, o);
const record = {
  id: 'test-woofer-1', name: 'Testmaker TW-1 woofer', manufacturer: 'Testmaker', role: 'woofer',
  ts: { Z: 4, Re: 3.5, Le: 0.3, Fs: 40, Qms: 4, Qes: 0.4, Qts: 0.36, Vas: 20, Sd: 130, Bl: 6, Mms: 19, Xmax: 6, sens: 87, coil_mm: 30 }, // no Cms or Rms
  source: 'https://example.com/tw-1', datasheet: 'https://example.com/tw-1.pdf', updated: '2026-10-01',
  reviews: [{ source: 'HiFiCompass', title: 'Testmaker TW-1 woofer review', url: 'https://example.com/hfc-review' }],
  ts_note: 'Made-up numbers for a test.',
  measurements: [
    ratioSet({}), // A: as stored, dB re fundamental
    ratioSet({ type: 'HD (orders) vs frequency @ 4 V (first reading)', superseded_by: 'a fuller reading', series: [{ name: 'H2', points: curve(F, () => -10) }] }), // B
    { type: 'Fundamental and harmonics (SoundCheck) @ 94 dB (Figure 15)', kind: 'hd-frequency', method: 'SoundCheck', source: 'audioXpress Test Bench (Figure 15)', confidence: 'high',
      conditions: { lab: 'audioXpress', spl_db: 94, drive_v: 5, distance_mm: 100 }, axes: { x: { label: 'Frequency', unit: 'Hz' }, y: { label: 'SPL', unit: 'dB' } },
      series: [{ name: 'Fundamental', points: [{ x: 100, y: 90 }, { x: 1000, y: 100 }] }, { name: 'H2', points: [{ x: 50, y: 40 }, { x: 316.2278, y: 55 }, { x: 1000, y: 58 }] }, { name: 'H3', points: [{ x: 316.2278, y: 45 }] }] }, // C
    { type: 'Harmonic distortion D2 to D4 (level not stated)', kind: 'hd-frequency', method: 'ARTA', source: 'Stoneeh, YouTube abc (1:13)', confidence: 'medium',
      conditions: { lab: 'Stoneeh', distance_mm: 2000, level_not_stated: 'the video states neither the level nor the drive voltage' }, axes: { x: { label: 'Frequency', unit: 'Hz' }, y: { label: 'Harmonic', unit: '%' } },
      series: [{ name: 'H2', points: [{ x: 500, y: 1 }, { x: 1000, y: 0 }, { x: 2000, y: 10 }] }, { name: 'H3', points: [{ x: 500, y: 0.1 }] }] }, // D
    ratioSet({ type: 'HD @ 104 dB', source: 'audioXpress Test Bench (Figure 9)', conditions: { lab: 'audioXpress', spl_db: 104, drive_v: 7.02, spl_db_from_drive: 96, spl_note: 'stated as 104 dB; its 7.02 V gives 96 dB at 1 m', distance_mm: 100 }, source_remarks: undefined, calibration: undefined }), // E
    ratioSet({ type: 'HD (orders) vs frequency @ 4 V (near field 20 mm)', conditions: { drive_v: 4, distance_mm: 20, lab: 'HiFiCompass', spl_db: 90 } }), // F
    { type: 'Impedance', kind: 'impedance', source: 'HiFiCompass', conditions: { drive_v: 1 }, axes: { y: { label: 'Impedance', unit: 'ohm' } }, series: [{ name: '|Z|', points: curve(F, () => 4) }] }, // G
    ratioSet({ type: 'HD, two drivers', source: 'Calculated from the single record\'s curves (see note)', conditions: { spl_db: 90 } }), // H
    ratioSet({ type: 'THD @ 2.8 V (level sweep)', series: [{ name: 'THD', points: curve(F, () => -45) }] }), // J
  ],
};
const exportFile = {
  exported: '2026-10-16', from: 'driver database viewer', measurements: [
    { driver: { id: record.id, name: record.name, manufacturer: record.manufacturer, ts: record.ts }, source: 'HiFiCompass', set: ratioSet({ type: 'HD (orders) vs frequency @ 8 V', conditions: { drive_v: 8, distance_mm: 300, hpf: 'HPF2-50', lab: 'HiFiCompass', spl_db: 96 } }) }, // I: new
    { driver: { id: record.id, name: record.name, manufacturer: record.manufacturer, ts: record.ts }, source: 'HiFiCompass', set: ratioSet({ series: [{ name: 'H2', points: curve(F, () => -52) }, { name: 'H3', points: curve(F, () => -62) }] }) }, // A again, read anew
    { driver: { id: record.id, name: record.name, manufacturer: record.manufacturer, ts: record.ts }, source: 'HiFiCompass', set: Object.assign(ratioSet({ type: 'HD @ 4 V of the TW-0' }), { stand_in_from: 'test-woofer-0' }) },
    { driver: { id: 'test-tweeter-2', name: 'Testmaker TT-2 *', manufacturer: 'Testmaker', ts: { Re: 3.2, Le: 0.03, Fs: 700, Qms: 2, Qes: 1, Mms: 0.4, Sd: 8, Bl: 3 } }, source: 'Manufacturer datasheet', set: ratioSet({ type: 'HD vs frequency (datasheet Figure 6)', source: 'Purifi datasheet TT-2, Fig.6', conditions: { spl_db: 94, distance_mm: 1000, lab: 'Purifi' } }) },
  ],
};
const oldFile = { drivers: [{ id: 'old-1', name: 'Old style driver', manufacturer: 'Oldmaker', ts: { Re: 6, Fs: 50, Qms: 3, Qes: 0.5, Vas: 10, Sd: 100, Bl: 7 }, measurements: [ratioSet({ conditions: { spl_db: 94 } })] }] };
const bigRecord = { id: 'test-big', name: 'Testmaker Big', manufacturer: 'Testmaker', ts: record.ts,
  measurements: Array.from({ length: 40 }, (_, i) => ratioSet({ type: 'HD @ level ' + i, conditions: { spl_db: 70 + i, lab: 'HiFiCompass' }, series: ['H2', 'H3'].map((name) => ({ name, points: curve(logF(500, 20, 20000), (x) => -40 - 10 * Math.log10(x) - i / 7) })) })) };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [], fails = [];
  const check = (ok, what, got) => { console.log((ok ? 'ok   ' : 'FAIL ') + what + (got !== undefined ? ': ' + (typeof got === 'string' ? got : JSON.stringify(got)) : '')); if (!ok) fails.push(what); };
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'dist', 'harness.html'));
  await page.waitForFunction(() => /Finished/.test(document.querySelector('#view-distortion .status')?.textContent || ''), null, { timeout: 120000 });
  await page.click('#tab-drivers'); await page.waitForTimeout(300);
  await page.click('#view-drivers summary:has-text("Import drivers or setups")'); await page.waitForTimeout(200);
  const importJson = async (obj) => { await page.fill('#imp-text', typeof obj === 'string' ? obj : JSON.stringify(obj)); await page.click('#view-drivers details button.primary:has-text("Import")'); await page.waitForTimeout(400); return page.textContent('#imp-msg'); };
  const driver = (id) => page.evaluate((id) => JSON.parse(JSON.stringify(App.userDrivers.find((d) => d.id === id) || null)), id);
  const at = (m, hn, x) => { const p = m && m.series[hn] && m.series[hn].find((q) => Math.abs(q[0] - x) < 1e-6); return p ? p[1] : null; };

  // 1. one driver file from database/drivers
  let msg = await importJson(record);
  console.log('message:', msg);
  check(/1 driver with 5 harmonic distortion sets/.test(msg), 'driver file: five harmonic sets taken', msg);
  check(/1 superseded set/.test(msg) && /1 calculated set/.test(msg) && /1 set of a kind Klirr does not draw/.test(msg) && /1 set with total harmonic distortion only/.test(msg), 'driver file: superseded, calculated, impedance and THD-only sets left out and said so');
  let d = await driver('db-test-woofer-1');
  check(!!d, 'driver file: stored as db-test-woofer-1');
  check(d.label === 'Testmaker TW-1 woofer' && d.brand === 'Testmaker' && d.model === 'TW-1 woofer' && d.role === 'woofer', 'driver file: name, maker, model and role', [d.label, d.brand, d.model, d.role]);
  check(d.ts.Re === 3.5 && d.ts.Le === 0.3 && d.ts.Bl === 6 && d.ts.Mms === 19 && d.ts.Sd === 130 && d.ts.Xmax === 6, 'driver file: published parameters kept as they are', d.ts);
  check(Math.abs(d.ts.Cms - 0.833) < 0.01 && Math.abs(d.ts.Rms - 2 * Math.PI * 40 * 0.019 / 4) < 0.005, 'driver file: Cms from Vas and Sd, Rms from Fs, Mms and Qms', [d.ts.Cms, d.ts.Rms]);
  check(!('Fs' in d.ts) && !('Z' in d.ts) && !('sens' in d.ts) && !('coil_mm' in d.ts), 'driver file: only the parameters Klirr uses are stored', Object.keys(d.ts));
  check(/Cms, Rms were calculated by Klirr/.test(d.notes) && /Made-up numbers/.test(d.notes), 'driver file: notes say which parameters Klirr calculated', d.notes);
  check(d.sources[0].url === 'https://elementval-drivers.pages.dev/#driver/test-woofer-1' && /^\d{4}-\d{2}-\d{2}$/.test(d.sources[0].retrieved), 'driver file: credited to the driver page on the viewer, with the date', d.sources[0]);
  check(!JSON.stringify(d).includes('enspo-sta.github.io/elementval-drivers'), 'driver file: the old address is gone');
  check(d.sources.some((s) => s.url === 'https://example.com/tw-1.pdf') && d.sources.some((s) => s.url === 'https://example.com/hfc-review'), 'driver file: datasheet and review linked');
  const lab = (re) => d.measurements.find((m) => re.test(m.label));
  const A = lab(/^HiFiCompass, 90 dB at 1 m \(4 V\), high-pass HPF2-50$/);
  check(!!A && at(A, 'H2', 20) === -50 && at(A, 'H3', 20) === -60 && !A.series.H4 && A.level_db === 90, 'ratio set: stored as published, H2 and H3', A && A.label);
  check(!!A && A.image === 'https://example.com/charts/tw-1_0.3m_4v.png' && /bump at 150 Hz/.test(A.conditions) && d.sources.find((s) => s.sid === A.source).url === 'https://example.com/hfc-review', 'ratio set: chart image, the source\'s remark and its review linked');
  const C = lab(/^audioXpress, 94 dB/);
  check(!!C && Math.abs(at(C, 'H2', 316.2278) - -40) < 0.01 && at(C, 'H2', 1000) === -42 && at(C, 'H2', 50) === null && Math.abs(at(C, 'H3', 316.2278) - -50) < 0.01, 'sound-pressure set: relative to its own fundamental, nothing read outside it', C && C.series);
  const D = lab(/^Stoneeh, level not stated/);
  check(!!D && at(D, 'H2', 500) === -40 && at(D, 'H2', 2000) === -20 && at(D, 'H2', 1000) === null && at(D, 'H3', 500) === -60 && D.level_db == null, 'percent set: in dB, zero left out, level not stated', D && D.series);
  const E = lab(/^audioXpress, 96 dB at 1 m from its 7.02 V \(stated as 104 dB\)/);
  check(!!E && E.level_db === 96, 'level stated against its drive voltage: compared at the voltage\'s level, both said', E && E.label);
  const Fn = lab(/near field 20 mm/);
  check(!!Fn && Fn.level_db === 90, 'near-field set: named so, its level not corrected', Fn && Fn.label);
  check(d.measurements.every((m) => m.kind === 'hd' && /^[^|]*\|/.test(m.dbKey)), 'every overlay is a harmonic overlay with its database key');
  check(JSON.stringify(d).length < 262144, 'driver file: the saved driver fits one account document', JSON.stringify(d).length);

  // 2. the viewer's export adds to it: a new level, a set read anew, a stand-in's set left out, a second driver
  await page.evaluate(() => { const d = App.userDrivers.find((x) => x.id === 'db-test-woofer-1'); d.nl = { bl: { type: 'poly', coef: [6, -0.05, -0.02], range: 8 } }; persistDriver(d); });
  msg = await importJson(exportFile);
  console.log('message:', msg);
  check(/2 drivers \(1 imported before, now updated\) with 3 harmonic distortion sets/.test(msg) && /1 set measured on another driver/.test(msg), 'export: two drivers, three sets, the stand-in\'s set left out', msg);
  d = await driver('db-test-woofer-1');
  check(d.measurements.length === 6, 'export: added to the earlier import (5 kept or replaced, 1 new)', d.measurements.map((m) => m.label));
  const A2 = d.measurements.find((m) => /^HiFiCompass, 90 dB at 1 m \(4 V\), high-pass/.test(m.label));
  check(!!A2 && at(A2, 'H2', 20) === -52, 'export: a set read anew replaces the earlier one', A2 && at(A2, 'H2', 20));
  check(d.measurements.some((m) => /^HiFiCompass, 96 dB at 1 m \(8 V\)/.test(m.label)), 'export: the new level is there');
  check(!d.measurements.some((m) => /TW-0/.test(m.conditions)), 'export: no set measured on another driver');
  check(!!d.nl.bl && d.sources[0].retrieved === '2026-10-16', 'export: large-signal curves added in Klirr kept; dated by the export', [d.nl, d.sources[0].retrieved]);
  const t2 = await driver('db-test-tweeter-2');
  check(!!t2 && t2.label === 'Testmaker TT-2' && t2.measurements.length === 1 && /^Purifi, 94 dB at 1 m/.test(t2.measurements[0].label), 'export: second driver, the viewer\'s stand-in mark taken off the name', t2 && [t2.label, t2.measurements.map((m) => m.label)]);
  check(!!t2 && Math.abs(t2.ts.Cms - 1 / (Math.pow(2 * Math.PI * 700, 2) * 0.0004) * 1e3) < 1e-4 && !/lack moving mass/.test(msg), 'export: compliance from Fs and Mms where the record has neither Cms nor Vas', t2 && t2.ts);

  // 3. the driver file again: it is the whole record, so it replaces what the export added, keeping Klirr's own curves
  msg = await importJson(record);
  d = await driver('db-test-woofer-1');
  check(d.measurements.length === 5 && !!d.nl.bl, 'driver file again: the record replaces the sets, Klirr\'s large-signal curves stay', [d.measurements.length, !!d.nl.bl]);

  // 4. several driver files chosen at once
  const big = Object.assign({}, record, { id: 'test-woofer-3', name: 'Testmaker TW-3 woofer' });
  await page.setInputFiles('#imp-file', [{ name: 'test-woofer-3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(big, null, 1)) }, { name: 'test-big.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bigRecord)) }]);
  await page.waitForFunction(() => document.querySelector('#imp-text').value.length > 1000);
  await page.click('#view-drivers details button.primary:has-text("Import")'); await page.waitForTimeout(400);
  msg = await page.textContent('#imp-msg');
  console.log('message:', msg);
  check(/^Imported 2 driver\(s\)/.test(msg) && /larger than 256 KB/.test(msg), 'several files: both imported; sets that would overfill the saved driver left out and said so', msg);
  const bigD = await driver('db-test-big');
  check(!!bigD && bigD.measurements.length > 0 && bigD.measurements.length < 40 && JSON.stringify(bigD).length < 262144, 'large record: fits one account document', bigD && [bigD.measurements.length, JSON.stringify(bigD).length]);

  // 5. the older single drivers.json
  msg = await importJson(oldFile);
  d = await driver('db-old-1');
  check(!!d && d.measurements.length === 1 && d.ts.Bl === 7 && d.ts.Mms > 0 && d.ts.Rms > 0 && d.ts.Cms > 0, 'older drivers.json: still imported, parameters completed', d && d.ts);

  // 6. the database's files without curves are named, not imported
  msg = await importJson({ meta: {}, drivers: ['test-woofer-1'], comparisons: [] });
  check(/index\.json/.test(msg), 'index.json: explained', msg);
  msg = await importJson({ about: 'Every record without its curves\' points', drivers: [{ id: 'x', name: 'X', ts: {}, measurements: [] }] });
  check(/summary\.json/.test(msg) && !(await driver('db-x')), 'summary.json: explained, nothing imported', msg);

  // 7. Klirr's own formats still import
  msg = await importJson({ klirr: 1, drivers: [{ id: 'k1', label: 'Klirr test driver', model: 'K1', ts: { Re: 5, Le: 0.4, Bl: 7, Mms: 15, Cms: 1, Rms: 1, Sd: 130, Xmax: 5 }, nl: {} }], setups: [] });
  check(/^Imported 1 driver\(s\)\.$/.test(msg) && !!(await driver('k1')), 'Klirr export: unchanged', msg);

  // 8. the provenance and the overlay in Distortion
  await page.click('#view-drivers .drv-item:has-text("Testmaker TW-1 woofer")'); await page.waitForTimeout(300);
  const links = await page.evaluate(() => [...document.querySelectorAll('#view-drivers a')].map((a) => a.href));
  check(links.includes('https://elementval-drivers.pages.dev/#driver/test-woofer-1'), 'Drivers: provenance links the driver page in the database\'s viewer');
  await page.screenshot({ path: SHOTS + '/20-import-database-driver.png', fullPage: true });
  await page.click('#view-drivers button:has-text("New setup with this driver")'); await page.waitForTimeout(500);
  await page.click('#tab-distortion'); await page.waitForTimeout(400);
  const opts = await page.evaluate(() => [...document.querySelectorAll('#hd-overlay option')].map((o) => [o.value, o.textContent]));
  const opt = opts.find((o) => /Testmaker TW-1 woofer: HiFiCompass, 90 dB at 1 m \(4 V\), high-pass/.test(o[1]));
  check(!!opt, 'Distortion: the imported set is offered as an overlay', opts.map((o) => o[1]));
  if (opt) {
    await page.selectOption('#hd-overlay', opt[0]); await page.waitForTimeout(400);
    const ids = await page.evaluate(() => App._hdPlot.series.map((s) => s.id));
    const note = await page.evaluate(() => [...document.querySelectorAll('#view-distortion p.hint')].map((p) => p.innerText).find((t) => /^Grey:/.test(t)) || '');
    check(ids.includes('measH2') && ids.includes('measH3'), 'Distortion: measured H2 and H3 drawn', ids.filter((i) => /^meas/.test(i)));
    check(/HiFiCompass review/.test(note) && /original plot/.test(note) && !/Pixel-extracted/.test(note) && /\(90\.0 dB at 1 m\)/.test(note), 'Distortion: the note links the review and the chart and gives the level', note);
    await page.screenshot({ path: SHOTS + '/21-import-database-overlay.png', fullPage: true });
  }

  // 9. outside Claude, a full browser store is said, not passed over in silence
  const mode = await page.evaluate(() => Store.mode);
  await page.evaluate(() => { const set = Storage.prototype.setItem; window.__setItem = set; Storage.prototype.setItem = function (k, v) { if (k === 'klirr.v1.drivers') throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); }; });
  await page.click('#tab-drivers'); await page.waitForTimeout(300);
  msg = await page.evaluate((t) => importText(t), JSON.stringify(Object.assign({}, record, { id: 'test-woofer-4' })));
  await page.evaluate(() => { Storage.prototype.setItem = window.__setItem; });
  check(mode === 'local' && /storage is full/.test(msg), 'browser storage full: said in the message', [mode, msg]);

  console.log('errors/warnings:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
  console.log(fails.length ? fails.length + ' check(s) failed' : 'all checks passed');
  if (errors.length || fails.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
