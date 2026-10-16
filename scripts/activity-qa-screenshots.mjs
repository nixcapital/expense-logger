/**
 * QA screenshots for Activity time-range chips (428x926).
 * Run: node scripts/activity-qa-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8893;
const OUT = join(process.cwd(), 'qa-screenshots');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

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

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

const categories = [
  { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
  { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
  { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
  { id: 'gas', name: 'Gas', icon: 'fuel', color: '#51cf66' },
  { id: 'fun', name: 'Fun', icon: 'ticket', color: '#f783ac' }
];

const entries = [
  { id: 'a1', amount: 18.42, categoryId: 'dining', note: 'Panera Bread \u00B7 Lunch', ts: ts(2026, 9, 16) },
  { id: 'a2', amount: 45.85, categoryId: 'groceries', note: 'Whole Foods', ts: ts(2026, 9, 16) },
  { id: 'a3', amount: 12.5, categoryId: 'dining', note: 'Coffee shop', ts: ts(2026, 9, 15) },
  { id: 'a4', amount: 120, categoryId: 'bills', note: 'Electric bill', ts: ts(2026, 9, 14) },
  { id: 'a5', amount: 38.5, categoryId: 'gas', note: 'Shell', ts: ts(2026, 9, 10) },
  { id: 'a6', amount: 22, categoryId: 'fun', note: 'Movie tickets', ts: ts(2026, 9, 5) },
  { id: 'a7', amount: 55, categoryId: 'groceries', note: 'Trader Joe', ts: ts(2026, 8, 28) },
  { id: 'a8', amount: 200, categoryId: 'bills', note: 'Rent xfer', ts: ts(2026, 8, 20), isTransfer: true },
  { id: 'a9', amount: 89.2, categoryId: 'dining', note: 'Anniversary dinner', ts: ts(2026, 8, 8) },
  { id: 'a10', amount: 15, categoryId: 'groceries', note: 'Corner store', ts: ts(2026, 6, 12) },
  { id: 'a11', amount: 400, categoryId: 'bills', note: 'Insurance', ts: ts(2026, 2, 3) }
];

async function shot(page, name, range, colorScheme) {
  await page.emulateMedia({ colorScheme });
  await page.evaluate((rangeId) => {
    const ui = JSON.parse(localStorage.getItem('expenseLogger.ui.v1') || '{}');
    ui.tab = 'history';
    ui.activityRange = rangeId;
    localStorage.setItem('expenseLogger.ui.v1', JSON.stringify(ui));
  }, range);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-tab="history"]');
  await page.waitForSelector('.activity-summary-total');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, name), fullPage: false });
}

const server = makeServer(process.cwd());
mkdirSync(OUT, { recursive: true });
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 428, height: 926 },
  deviceScaleFactor: 2
});
const page = await context.newPage();

await page.goto(`http://127.0.0.1:${PORT}/index.html?v=qa`, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
});
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(({ categories, entries }) => {
  localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(categories));
  localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(entries));
  localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'history', activityRange: 'this-month' }));
}, { categories, entries });

await shot(page, 'activity-this-month-dark.png', 'this-month', 'dark');
await shot(page, 'activity-3-months-dark.png', '3-months', 'dark');
await page.waitForSelector('.activity-month-title');
await shot(page, 'activity-year-dark.png', 'year', 'dark');
await shot(page, 'activity-all-dark.png', 'all', 'dark');
await shot(page, 'activity-this-month-light.png', 'this-month', 'light');

await browser.close();
server.close();
console.log('Wrote QA screenshots to', OUT);
