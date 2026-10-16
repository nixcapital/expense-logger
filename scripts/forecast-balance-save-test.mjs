/**
 * Regression: Save balance sheet (Settings + Forecast entry points).
 * Run: node scripts/forecast-balance-save-test.mjs
 */
import { chromium, devices } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8896;
const ROOT = '/workspace';
const VIEWPORT = { width: 428, height: 926 };
const OUT_DIRS = ['/opt/cursor/artifacts', '/cursor/stores/self/artifacts'];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

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

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

/** Pre-1.6 account row: no balance fields, non-default id. */
function seedLegacyAccounts() {
  return [
    { id: 'legacy-checking-001', name: 'Checking', type: 'bank', color: '#20C997' },
    { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
  ];
}

function seedCheckingEntries() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    out.push({
      id: 'e-' + i,
      amount: 12 + i,
      categoryId: 'other',
      note: 'Coffee ' + i,
      ts: ts(2026, 9, 10 + i),
      accountId: 'legacy-checking-001'
    });
  }
  return out;
}

async function shot(page, name) {
  for (const dir of OUT_DIRS) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, name) });
  }
}

async function dismissLock(page) {
  await page.evaluate(() => {
    const lock = document.getElementById('lockScreen');
    const app = document.getElementById('app');
    if (lock) lock.hidden = true;
    if (app) app.hidden = false;
  });
}

async function seedPage(page, extra) {
  await page.evaluate((payload) => {
    localStorage.clear();
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(payload.categories));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify(payload.accounts));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(payload.entries));
    localStorage.setItem('expenseLogger.budgets.v1', '{}');
    localStorage.setItem('expenseLogger.recurring.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.forecastOverrides.v1', '{}');
    localStorage.setItem('expenseLogger.meta.v1', JSON.stringify({ forecastCushion: 600 }));
    localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'summary' }));
  }, extra);
}

async function run() {
  OUT_DIRS.forEach((d) => mkdirSync(d, { recursive: true }));
  const srv = server();
  await new Promise((r) => srv.listen(PORT, r));

  const browser = await chromium.launch();
  const iPhone = devices['iPhone 13 Pro Max'];
  const context = await browser.newContext({
    ...iPhone,
    viewport: VIEWPORT,
    hasTouch: true,
    isMobile: true
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript(() => {
    const t = new Date(2026, 9, 16, 14, 0, 0);
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(t.getTime());
        else super(...args);
      }
      static now() {
        return t.getTime();
      }
    }
    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    window.Date = MockDate;
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await seedPage(page, {
    categories: [{ id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }],
    accounts: seedLegacyAccounts(),
    entries: seedCheckingEntries()
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await dismissLock(page);

  // —— Entry 1: Settings → Checking → Balance ——
  await page.click('[data-tab="settings"]');
  await page.click('[data-balance-acct="legacy-checking-001"]');
  await page.waitForSelector('#balanceSheet.show');
  await shot(page, 'balance-sheet-before-save.png');

  await page.fill('#balanceAmountInput', '$2,378.42');
  const box = await page.locator('#balanceSaveBtn').boundingBox();
  assert.ok(box, 'save button must be on screen');
  assert.ok(box.y + box.height <= VIEWPORT.height + 2, 'save button should sit in viewport (sticky footer)');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350);

  let saved = await page.evaluate(() => {
    const acct = window.ExpenseLoggerTest.getState().accounts.find((a) => a.id === 'legacy-checking-001');
    return {
      sheetOpen: document.getElementById('balanceSheet').classList.contains('show'),
      balance: acct && acct.currentBalance,
      asOf: acct && acct.balanceAsOf,
      toast: document.getElementById('toast').textContent
    };
  });
  assert.strictEqual(saved.sheetOpen, false, 'sheet closes after save (settings path)');
  assert.strictEqual(saved.balance, 2378.42, 'parses $ and commas');
  assert.strictEqual(saved.asOf, '2026-10-16');
  assert.ok(saved.toast.includes('Balance saved'));

  await page.click('[data-tab="summary"]');
  await page.waitForTimeout(200);
  await page.waitForSelector('#homeForecastCard:not([hidden])');
  await page.click('#homeForecastCard');
  await page.waitForSelector('#tab-forecast:not([hidden])');
  await page.waitForTimeout(400);
  await shot(page, 'forecast-after-balance-save.png');

  // —— Entry 2: Forecast → Update ——
  await page.click('#forecastUpdateBtn');
  await page.waitForSelector('#balanceSheet.show');
  await page.fill('#balanceAmountInput', '-120.50');
  await page.click('#balanceSaveBtn');
  await page.waitForTimeout(350);

  saved = await page.evaluate(() => {
    const acct = window.ExpenseLoggerTest.getState().accounts.find((a) => a.id === 'legacy-checking-001');
    const valEl = document.getElementById('forecastBalanceVal');
    return {
      balance: acct && acct.currentBalance,
      forecastVal: valEl ? valEl.textContent : ''
    };
  });
  assert.strictEqual(saved.balance, -120.5, 'negative overdraft allowed');
  assert.ok(saved.forecastVal.includes('120'), 'forecast screen refreshes balance');

  const parseChecks = await page.evaluate(() => {
    const p = window.ExpenseLoggerTest.parseMoneyInput;
    return {
      eu: p('2378,42'),
      invalid: p('abc')
    };
  });
  assert.strictEqual(parseChecks.eu, 2378.42);
  assert.ok(Number.isNaN(parseChecks.invalid));

  assert.strictEqual(errors.length, 0, 'no page errors: ' + errors.join('; '));
  console.log('forecast-balance-save-test: PASS');

  await browser.close();
  srv.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
