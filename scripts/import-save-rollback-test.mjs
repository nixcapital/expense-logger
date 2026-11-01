/**
 * Import commit rolls back when storage refuses saveEntries/saveAccounts.
 * Run: node scripts/import-save-rollback-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8879;
const ROOT = '/workspace';
const FIX = join(ROOT, 'test/fixtures');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.csv': 'text/csv'
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

async function importFile(page, relPath, accountPickId) {
  await page.locator('#importFileInput').setInputFiles(join(FIX, relPath));
  await page.waitForSelector('#importAccountModal.show', { timeout: 5000 });
  await page.waitForTimeout(200);
  if (accountPickId) {
    await page.locator('[data-account-pick="' + accountPickId + '"]').click();
    await page.waitForTimeout(150);
  }
  await page.click('#importAccountContinueBtn');
  await page.waitForFunction(() => {
    const acct = document.getElementById('importAccountModal');
    const review = document.getElementById('importModal');
    return acct && !acct.classList.contains('show') && review && review.classList.contains('show');
  }, { timeout: 5000 });
  await page.waitForTimeout(200);
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const seedEntry = {
    id: 'seed-keep',
    amount: 50,
    categoryId: 'groceries',
    note: 'Existing row',
    ts: new Date('2026-10-05T12:00:00').getTime(),
    accountId: 'acct-checking'
  };

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(({ seedEntry }) => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' },
      { id: 'other', name: 'Other', emoji: '📦', color: '#adb5bd' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([seedEntry]));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify([
      {
        id: 'acct-checking',
        name: 'Checking',
        type: 'bank',
        color: '#20C997',
        currentBalance: 2000,
        balanceAsOf: '2026-10-01'
      },
      { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
    ]));
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
  }, { seedEntry });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest && window.ExpenseLoggerTest.APP_VERSION === '1.9.7');

  await page.click('button[data-tab="settings"]');
  await importFile(page, 'single-expense-1999.csv', 'acct-checking');

  await page.evaluate(() => {
    const proto = Storage.prototype;
    const orig = proto.setItem;
    proto.setItem = function (key, val) {
      if (key === 'expenseLogger.entries.v1') {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return orig.apply(this, arguments);
    };
  });

  await page.click('#importConfirmBtn');
  await page.waitForTimeout(400);

  const failCase = await page.evaluate(({ seedId }) => {
    const T = window.ExpenseLoggerTest;
    const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]');
    const accts = JSON.parse(localStorage.getItem('expenseLogger.accounts.v1') || '[]');
    const checking = accts.find((a) => a.id === 'acct-checking');
    const toast = (document.getElementById('toast') && document.getElementById('toast').textContent) || '';
    const reviewOpen = document.getElementById('importModal') && document.getElementById('importModal').classList.contains('show');
    const seed = es.find((e) => e.id === seedId);
    const imported = es.some((e) => (e.note || '').indexOf('TEST MERCHANT') !== -1);
    return {
      entryCount: es.length,
      seedAmount: seed && seed.amount,
      balance: checking && checking.currentBalance,
      balanceAsOf: checking && checking.balanceAsOf,
      imported,
      reviewOpen,
      toast
    };
  }, { seedId: seedEntry.id });

  assert.strictEqual(failCase.entryCount, 1, 'entries count unchanged');
  assert.strictEqual(failCase.seedAmount, 50, 'seed entry amount unchanged');
  assert.strictEqual(failCase.balance, 2000, 'checking balance unchanged');
  assert.strictEqual(failCase.balanceAsOf, '2026-10-01', 'balance as-of unchanged');
  assert.strictEqual(failCase.imported, false, 'import row not persisted');
  assert.ok(failCase.reviewOpen, 'import review stays open');
  assert.match(failCase.toast, /not saved/i, 'failure toast');

  // Normal import still works after removing the hook (reload clears in-page patch).
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('button[data-tab="settings"]');
  await importFile(page, 'sample-bank-checking.csv', 'acct-checking');
  const beforeCount = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  await page.click('#importConfirmBtn');
  await page.waitForTimeout(500);
  const afterFirst = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  assert.ok(afterFirst > beforeCount, 'sample-bank-checking adds rows');

  await importFile(page, 'sample-bank-checking.csv', 'acct-checking');
  await page.click('#importConfirmBtn');
  await page.waitForTimeout(500);
  const afterSecond = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  assert.strictEqual(afterSecond, afterFirst, 'second import dedupes');

  assert.strictEqual(errors.length, 0, 'no page errors: ' + errors.join('; '));
  console.log('import-save-rollback-test: PASS');

  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
