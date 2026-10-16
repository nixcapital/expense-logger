/**
 * QA screenshots for category icon picker 1.7.2 (428×926 @2x).
 * Run: node scripts/icon-picker-qa-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8894;
const OUT = process.env.ICON_PICKER_QA_OUT || join(process.cwd(), 'qa-screenshots', 'icon-picker');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const CATEGORIES = [
  { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
  { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
  { id: 'gas', name: 'Gas', icon: 'fuel', color: '#51cf66' },
  { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
  { id: 'fun', name: 'Fun', icon: 'ticket', color: '#f783ac' },
  { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }
];

function makeServer(root) {
  return createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = join(root, p);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
}

async function waitForRender(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    if (window.ExpenseIcons && window.ExpenseIcons.preloadIcons) {
      await new Promise((resolve) => window.ExpenseIcons.preloadIcons(resolve));
    }
  });
  await page.waitForTimeout(400);
}

async function boot(page) {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`http://127.0.0.1:${PORT}/index.html?v=icon-picker-qa`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate((cats) => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(cats));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([]));
    localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'settings' }));
  }, CATEGORIES);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const s = document.getElementById('splashScreen');
    return s && s.classList.contains('hide');
  }, { timeout: 15000 });
  await page.click('[data-tab="settings"]');
  await page.waitForSelector('#categoryList .settings-inset-entry');
  await waitForRender(page);
}

async function openEditGroceries(page) {
  await page.click('#categoryList [data-edit="groceries"]');
  await page.waitForSelector('#catModal.show');
  await page.waitForSelector('#iconPicker .icon-picker-option.selected');
  await waitForRender(page);
}

const server = makeServer(process.cwd());
mkdirSync(OUT, { recursive: true });
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 428, height: 926 },
  deviceScaleFactor: 2,
  colorScheme: 'light'
});
const page = await context.newPage();

await boot(page);
await page.locator('#categoryList').scrollIntoViewIfNeeded();
await waitForRender(page);
await page.screenshot({ path: join(OUT, 'settings-categories-context.png') });

await openEditGroceries(page);
await page.emulateMedia({ colorScheme: 'light' });
await waitForRender(page);
await page.screenshot({ path: join(OUT, '1-picker-light.png') });

await page.emulateMedia({ colorScheme: 'dark' });
await waitForRender(page);
await page.screenshot({ path: join(OUT, '2-picker-dark.png') });

await page.click('#catCancelBtn');
await page.waitForSelector('#catModal:not(.show)');
await page.emulateMedia({ colorScheme: 'light' });
await page.click('#addCategoryBtn');
await page.waitForSelector('#catModal.show');
await page.fill('#catNameInput', 'Coffee');
await page.click('#iconPicker .icon-picker-option[data-icon-id="coffee"]');
await page.click('#colorSwatches .color-swatch[data-color="#ff922b"]');
await waitForRender(page);
await page.screenshot({ path: join(OUT, '3-picker-selected.png') });

await browser.close();
server.close();
console.log('Wrote icon picker QA screenshots to', OUT);
