/**
 * QA forecast screenshots (428×926 viewport). Fake data only.
 * Run: node scripts/forecast-qa-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8895;
const ROOT = '/workspace';
const OUT_DIRS = ['/opt/cursor/artifacts', '/cursor/stores/self/artifacts'];
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};
const VIEWPORT = { width: 428, height: 926 };

function server() {
  return createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p);
    if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
}

/** Month is 0-indexed (9 = October). */
function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

function seed() {
  const accounts = [
    {
      id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997',
      currentBalance: 2382.42, balanceAsOf: '2026-10-16',
      balanceHistory: { amount: 1904.1, asOf: '2026-10-02' }
    },
    { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
  ];
  const categories = [
    { id: 'income', name: 'Income', emoji: '💵', icon: 'circle-dot', color: '#34C77B' },
    { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
    { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
    { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
    { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }
  ];

  const entries = [];
  const push = (e) => entries.push(e);

  const payFridays = [
    ts(2026, 5, 6), ts(2026, 5, 20),
    ts(2026, 6, 3), ts(2026, 6, 17), ts(2026, 6, 31),
    ts(2026, 7, 14), ts(2026, 7, 28),
    ts(2026, 8, 11), ts(2026, 8, 25),
    ts(2026, 9, 9)
  ];
  payFridays.forEach((t, i) => {
    push({
      id: 'pay-' + i, amount: 2140, categoryId: 'income', note: 'Acme Corp payroll',
      ts: t, accountId: 'acct-checking', isDeposit: true
    });
  });

  [[2026, 6, 1], [2026, 7, 1], [2026, 8, 1], [2026, 9, 1]].forEach(([y, m, d], i) => {
    push({ id: 'rent-' + i, amount: 1650, categoryId: 'bills', note: 'Maple Court Apts', ts: ts(y, m, d), accountId: 'acct-checking' });
  });

  [ts(2026, 5, 22), ts(2026, 6, 22), ts(2026, 7, 22), ts(2026, 8, 22)].forEach((t, i) => {
    push({ id: 'duke-' + i, amount: 142.4, categoryId: 'bills', note: 'Duke Energy', ts: t, accountId: 'acct-checking' });
  });

  [
    ['chase-b1', 'chase-c1', ts(2026, 6, 8), ts(2026, 6, 7), 1488.2],
    ['chase-b2', 'chase-c2', ts(2026, 7, 8), ts(2026, 7, 7), 1725.5],
    ['chase-b3', 'chase-c3', ts(2026, 8, 8), ts(2026, 8, 7), 2284.75]
  ].forEach(([bid, cid, bts, cts, amt]) => {
    push({ id: bid, amount: amt, categoryId: 'bills', note: 'CREDIT CRD AUTOPAY', ts: bts, accountId: 'acct-checking', isTransfer: true, bankText: 'CREDIT CRD AUTOPAY' });
    push({ id: cid, amount: amt, categoryId: 'other', note: 'Payment Thank You', ts: cts, accountId: 'acct-chase', isTransfer: true });
  });

  const transferPairs = [
    { id: 'tp1', entryIds: ['chase-b1', 'chase-c1'], auto: true, unlinked: false, createdAt: Date.now() },
    { id: 'tp2', entryIds: ['chase-b2', 'chase-c2'], auto: true, unlinked: false, createdAt: Date.now() },
    { id: 'tp3', entryIds: ['chase-b3', 'chase-c3'], auto: true, unlinked: false, createdAt: Date.now() }
  ];

  [ts(2026, 6, 30), ts(2026, 7, 30), ts(2026, 8, 30)].forEach((t, i) => {
    push({
      id: 'sav-' + i, amount: 200, categoryId: 'other', note: 'Transfer to savings', ts: t,
      accountId: 'acct-checking', isTransfer: true, transferKind: 'other',
      bankText: 'ONLINE TRANSFER TO SAV ...4821'
    });
  });

  const debits = [
    ['coffee-1', 6.45, 'Starbucks', ts(2026, 9, 15)],
    ['coffee-2', 4.2, 'Dunkin', ts(2026, 9, 14)],
    ['coffee-3', 5.9, 'Starbucks', ts(2026, 9, 13)],
    ['groc-1', 54.3, 'Trader Joes', ts(2026, 9, 10)],
    ['groc-2', 61.2, 'Kroger', ts(2026, 9, 7)],
    ['lunch-1', 12.8, 'Chipotle', ts(2026, 9, 5)],
    ['gas-1', 38.5, 'Shell', ts(2026, 9, 2)],
    ['coffee-4', 6.1, 'Starbucks', ts(2026, 8, 30)],
    ['groc-3', 48.1, 'Kroger', ts(2026, 8, 27)],
    ['lunch-2', 9.5, 'Panera', ts(2026, 8, 24)],
    ['coffee-5', 5.5, 'Starbucks', ts(2026, 8, 21)],
    ['groc-4', 72.4, 'Trader Joes', ts(2026, 8, 18)],
    ['lunch-3', 11.2, 'Chipotle', ts(2026, 8, 15)],
    ['coffee-6', 4.8, 'Dunkin', ts(2026, 8, 12)],
    ['groc-5', 44.6, 'Kroger', ts(2026, 8, 9)],
    ['coffee-7', 6.2, 'Starbucks', ts(2026, 8, 6)],
    ['lunch-4', 13.4, 'Chipotle', ts(2026, 8, 3)],
    ['groc-6', 58.9, 'Trader Joes', ts(2026, 7, 31)]
  ];
  debits.forEach(([id, amt, note, t]) => {
    const cat = /starbucks|dunkin|chipotle|panera/i.test(note) ? 'dining' : /kroger|trader/i.test(note) ? 'groceries' : 'other';
    push({ id, amount: amt, categoryId: cat, note, ts: t, accountId: 'acct-checking' });
  });

  const transferPatterns = [{ id: 'pat1', pattern: 'online transfer to sav', createdAt: Date.now() }];
  return { accounts, entries, transferPairs, transferPatterns, categories };
}

async function shot(page, name) {
  for (const dir of OUT_DIRS) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, name) });
  }
}

async function run() {
  OUT_DIRS.forEach((d) => mkdirSync(d, { recursive: true }));
  const srv = server();
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });

  await page.addInitScript(() => {
    const t = new Date(2026, 9, 16, 14, 0, 0);
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(t.getTime());
        else super(...args);
      }
      static now() { return t.getTime(); }
    }
    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    window.Date = MockDate;
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  const data = seed();
  await page.evaluate((d) => {
    localStorage.clear();
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(d.categories));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(d.entries));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify(d.accounts));
    localStorage.setItem('expenseLogger.transferPairs.v1', JSON.stringify(d.transferPairs));
    localStorage.setItem('expenseLogger.transferPatterns.v1', JSON.stringify(d.transferPatterns));
    localStorage.setItem('expenseLogger.meta.v1', JSON.stringify({ forecastCushion: 600 }));
    localStorage.setItem('expenseLogger.budgets.v1', '{}');
    localStorage.setItem('expenseLogger.recurring.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.forecastOverrides.v1', '{}');
    localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'summary' }));
  }, data);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(350);

  await page.click('#homeForecastCard');
  await page.waitForSelector('#tab-forecast:not([hidden])');
  await page.waitForTimeout(400);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('.forecast-range-btn[data-forecast-days="60"]');
  await page.waitForTimeout(400);
  await shot(page, 'forecast-light.png');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  await page.click('.forecast-range-btn[data-forecast-days="60"]');
  await page.waitForTimeout(400);
  await shot(page, 'forecast-dark.png');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('.forecast-range-btn[data-forecast-days="90"]');
  await page.waitForTimeout(400);
  await shot(page, 'forecast-90d.png');

  console.log('Screenshots saved to', OUT_DIRS.join(', '));
  await browser.close();
  srv.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
