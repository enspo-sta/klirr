// Headless browser test of the assembled Klirr page. Run: npm run build && node tests/ui_test.js
const { chromium } = require('playwright');
const path = require('path');
const SHOTS = path.resolve(__dirname, '..', 'shots'); require('fs').mkdirSync(SHOTS, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const junk = async (label) => {
    const bad = await page.evaluate(() => { const t = document.querySelector('main section:not([hidden])').innerText; return ['[object', 'undefined', 'NaN', 'Infinity'].filter((w) => t.includes(w)); });
    if (bad.length) errors.push(label + ' shows: ' + bad.join(', '));
  };
  const url = 'file://' + path.resolve(__dirname, '..', 'dist', 'harness.html');
  const t0 = Date.now();
  await page.goto(url);
  // auto-run of the default distortion comparison
  await page.waitForFunction(() => /Finished in|error|Cancelled/i.test(document.querySelector('#view-distortion .status')?.textContent || ''), null, { timeout: 120000 });
  console.log('distortion auto-run:', await page.textContent('#view-distortion .status'), 'after', Date.now() - t0, 'ms');
  // wait for the mechanism split too
  await page.waitForTimeout(500);
  await page.waitForFunction(() => { const s = document.querySelector('#view-distortion .status'); return s && /Finished/.test(s.textContent) && !document.querySelector('#view-distortion .btn.primary').disabled; }, null, { timeout: 120000 });
  await page.screenshot({ path: SHOTS + '/01-distortion.png', fullPage: true }); await junk('distortion');
  const clickTab = async (id) => { await page.click('#tab-' + id); await page.waitForTimeout(200); };
  const runAndWait = async (id, label) => {
    const t = Date.now();
    await page.click(`#view-${id} .btn.primary`);
    await page.waitForTimeout(300);
    await page.waitForFunction((id) => { const s = document.querySelector(`#view-${id} .status`); return s && /Finished|Cancelled|\berr/i.test(s.textContent + (s.classList.contains('err') ? ' err' : '')); }, id, { timeout: 180000 });
    console.log(label, ':', await page.textContent(`#view-${id} .status`), '(' + (Date.now() - t) + ' ms)');
  };
  await clickTab('imd'); await runAndWait('imd', 'imd');
  await page.screenshot({ path: SHOTS + '/02-imd.png', fullPage: true }); await junk('imd');
  await clickTab('multitone'); await runAndWait('multitone', 'multitone');
  await page.screenshot({ path: SHOTS + '/03-multitone.png', fullPage: true }); await junk('multitone');
  await clickTab('maxspl'); await runAndWait('maxspl', 'maxspl');
  await page.screenshot({ path: SHOTS + '/04-maxspl.png', fullPage: true }); await junk('maxspl');
  await clickTab('listen');
  await page.fill('#ls-dur', '6'); await page.dispatchEvent('#ls-dur', 'change');
  await runAndWait('listen', 'listen');
  await page.screenshot({ path: SHOTS + '/05-listen.png', fullPage: true }); await junk('listen');
  await clickTab('setups'); await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/06-setups.png', fullPage: true }); await junk('setups');
  await clickTab('drivers'); await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/07-drivers.png', fullPage: true }); await junk('drivers');
  await clickTab('guide'); await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + '/08-guide.png', fullPage: false }); await junk('guide');
  await page.click('#guide-toc button:nth-of-type(3)'); await page.waitForTimeout(900); await page.screenshot({ path: SHOTS + '/08b-guide-jump.png', fullPage: false });
  // hover over the distortion chart to exercise the tooltip
  await clickTab('distortion');
  const cv = await page.$('#view-distortion canvas');
  const bb = await cv.boundingBox(); await page.mouse.move(bb.x + bb.width * 0.3, bb.y + bb.height * 0.4); await page.waitForTimeout(150);
  await page.screenshot({ path: SHOTS + '/09-hover.png', clip: { x: bb.x - 10, y: bb.y - 10, width: bb.width + 20, height: bb.height + 80 } });
  // phone width
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  m.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await m.goto(url);
  await m.waitForFunction(() => /Finished in|error/i.test(document.querySelector('#view-distortion .status')?.textContent || ''), null, { timeout: 120000 });
  await m.waitForTimeout(800);
  await m.screenshot({ path: SHOTS + '/10-mobile-distortion.png', fullPage: false });
  const ow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log('mobile horizontal overflow px:', ow);
  if (ow > 0) errors.push('page scrolls sideways at phone width');
  await m.click('#tab-setups'); await m.waitForTimeout(400); await m.screenshot({ path: SHOTS + '/11-mobile-setups.png', fullPage: false });
  const ow2 = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log('mobile setups overflow px:', ow2);
  await m.click('#tab-drivers'); await m.waitForTimeout(400); await m.screenshot({ path: SHOTS + '/12-mobile-drivers.png', fullPage: false });
  console.log('mobile drivers overflow px:', await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
  console.log('errors/warnings:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
