// Exercises the setup and driver editors in the assembled page. Run: npm run build && node tests/editor_test.js
const { chromium } = require('playwright');
const path = require('path');
const SHOTS = path.resolve(__dirname, '..', 'shots'); require('fs').mkdirSync(SHOTS, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'dist', 'harness.html'));
  await page.waitForFunction(() => /Finished/.test(document.querySelector('#view-distortion .status')?.textContent || ''), null, { timeout: 120000 });
  const tiles = () => page.evaluate(() => [...document.querySelectorAll('#view-setups .tile')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()));
  const sel = async (id, v) => { await page.selectOption('#' + id, String(v)); await page.waitForTimeout(250); };
  const num = async (id, v) => { await page.fill('#' + id, String(v)); await page.dispatchEvent('#' + id, 'change'); await page.waitForTimeout(250); };

  // ---- setups: a new two-way setup with every enclosure type on the way
  await page.click('#tab-setups'); await page.waitForTimeout(300);
  await page.click('#view-setups button:has-text("New setup")'); await page.waitForTimeout(400);
  await num('su-name', 'Editor test two-way');
  await sel('su-drv-0', 'eac-ptt65x');
  await sel('su-enc-0', 'vented'); await num('su-vb-0', 20); await num('su-fb-0', 38); await num('su-pd-0', 70);
  console.log('vented tiles:', JSON.stringify(await tiles()));
  await sel('su-ps-0', 'slot'); await num('su-ph-0', 25); await num('su-pw-0', 180);
  console.log('slot tiles:', JSON.stringify(await tiles()));
  await sel('su-enc-0', 'pr'); await num('su-rs-0', 330); await num('su-rm-0', 90);
  console.log('radiator tiles:', JSON.stringify(await tiles()));
  await sel('su-enc-0', 'sealed'); await num('su-vb-0', 9);
  console.log('sealed tiles:', JSON.stringify(await tiles()));
  // low-pass on way 1, second way with a high-pass
  await page.click('#view-setups .card:has(#su-enc-0) summary:has-text("Filters")'); await page.waitForTimeout(150);
  await page.click('#view-setups .card:has(#su-enc-0) button:has-text("Add low-pass")'); await page.waitForTimeout(300);
  await num('su-ff-0-0', 2200);
  await page.click('#view-setups button:has-text("Add a way")'); await page.waitForTimeout(400);
  await sel('su-drv-1', 'eac-ptt4w'); await sel('su-enc-1', 'sealed'); await num('su-vb-1', 1.5);
  await page.click('#view-setups .card:has(#su-enc-1) summary:has-text("Filters")'); await page.waitForTimeout(150);
  await page.click('#view-setups .card:has(#su-enc-1) button:has-text("Add high-pass")'); await page.waitForTimeout(300);
  await num('su-ff-1-0', 2200);
  await page.click('#view-setups .card:has(#su-enc-1) summary:has-text("Drive and gain")'); await page.waitForTimeout(150);
  await num('su-g-1', -3); await num('su-rs2-1', 0.2); await num('su-dt-1', 40);
  const s = await page.evaluate(() => { const s = App.setups.find((x) => x.name === 'Editor test two-way'); return { active: s.active, ways: s.ways.map((w) => ({ d: w.driverId, enc: w.enclosure, filters: w.filters, gainDb: w.gainDb, Rs: w.Rs, dT: w.dT })) }; });
  console.log('setup stored:', JSON.stringify(s));
  console.log('two-way tiles:', JSON.stringify(await tiles()));
  await page.screenshot({ path: SHOTS + '/13-editor-twoway.png', fullPage: true });

  // ---- run every analysis with the new setup in the comparison
  const run = async (id) => {
    await page.click('#tab-' + id); await page.waitForTimeout(300);
    await page.click(`#view-${id} .btn.primary`); await page.waitForTimeout(300);
    await page.waitForFunction((id) => { const t = document.querySelector(`#view-${id} .status`); return t && /Finished|rror|Cancelled/.test(t.textContent); }, id, { timeout: 240000 });
    return page.textContent(`#view-${id} .status`);
  };
  // four setups compared: turn off the SB17 to keep the run short
  await page.click('#chips .chip:has-text("SB17CAC35-4")'); await page.waitForTimeout(200);
  console.log('compared:', JSON.stringify(await page.evaluate(() => activeSetups().map((s) => s.name))));
  console.log('distortion:', await run('distortion'));
  console.log('distortion table row:', await page.evaluate(() => [...document.querySelectorAll('#view-distortion table.t tbody tr')].map((r) => r.innerText.replace(/\s+/g, ' ')).find((t) => t.includes('Editor test'))));
  console.log('imd:', await run('imd'));
  console.log('multitone:', await run('multitone'));
  console.log('maxspl:', await run('maxspl'));
  await page.click('#tab-listen'); await page.waitForTimeout(300);
  await sel('ls-setup', await page.evaluate(() => App.setups.find((x) => x.name === 'Editor test two-way').id));
  await num('ls-dur', 3);
  console.log('listen:', await run('listen'));
  console.log('listen tiles:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#view-listen .tile')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()))));

  // ---- drivers: new driver from pasted datasheet text and pasted Klippel coefficients
  await page.click('#tab-drivers'); await page.waitForTimeout(300);
  await page.click('#view-drivers button:has-text("New driver")'); await page.waitForTimeout(400);
  await page.click('#view-drivers summary:has-text("Fill from pasted datasheet text")'); await page.waitForTimeout(150);
  await page.fill('#view-drivers details:has(summary:has-text("Fill from pasted")) textarea', 'Re 5.8 Ω\nLe 0.35 mH\nBl 7.2 Tm\nMms 18.5 g\nCms 0.95 mm/N\nRms 1.1 kg/s\nSd 132 cm²\nXmax 6 mm\nPe 80 W');
  await page.click('#view-drivers button:has-text("Fill parameters")'); await page.waitForTimeout(500);
  const ts = await page.evaluate(() => { const d = App.userDrivers[App.userDrivers.length - 1]; return d.ts; });
  console.log('ts after paste:', JSON.stringify(ts));
  await page.click('#view-drivers summary:has-text("Paste Klippel polynomial coefficients")'); await page.waitForTimeout(150);
  await page.fill('#view-drivers details:has(summary:has-text("Paste Klippel")) textarea', 'b0 7.2 b1 -0.05 b2 -0.035 b3 0.001 b4 -0.0004\nk0 1.05 k1 0.012 k2 0.006 k3 0.0002 k4 0.0003\nl0 0.35 l1 -0.018 l2 -0.0008');
  await num('dr-klr', 9);
  await page.click('#view-drivers button:has-text("Use coefficients")'); await page.waitForTimeout(600);
  const lim = await page.evaluate(() => [...document.querySelectorAll('#view-drivers table.t tbody tr')].slice(0, 4).map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
  console.log('limits after coefficients:', JSON.stringify(lim));
  await page.screenshot({ path: SHOTS + '/14-editor-driver.png', fullPage: true });
  // use it in a setup and simulate
  await page.click('#view-drivers button:has-text("New setup with this driver")'); await page.waitForTimeout(500);
  console.log('new setup from driver:', await page.evaluate(() => { const s = App.setups[App.setups.length - 1]; return s.name + ' · active ' + s.active; }));
  console.log('errors/warnings:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
