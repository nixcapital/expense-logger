/**
 * Chase balance owed release screenshots — 428×926 viewport, DPR 2, SW blocked.
 * Run: node scripts/chase-balance-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8920;
const ROOT = '/workspace';
const OUT = '/opt/cursor/artifacts/chase-balance-180';
const VIEWPORT = { width: 428, height: 926 };
const MOCK_NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

function server() {
  return createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(readFileSync(file));
  });
}

function buildSeed() {
  const entries = [];
  const push = (e) => entries.push(e);
  push({
    id: 'pay-b',
    amount: 2410.55,
    categoryId: 'bills',
    note: 'CHASE CREDIT CRD AUTOPAY',
    ts: ts(2026, 9, 3),
    isTransfer: true,
    accountId: 'acct-checking'
  });
  push({
    id: 'pay-c',
    amount: 2410.55,
    categoryId: 'bills',
    note: 'Payment Thank You',
    ts: ts(2026, 9, 3),
    isTransfer: true,
    accountId: 'acct-chase',
    isDeposit: true
  });
  const purchases = [
    [7.75, 'Blue Bottle Coffee', 16, 'dining'],
    [84.12, "Trader Joe's", 15, 'groceries'],
    [41.85, 'Shell', 13, 'gas']
  ];
  purchases.forEach(([amt, note, day, cat], i) => {
    push({ id: 'p' + i, amount: amt, categoryId: cat, note, ts: ts(2026, 9, day), accountId: 'acct-chase' });
  });
  push({ id: 'ref', amount: -28.25, categoryId: 'other', note: 'Amazon refund', ts: ts(2026, 9, 14), accountId: 'acct-chase' });
  for (let i = 0; i < 11; i++) {
    push({
      id: 'px' + i,
      amount: 100 + i,
      categoryId: 'dining',
      note: 'Purchase ' + (i + 1),
      ts: ts(2026, 9, 4 + (i % 10)),
      accountId: 'acct-chase'
    });
  }
  return {
    accounts: JSON.stringify([
      {
        id: 'acct-checking',
        name: 'Checking',
        type: 'bank',
        color: '#20C997',
        currentBalance: 3560,
        balanceAsOf: '2026-10-16'
      },
      {
        id: 'acct-chase',
        name: 'Chase card',
        type: 'credit_card',
        color: '#748FFC',
        currentBalance: 2410.55,
        balanceAsOf: '2026-10-01'
      }
    ]),
    entries: JSON.stringify(entries),
    pairs: JSON.stringify([{ id: 'tp1', entryIds: ['pay-b', 'pay-c'], auto: true, unlinked: false, createdAt: MOCK_NOW }])
  };
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name), fullPage: false });
}

async function openSettings(page) {
  await page.click('.tab-btn[data-tab="settings"]');
  await page.waitForTimeout(400);
}

mkdirSync(OUT, { recursive: true });
const seed = buildSeed();
const srv = server();
await new Promise((r) => srv.listen(PORT, r));

for (const scheme of ['light', 'dark']) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: scheme,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  await page.addInitScript((mockNow, storage) => {
    const RealDate = Date;
    function MockDate(...args) {
      if (args.length === 0) return new RealDate(mockNow);
      return new RealDate(...args);
    }
    MockDate.now = () => mockNow;
    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    window.Date = MockDate;
    localStorage.setItem('expenseLogger.accounts.v1', storage.accounts);
    localStorage.setItem('expenseLogger.entries.v1', storage.entries);
    localStorage.setItem('expenseLogger.transferPairs.v1', storage.pairs);
  }, MOCK_NOW, seed);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest && document.getElementById('versionLine'));

  await openSettings(page);
  await shot(page, `1-settings-${scheme}.png`);

  await page.evaluate(() => window.ExpenseLoggerTest.openChaseCardSheet());
  await page.waitForSelector('#chaseCardSheet.show');
  await page.waitForTimeout(350);
  await shot(page, `2-card-sheet-${scheme}.png`);
  await page.evaluate(() => document.getElementById('chaseCardSheet').classList.remove('show'));

  await page.evaluate(() => {
    window.ExpenseLoggerTest.openChaseBalanceSheet();
    const inp = document.getElementById('chaseBalanceAmountInput');
    inp.value = '1,309.42';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForSelector('#chaseBalanceSheet.show');
  await page.waitForTimeout(350);
  await shot(page, `3-set-balance-${scheme}.png`);
  await page.evaluate(() => document.getElementById('chaseBalanceSheet').classList.remove('show'));

  await page.evaluate(() => window.ExpenseLoggerTest.openForecastScreen());
  await page.waitForSelector('#tab-forecast:not([hidden])');
  await page.waitForTimeout(500);
  await shot(page, `4-forecast-${scheme}.png`);

  await browser.close();
}

const browserSafe = await chromium.launch();
const ctxSafe = await browserSafe.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  colorScheme: 'light',
  serviceWorkers: 'block'
});
await ctxSafe.addInitScript(() => {
  document.documentElement.style.setProperty('--safe-top', '47px');
  document.documentElement.style.setProperty('--safe-bottom', '34px');
});
const pageSafe = await ctxSafe.newPage();
await pageSafe.addInitScript((mockNow, storage) => {
  const RealDate = Date;
  function MockDate(...args) {
    if (args.length === 0) return new RealDate(mockNow);
    return new RealDate(...args);
  }
  MockDate.now = () => mockNow;
  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;
  window.Date = MockDate;
  localStorage.setItem('expenseLogger.accounts.v1', storage.accounts);
  localStorage.setItem('expenseLogger.entries.v1', storage.entries);
  localStorage.setItem('expenseLogger.transferPairs.v1', storage.pairs);
}, MOCK_NOW, seed);
await pageSafe.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await openSettings(pageSafe);
await pageSafe.evaluate(() => window.ExpenseLoggerTest.openChaseCardSheet());
await pageSafe.waitForSelector('#chaseCardSheet.show');
await shot(pageSafe, '2-card-sheet-safe-area-light.png');
await browserSafe.close();

srv.close();
console.log('chase-balance-screenshots: wrote to', OUT);
