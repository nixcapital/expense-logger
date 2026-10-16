/**
 * QA screenshots for Spending Wrapped 1.7.0 (428x926). Not committed.
 * Run: node scripts/wrapped-qa-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8898;
const OUT_DIRS = ['/cursor/stores/self/artifacts/wrapped-17'];

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
  { id: 'r-duke', amount: 142.4, categoryId: 'bills', dayOfMonth: 15, name: 'Duke Energy' },
  { id: 'r-verizon', amount: 89.99, categoryId: 'bills', dayOfMonth: 8, name: 'Verizon' },
  { id: 'r-netflix', amount: 15.99, categoryId: 'fun', dayOfMonth: 12, name: 'Netflix' },
  { id: 'r-spotify', amount: 12.99, categoryId: 'fun', dayOfMonth: 4, name: 'Spotify' },
  { id: 'r-max', amount: 16.99, categoryId: 'fun', dayOfMonth: 4, name: 'Max' }
];

/** Realistic ~$2.5k/mo with comparable category mix (±30% MoM). */
function buildFixtureEntries() {
  const entries = [
    { id: 'xfer-c', amount: 1250, categoryId: 'bills', note: 'CHASE CRD AUTOPAY', ts: ts(2026, 8, 15), isTransfer: true, accountId: 'acct-checking' },
    { id: 'xfer-ch', amount: 1250, categoryId: 'bills', note: 'Payment Thank You', ts: ts(2026, 8, 16), isTransfer: true, accountId: 'acct-chase' }
  ];

  const months = [
    { y: 2026, m: 5, scale: 1.0, sb: 3 },
    { y: 2026, m: 6, scale: 1.02, sb: 4 },
    { y: 2026, m: 7, scale: 1.08, sb: 5 },
    { y: 2026, m: 8, scale: 1.0, sb: 14 }
  ];

  const base = {
    dining: 612.3,
    groceries: 471.85,
    bills: 584.47,
    gas: 138.4,
    fun: 296.18,
    other: 383.2
  };

  months.forEach((mo) => {
    const s = mo.scale;
    const chase = 'acct-chase';
    const checking = 'acct-checking';
    let id = 0;
    const add = (amount, categoryId, note, day, accountId) => {
      entries.push({
        id: 'e-' + mo.m + '-' + (id++),
        amount: Math.round(amount * s * 100) / 100,
        categoryId,
        note,
        ts: ts(mo.y, mo.m, day),
        accountId: accountId || chase
      });
    };

    for (let i = 0; i < mo.sb; i++) {
      add(5.61, 'dining', 'STARBUCKS #' + (4400 + i), 2 + i * 2, chase);
    }

    add(base.bills * 0.24, 'bills', 'Duke Energy', 15, checking);
    add(base.bills * 0.15, 'bills', 'Verizon', 8, checking);
    add(base.bills * 0.61, 'bills', 'Rent · ACH', 1, checking);

    if (mo.m === 8) {
      add(12.99, 'fun', 'Spotify', 4, chase);
      add(16.99, 'fun', 'Max', 4, chase);
      add(15.99, 'fun', 'Netflix', 12, chase);
    } else {
      add(mo.m === 7 ? 11.99 : 11.99, 'fun', 'Spotify', 4, chase);
      add(15.99, 'fun', 'Netflix', 12, chase);
    }

    add(base.groceries * 0.55, 'groceries', 'Costco', 13, chase);
    add(base.groceries * 0.25, 'groceries', "Trader Joe's", 6, chase);
    add(base.groceries * 0.2, 'groceries', 'Target', 18, chase);

    add(base.dining * 0.35, 'dining', 'Chipotle', 9, chase);
    add(base.dining * 0.2, 'dining', 'Sweetgreen', 7, chase);
    add(base.dining * 0.15, 'dining', "Joe's Pizza", 11, chase);
    if (mo.m === 8) {
      add(4.5, 'dining', 'Blue Bottle Coffee', 5, chase);
      add(4.75, 'dining', 'Blue Bottle', 19, chase);
    }

    add(base.gas * 0.5, 'gas', 'Shell', 13, chase);
    add(base.gas * 0.5, 'gas', 'Costco Gas', 20, chase);

    add(base.fun * 0.4, 'fun', 'AMC Theatres', 14, chase);
    add(base.other * 0.35, 'other', 'REI', 9, chase);
    add(base.other * 0.3, 'other', 'Lyft', 13, chase);
    add(base.other * 0.35, 'other', 'Amazon', 22, chase);

    if (mo.m === 8) {
      add(286.14, 'groceries', 'Costco', 13, chase);
      add(35.06, 'gas', 'Shell', 13, chase);
      add(20, 'dining', 'Chipotle', 13, chase);
    }
  });

  entries.forEach((e) => {
    if (e.note === 'Duke Energy' && e.ts >= ts(2026, 6, 1)) e.recurringId = 'r-duke';
    if (e.note === 'Verizon') e.recurringId = 'r-verizon';
    if (e.note === 'Netflix') e.recurringId = 'r-netflix';
    if (e.note === 'Spotify') e.recurringId = 'r-spotify';
    if (e.note === 'Max') e.recurringId = 'r-max';
  });

  return entries;
}

const entries = buildFixtureEntries();

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
  await page.waitForTimeout(550);
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
await page.waitForTimeout(700);

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
  await page.waitForTimeout(700);
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
await page.waitForTimeout(1200);
await page.click('[data-tab="summary"]');
await page.waitForSelector('#homeRecapCard:not([hidden])', { timeout: 8000 });
await shot('home-teaser-dark.png', 'dark');

await page.emulateMedia({ colorScheme: 'light' });
await page.click('[data-tab="report"]');
await page.click('#openWrappedBtn');
await page.waitForTimeout(700);
await shot('slide-01-light.png', 'light');

await browser.close();
server.close();
console.log('Screenshots saved to:', OUT_DIRS.join(', '));
