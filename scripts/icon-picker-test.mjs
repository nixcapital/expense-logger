/**
 * Category icon picker: unselected tile fill matches --raised in light mode (Add + Edit).
 * Run: node scripts/icon-picker-test.mjs
 */
import assert from 'assert';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8898;
const LIGHT_RAISED = 'rgb(233, 237, 243)';
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml'
};

function server(root) {
  return createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = join(root, p);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
}

function sampleUnselectedTileBg(page) {
  return page.evaluate(() => {
    const tile = document.querySelector('#iconPicker .icon-picker-option:not(.selected)');
    if (!tile) return null;
    return getComputedStyle(tile).backgroundColor;
  });
}

async function boot(page) {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('splashScreen')?.classList.contains('hide'));
  await page.click('[data-tab="settings"]');
}

async function assertLightUnselectedTiles(page, label) {
  await page.emulateMedia({ colorScheme: 'light' });
  const bg = await sampleUnselectedTileBg(page);
  assert.strictEqual(bg, LIGHT_RAISED, label + ': unselected tile background');
}

const srv = server(process.cwd());
await new Promise((r) => srv.listen(PORT, r));

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 428, height: 926 } })).newPage();

await boot(page);

await page.click('[data-edit="groceries"]');
await page.waitForSelector('#catModal.show');
await assertLightUnselectedTiles(page, 'edit groceries');
await page.click('#catCancelBtn');

await page.emulateMedia({ colorScheme: 'dark' });
await page.click('#addCategoryBtn');
await page.waitForSelector('#catModal.show');
await page.fill('#catNameInput', 'Coffee');
await page.click('#iconPicker .icon-picker-option[data-icon-id="coffee"]');
await page.click('#colorSwatches .color-swatch[data-color="#ff922b"]');
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForFunction(() => {
  const tile = document.querySelector('#iconPicker .icon-picker-option:not(.selected)');
  return tile && getComputedStyle(tile).backgroundColor === 'rgb(233, 237, 243)';
});
await assertLightUnselectedTiles(page, 'add coffee after dark→light');

const sheetMetrics = await page.evaluate(() => {
  const sheet = document.querySelector('#catModal .cat-sheet-modal');
  const sw = document.querySelector('#colorSwatches .color-swatch');
  if (!sheet || !sw) return null;
  const sheetRect = sheet.getBoundingClientRect();
  const swRect = sw.getBoundingClientRect();
  const cs = getComputedStyle(sheet);
  return {
    sheetScrollTop: sheet.scrollTop,
    scrollable: sheet.scrollHeight > sheet.clientHeight + 1,
    maxHeight: cs.maxHeight,
    gapBottom: window.innerHeight - sheetRect.bottom,
    swatchToSheetBottom: sheetRect.bottom - swRect.bottom,
    sheetTop: sheetRect.top
  };
});
assert.ok(sheetMetrics, 'sheet metrics');
assert.strictEqual(sheetMetrics.sheetScrollTop, 0, 'category sheet scrollTop');
assert.strictEqual(sheetMetrics.maxHeight, 'none', 'category sheet max-height');
assert.ok(!sheetMetrics.scrollable, 'category sheet has no inner scroll');
assert.ok(sheetMetrics.swatchToSheetBottom >= 30, 'padding below swatches (px): ' + sheetMetrics.swatchToSheetBottom);
assert.ok(sheetMetrics.gapBottom >= 0, 'sheet within viewport bottom');

await browser.close();
srv.close();
console.log('icon-picker-test: PASS');
