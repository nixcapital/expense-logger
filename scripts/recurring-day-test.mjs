/**
 * Recurring day-of-month follows the entry date, not "today".
 * Run: node scripts/recurring-day-test.mjs
 */
import assert from 'assert';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8925;
const ROOT = '/workspace';
const VIEWPORT = { width: 428, height: 926 };

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
};

const server = createServer((req, res) => {
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

/** Fixed "today" for addEntry: 2026-10-24 local. */
const FAKE_NOW = new Date(2026, 9, 24, 14, 30, 0).getTime();

async function seedFresh(page) {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'bills', name: 'Bills', icon: 'file-text', color: '#748FFC' },
      { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.recurring.v1', '[]');
    localStorage.setItem('expenseLogger.budgets.v1', '{}');
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify([
      { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997' },
      { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#5B8CFF' }
    ]));
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'summary' }));
  });
}

async function addRecurringExpense(page, { amount, dateYmd, categoryId }) {
  await page.click('.tab-btn-add');
  await page.waitForSelector('#addSheet.show');
  await page.fill('#amount', String(amount));
  await page.evaluate((ymd) => {
    const el = document.getElementById('addDate');
    if (el) el.value = ymd;
  }, dateYmd);
  await page.check('#recurring');
  await page.click('#cats .cat-btn[data-id="' + categoryId + '"]');
  await page.click('#saveBtn');
  await page.waitForFunction(() => !document.getElementById('addSheet').classList.contains('show'));
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript((nowMs) => {
    const fixed = nowMs;
    const RealDate = Date;
    function MockDate() {
      if (arguments.length === 0) return new RealDate(fixed);
      return new RealDate(...arguments);
    }
    MockDate.now = function () { return fixed; };
    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    MockDate.prototype = RealDate.prototype;
    window.Date = MockDate;
  }, FAKE_NOW);

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest && window.ExpenseLoggerTest.APP_VERSION === '1.9.7');

  console.log('recurring-day-test: new recurring uses entry calendar day');
  await seedFresh(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest);

  await addRecurringExpense(page, { amount: 80, dateYmd: '2026-11-03', categoryId: 'bills' });

  const saved = await page.evaluate(() => {
    const recurring = JSON.parse(localStorage.getItem('expenseLogger.recurring.v1') || '[]');
    const entries = JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]');
    return { recurring, entries };
  });
  assert.strictEqual(saved.recurring.length, 1);
  assert.strictEqual(saved.recurring[0].amount, 80);
  assert.strictEqual(saved.recurring[0].dayOfMonth, 3, 'dayOfMonth from entry date, not today (24)');

  assert.strictEqual(saved.entries.length, 1);
  const entry = saved.entries[0];
  assert.strictEqual(entry.amount, 80);
  const d = new Date(entry.ts);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 10, 'November');
  assert.strictEqual(d.getDate(), 3);

  console.log('recurring-day-test: stored recurring rows are not rewritten on boot');
  const existingId = 'rec-existing-24';
  await page.evaluate((id) => {
    localStorage.setItem('expenseLogger.recurring.v1', JSON.stringify([
      {
        id: id,
        amount: 45,
        categoryId: 'bills',
        note: 'Legacy bill',
        dayOfMonth: 24
      }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
  }, existingId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest);

  const afterBoot = await page.evaluate(() => {
    return JSON.parse(localStorage.getItem('expenseLogger.recurring.v1') || '[]');
  });
  assert.strictEqual(afterBoot.length, 1);
  assert.strictEqual(afterBoot[0].id, existingId);
  assert.strictEqual(afterBoot[0].dayOfMonth, 24);

  await browser.close();
  server.close();
  console.log('recurring-day-test: PASS');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
