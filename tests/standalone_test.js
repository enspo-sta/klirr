// Checks the standalone build that GitHub Pages serves (dist/index.html): it loads without errors, runs the
// default comparison, keeps data in browser storage and saves files through ordinary downloads.
// Run: npm run build && node tests/standalone_test.js
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'dist', 'index.html'));
  await page.waitForFunction(() => /Finished/.test(document.querySelector('#view-distortion .status')?.textContent || ''), null, { timeout: 120000 });
  const info = await page.evaluate(() => ({ title: document.title, doctype: !!document.doctype, store: document.querySelector('#store-state').textContent, runtime: typeof window.claude }));
  console.log('page:', JSON.stringify(info), '·', await page.textContent('#view-distortion .status'));
  if (info.title !== 'Klirr' || !info.doctype) errors.push('standalone page is missing its title or doctype');
  if (!/browser/.test(info.store)) errors.push('expected browser storage, got: ' + info.store);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#view-distortion button:has-text("CSV")')]);
  const file = await dl.path(); const text = require('fs').readFileSync(file, 'utf8');
  console.log('download:', dl.suggestedFilename(), text.length, 'bytes, first line:', text.split('\n')[0].slice(0, 80));
  if (!/\.csv$/.test(dl.suggestedFilename()) || text.length < 100) errors.push('CSV download did not work');
  console.log('errors/warnings:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
  if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
