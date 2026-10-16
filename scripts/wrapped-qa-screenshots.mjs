/**
 * QA screenshots for Spending Wrapped 1.7.0 (428x926). Not committed.
 * Run: node scripts/wrapped-qa-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8898;
const OUT_DIRS = [
  '/opt/cursor/artifacts/wrapped-17',
  '/cursor/stores/self/artifacts/wrapped-17'
];
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
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(readFileSync(file));
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
  { id: 'fun', name: 'Fun', icon: 'ticket', color: '#f783ac' },
  { id: 'other', name: 'Other', icon: 'boxes', color: '#868e96' }
];

const accounts = [
  { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997' },
  { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
];

const budgets = {
  groceries: 550,
  gas: 200,
  other: 400,
  bills: 600,
  dining: 500,
  fun: 250
};

const recurringItems = [
  { id: 'r-duke', amount: 142.4, categoryId: 'bills', dayOfMonth: 15 },
  { id: 'r-verizon', amount: 89.99, categoryId: 'bills', dayOfMonth: 8 },
  { id: 'r-netflix', amount: 15.99, categoryId: 'fun', dayOfMonth: 12 },
  { id: 'r-spotify', amount: 12.99, categoryId: 'fun', dayOfMonth: 4 }
];

function starbucks(i, day) {
  return { id: 'sb' + i, amount: 5.61, categoryId: 'dining', note: 'STARBUCKS #' + (4400 + i), ts: ts(2026, 8, day), accountId: 'acct-chase' };
}

const entries = [
  { id: 'xfer-c', amount: 1250, categoryId: 'bills', note: 'CHASE CRD AUTOPAY', ts: ts(2026, 8, 15), isTransfer: true, accountId: 'acct-checking' },
  { id: 'xfer-ch', amount: 1250, categoryId: 'bills', note: 'Payment Thank You', ts: ts(2026, 8, 16), isTransfer: true, accountId: 'acct-chase' },
  starbucks(1, 2), starbucks(2, 4), starbucks(3, 6), starbucks(4, 8), starbucks(5, 10),
  starbucks(6, 12), starbucks(7, 14), starbucks(8, 16), starbucks(9, 18), starbucks(10, 20),
  starbucks(11, 22), starbucks(12, 24), starbucks(13, 26), starbucks(14, 28),
  { id: 'coffee1', amount: 4.5, categoryId: 'dining', note: 'Blue Bottle Coffee', ts: ts(2026, 8, 5), accountId: 'acct-chase' },
  { id: 'coffee2', amount: 4.75, categoryId: 'dining', note: 'Blue Bottle', ts: ts(2026, 8, 19), accountId: 'acct-chase' },
  { id: 'coffee3', amount: 5.2, categoryId: 'dining', note: 'Dunkin', ts: ts(2026, 8, 21), accountId: 'acct-chase' },
  { id: 'coffee4', amount: 5.9, categoryId: 'dining', note: 'Peet\'s Coffee', ts: ts(2026, 8, 25), accountId: 'acct-chase' },
  { id: 'sg', amount: 14.2, categoryId: 'dining', note: 'Sweetgreen', ts: ts(2026, 8, 7), accountId: 'acct-chase' },
  { id: 'rei', amount: 89.5, categoryId: 'other', note: 'REI', ts: ts(2026, 8, 9), accountId: 'acct-chase' },
  { id: 'joe', amount: 18.5, categoryId: 'dining', note: 'Joe\'s Pizza', ts: ts(2026, 8, 11), accountId: 'acct-chase' },
  { id: 'lyft', amount: 22.4, categoryId: 'other', note: 'Lyft', ts: ts(2026, 8, 13), accountId: 'acct-chase' },
  { id: 'costco', amount: 286.14, categoryId: 'groceries', note: 'Costco', ts: ts(2026, 8, 13), accountId: 'acct-chase' },
  { id: 'shell', amount: 35.06, categoryId: 'gas', note: 'Shell', ts: ts(2026, 8, 13), accountId: 'acct-chase' },
  { id: 'chip', amount: 20, categoryId: 'dining', note: 'Chipotle', ts: ts(2026, 8, 13), accountId: 'acct-chase' },
  { id: 'max', amount: 16.99, categoryId: 'fun', note: 'Max', ts: ts(2026, 8, 4), accountId: 'acct-chase' },
  { id: 'spot-sep', amount: 12.99, categoryId: 'fun', note: 'Spotify', ts: ts(2026, 8, 4), recurringId: 'r-spotify', accountId: 'acct-chase' },
  { id: 'spot-aug', amount: 11.99, categoryId: 'fun', note: 'Spotify', ts: ts(2026, 7, 4), recurringId: 'r-spotify', accountId: 'acct-chase' },
  { id: 'duke-sep', amount: 142.4, categoryId: 'bills', note: 'Duke Energy', ts: ts(2026, 8, 15), recurringId: 'r-duke', accountId: 'acct-checking' },
  { id: 'duke-aug', amount: 142.4, categoryId: 'bills', note: 'Duke Energy', ts: ts(2026, 7, 15), recurringId: 'r-duke', accountId: 'acct-checking' },
  { id: 'ver-sep', amount: 89.99, categoryId: 'bills', note: 'Verizon', ts: ts(2026, 8, 8), recurringId: 'r-verizon', accountId: 'acct-checking' },
  { id: 'ver-aug', amount: 89.99, categoryId: 'bills', note: 'Verizon', ts: ts(2026, 7, 8), recurringId: 'r-verizon', accountId: 'acct-checking' },
  { id: 'nf-sep', amount: 15.99, categoryId: 'fun', note: 'Netflix', ts: ts(2026, 8, 12), recurringId: 'r-netflix', accountId: 'acct-chase' },
  { id: 'nf-aug', amount: 15.99, categoryId: 'fun', note: 'Netflix', ts: ts(2026, 7, 12), recurringId: 'r-netflix', accountId: 'acct-chase' }
];

// Scale prior months for bar chart / comparisons
['dining', 'groceries', 'bills', 'gas', 'fun', 'other'].forEach((cat, ci) => {
  [5, 6, 7].forEach((mo, mi) => {
    const base = 400 + ci * 80 + mi * 35;
    entries.push({
      id: 'bulk-' + mo + '-' + cat,
      amount: Math.round(base * 10) / 10,
      categoryId: cat,
      note: 'Month spread ' + cat,
      ts: ts(2026, mo, 10 + ci),
      accountId: ci % 2 ? 'acct-chase' : 'acct-checking'
    });
  });
});

for (const dir of OUT_DIRS) mkdirSync(dir, { recursive: true });

const server = makeServer(process.cwd());
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 428, height: 926 } });

const seed = { categories, entries, accounts, budgets, recurringItems };
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate((seed) => {
  localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(seed.categories));
  localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(seed.entries));
  localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify(seed.accounts));
  localStorage.setItem('expenseLogger.budgets.v1', JSON.stringify(seed.budgets));
  localStorage.setItem('expenseLogger.recurring.v1', JSON.stringify(seed.recurringItems));
  localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'report' }));
}, seed);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.waitForFunction(() => {
  const splash = document.getElementById('splashScreen');
  const lock = document.getElementById('lockScreen');
  const splashGone = !splash || splash.style.display === 'none' || splash.classList.contains('hide');
  const lockGone = !lock || lock.hidden;
  return splashGone && lockGone;
}, { timeout: 10000 });

async function shot(name, scheme) {
  if (scheme) await page.emulateMedia({ colorScheme: scheme });
  await page.waitForTimeout(350);
  for (const dir of OUT_DIRS) {
    await page.screenshot({ path: join(dir, name), fullPage: false });
  }
}

await page.emulateMedia({ colorScheme: 'dark' });
await page.click('[data-tab="report"]');
await page.waitForSelector('#openWrappedBtn', { state: 'visible' });
await page.evaluate(() => {
  document.getElementById('reportMonth').value = '2026-09';
});
await page.click('#openWrappedBtn');
await page.waitForSelector('#wrappedModal.show');
await page.waitForTimeout(500);

const slideCount = await page.evaluate(() => {
  return window.ExpenseWrapped.buildWrappedData({
    entries: JSON.parse(localStorage.getItem('expenseLogger.entries.v1')),
    categories: JSON.parse(localStorage.getItem('expenseLogger.categories.v1')),
    budgets: JSON.parse(localStorage.getItem('expenseLogger.budgets.v1')),
    recurringItems: JSON.parse(localStorage.getItem('expenseLogger.recurring.v1')),
    accounts: JSON.parse(localStorage.getItem('expenseLogger.accounts.v1')),
    y: 2026,
    m: 8
  }).slides.length;
});

for (let i = 0; i < slideCount; i++) {
  if (i > 0) await page.click('#wrappedTapNext');
  await page.waitForTimeout(600);
  await shot(`slide-${String(i + 1).padStart(2, '0')}-dark.png`, 'dark');
}

const shareB64 = await page.evaluate(() => {
  return new Promise((resolve) => {
    const payload = window.ExpenseLoggerTest.buildWrappedPayload(2026, 8);
    window.ExpenseLoggerTest.drawWrappedToCanvas(payload, (blob) => {
      if (!blob) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  });
});
if (shareB64) {
  const raw = shareB64.replace(/^data:image\/png;base64,/, '');
  for (const dir of OUT_DIRS) {
    writeFileSync(join(dir, 'share-canvas.png'), Buffer.from(raw, 'base64'));
  }
}

await page.click('#wrappedDoneBtn');
await page.waitForTimeout(300);

await page.addInitScript(() => {
  const fixed = new Date(2026, 9, 3, 12, 0, 0);
  const RealDate = Date;
  // eslint-disable-next-line no-global-assign
  Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed.getTime());
      else super(...args);
    }
    static now() { return fixed.getTime(); }
  };
  Date.UTC = RealDate.UTC;
  Date.parse = RealDate.parse;
});
await page.reload({ waitUntil: 'networkidle' });
await page.click('[data-tab="summary"]');
await page.waitForSelector('#homeRecapCard:not([hidden])', { timeout: 8000 });
await shot('home-teaser-dark.png', 'dark');

await page.emulateMedia({ colorScheme: 'light' });
await page.click('[data-tab="report"]');
await page.click('#openWrappedBtn');
await page.waitForTimeout(500);
await shot('slide-01-light.png', 'light');

await browser.close();
server.close();
console.log('Screenshots saved to:', OUT_DIRS.join(', '));
