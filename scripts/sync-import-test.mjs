/**
 * Bank sync import tests (step E, #51) with a mocked Worker.
 * Run: node scripts/sync-import-test.mjs   (EL_ROOT overrides the repo root)
 *
 * Covers, in explicit cents: a $12.34 card purchase (spending, ts from
 * authorized_date), a $500.00 card payment (transfer, not spending), a $25.00
 * card refund (never committed), a $2,000.00 bank deposit; a second pull of
 * the same rows adds zero; a row duplicating a CSV-imported row is flagged
 * duplicate; a row before the 2025-01-01 cutover is dropped; a failed save
 * leaves entries unchanged and sends no ack. Ack fires only after a saved
 * commit, never on discard.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8892;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://worker.test';
const DEVICE_TOKEN = 'cd'.repeat(32); // fake, sandbox only

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png'
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

const results = [];
function check(name, ok, detail) {
  results.push([name, !!ok]);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}
const cents = (n) => Math.round(n * 100);

let pullPayload = { batchId: null, added: [], modified: [], removed: [], accounts: [], needsReconnect: [], errors: [] };
const ackCalls = [];

const CHASE_ACCOUNTS = [{ account_id: 'plaid-chase', appAccountId: 'acct-chase', mask: '1111', type: 'credit' }];
const CHECKING_ACCOUNTS = [{ account_id: 'plaid-check', appAccountId: 'acct-checking', mask: '2222', type: 'depository' }];

function cardPull(batchId) {
  return {
    batchId,
    added: [
      {
        transaction_id: 'txn-purchase', account_id: 'plaid-chase', amount: 12.34,
        date: '2026-10-20', authorized_date: '2026-10-19',
        name: 'COFFEE SHOP', merchant_name: 'Coffee Shop', original_description: 'COFFEE SHOP #123',
        pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE_SHOPS' }
      },
      {
        transaction_id: 'txn-payment', account_id: 'plaid-chase', amount: -500,
        date: '2026-10-21', authorized_date: '2026-10-21',
        name: 'Payment Thank You-Mobile', merchant_name: null, original_description: 'Payment Thank You-Mobile',
        pending: false, personal_finance_category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' }
      },
      {
        transaction_id: 'txn-refund', account_id: 'plaid-chase', amount: -25,
        date: '2026-10-22', authorized_date: '2026-10-22',
        name: 'STORE REFUND', merchant_name: 'Store', original_description: 'STORE REFUND',
        pending: false, personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE' }
      }
    ],
    modified: [], removed: [], accounts: CHASE_ACCOUNTS, needsReconnect: [], errors: []
  };
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());

  await page.route(WORKER + '/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        }
      });
      return;
    }
    const url = new URL(req.url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (url.pathname === '/pull') {
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify(pullPayload) });
      return;
    }
    if (url.pathname === '/ack') {
      ackCalls.push({ body: JSON.parse(req.postData() || '{}'), auth: req.headers()['authorization'] || '' });
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, deleted: true }) });
      return;
    }
    await route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ error: 'not_found' }) });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate((worker) => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' },
      { id: 'dining', name: 'Dining', emoji: '🍽️', color: '#ff922b' },
      { id: 'gas', name: 'Gas', emoji: '⛽', color: '#51cf66' },
      { id: 'bills', name: 'Bills', emoji: '📄', color: '#cc5de8' },
      { id: 'fun', name: 'Fun', emoji: '🎉', color: '#f783ac' },
      { id: 'other', name: 'Other', emoji: '📦', color: '#adb5bd' },
      { id: 'income', name: 'Income', emoji: '💵', color: '#34C77B' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.sync.v1', JSON.stringify({
      workerUrl: worker, deviceToken: 'cd'.repeat(32), pairedAt: new Date().toISOString()
    }));
  }, WORKER);
  await page.reload({ waitUntil: 'networkidle' });

  const version = await page.evaluate(() => window.ExpenseLoggerTest.APP_VERSION);
  check('app version is 2.2.0', version === '2.2.0', version);

  async function entries() {
    return page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]'));
  }
  async function syncAndConfirm() {
    await page.click('button[data-tab="settings"]');
    await page.click('#syncNowBtn');
    await page.waitForSelector('#importModal.show', { timeout: 5000 });
    await page.click('#importConfirmBtn');
    await page.waitForTimeout(700);
  }

  // --- Scenario 1: card purchase + payment + refund ---
  pullPayload = cardPull('batch-card-1');
  await syncAndConfirm();
  let es = await entries();
  const purchase = es.find((e) => e.importRowKey === 'plaid:txn-purchase');
  const payment = es.find((e) => e.importRowKey === 'plaid:txn-payment');
  check('card pull commits purchase + payment only', es.length === 2, 'entries=' + es.length);
  check('$12.34 purchase in explicit cents', !!purchase && cents(purchase.amount) === 1234,
    purchase ? String(cents(purchase.amount)) : 'missing');
  const authTs = await page.evaluate(() => new Date(2026, 9, 19, 12, 0, 0, 0).getTime());
  check('card ts uses authorized_date', !!purchase && purchase.ts === authTs,
    purchase ? new Date(purchase.ts).toISOString() : 'missing');
  check('purchase is on the Chase account and counts as spending',
    !!purchase && purchase.accountId === 'acct-chase' && !purchase.isTransfer);
  check('$500.00 payment in explicit cents', !!payment && cents(payment.amount) === 50000,
    payment ? String(cents(payment.amount)) : 'missing');
  check('payment is a transfer (not spending)', !!payment && payment.isTransfer === true);
  check('$25.00 refund never reaches the ledger', !es.some((e) => cents(e.amount) === 2500));
  check('ack sent once, for batch-card-1, with the device token',
    ackCalls.length === 1 && ackCalls[0].body.batchId === 'batch-card-1' && ackCalls[0].auth === 'Bearer ' + DEVICE_TOKEN,
    JSON.stringify(ackCalls.map((a) => a.body.batchId)));

  // --- Scenario 2: second pull of the same rows adds zero ---
  pullPayload = cardPull('batch-card-2');
  await syncAndConfirm();
  es = await entries();
  check('second pull adds zero entries', es.length === 2, 'entries=' + es.length);
  check('second batch acked after its commit', ackCalls.length === 2 && ackCalls[1].body.batchId === 'batch-card-2');

  // --- Scenario 3: bank deposit + pre-cutover row dropped ---
  pullPayload = {
    batchId: 'batch-bank-1',
    added: [
      {
        transaction_id: 'txn-deposit', account_id: 'plaid-check', amount: -2000,
        date: '2026-10-15', authorized_date: null,
        name: 'PAYROLL DEP PPD', merchant_name: null, original_description: 'PAYROLL DEP PPD ID:999',
        pending: false, personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' }
      },
      {
        transaction_id: 'txn-old', account_id: 'plaid-check', amount: 10,
        date: '2024-12-31', authorized_date: null,
        name: 'OLD ROW', merchant_name: null, original_description: 'OLD ROW',
        pending: false, personal_finance_category: null
      }
    ],
    modified: [], removed: [], accounts: CHECKING_ACCOUNTS, needsReconnect: [], errors: []
  };
  await page.click('button[data-tab="settings"]');
  await page.click('#syncNowBtn');
  await page.waitForSelector('#importModal.show', { timeout: 5000 });
  const reviewRows = await page.evaluate(() => window.ExpenseLoggerTest.getPendingImport().rows);
  check('pre-cutover row is dropped before review', reviewRows.length === 1 && reviewRows[0].importRowKey === 'plaid:txn-deposit',
    JSON.stringify(reviewRows.map((r) => r.importRowKey)));
  await page.click('#importConfirmBtn');
  await page.waitForTimeout(700);
  es = await entries();
  const deposit = es.find((e) => e.importRowKey === 'plaid:txn-deposit');
  check('$2,000.00 deposit in explicit cents, flagged as deposit',
    !!deposit && cents(deposit.amount) === 200000 && deposit.isDeposit === true && deposit.accountId === 'acct-checking',
    deposit ? String(cents(deposit.amount)) : 'missing');
  check('bank batch acked', ackCalls.some((a) => a.body.batchId === 'batch-bank-1'));

  // --- Scenario 4: row duplicating a CSV-imported row is flagged; discard sends no ack ---
  const csvTs = await page.evaluate(() => new Date(2026, 9, 19, 12, 0, 0, 0).getTime());
  await page.evaluate((ts) => {
    const T = window.ExpenseLoggerTest;
    const cur = T.getState().entries;
    cur.push({
      id: 'csv1', amount: 12.34, categoryId: 'dining', note: 'Coffee Shop', ts,
      importBatchId: 'b:fake', importRowKey: 'r:fake', importSource: 'card', accountId: 'acct-chase',
      importDedupeSnapshot: { ts, amount: 12.34, note: 'Coffee Shop', categoryId: 'dining', accountId: 'acct-chase', sign: 'out' }
    });
    T.persist();
  }, csvTs);
  pullPayload = {
    batchId: 'batch-dup-1',
    added: [{
      transaction_id: 'txn-purchase-2', account_id: 'plaid-chase', amount: 12.34,
      date: '2026-10-20', authorized_date: '2026-10-19',
      name: 'COFFEE SHOP', merchant_name: 'Coffee Shop', original_description: 'COFFEE SHOP #123',
      pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE_SHOPS' }
    }],
    modified: [], removed: [], accounts: CHASE_ACCOUNTS, needsReconnect: [], errors: []
  };
  const acksBefore = ackCalls.length;
  await page.click('button[data-tab="settings"]');
  await page.click('#syncNowBtn');
  await page.waitForSelector('#importModal.show', { timeout: 5000 });
  const dupRows = await page.evaluate(() => window.ExpenseLoggerTest.getPendingImport().rows);
  check('row duplicating a CSV-imported row is flagged duplicate',
    dupRows.length === 1 && dupRows[0].status === 'duplicate', JSON.stringify(dupRows.map((r) => r.status)));
  await page.evaluate(() => window.ExpenseLoggerTest.requestDismissImportReview());
  await page.waitForTimeout(400);
  check('discard sends no ack', ackCalls.length === acksBefore);

  // --- Scenario 5: failed save leaves entries unchanged and sends no ack ---
  const beforeRaw = await page.evaluate(() => localStorage.getItem('expenseLogger.entries.v1'));
  const beforeCount = (await entries()).length;
  pullPayload = {
    batchId: 'batch-fail-1',
    added: [{
      transaction_id: 'txn-new', account_id: 'plaid-chase', amount: 7.77,
      date: '2026-10-25', authorized_date: '2026-10-25',
      name: 'NEW SHOP', merchant_name: 'New Shop', original_description: 'NEW SHOP',
      pending: false, personal_finance_category: null
    }],
    modified: [], removed: [], accounts: CHASE_ACCOUNTS, needsReconnect: [], errors: []
  };
  await page.evaluate(() => {
    const realSet = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function (k, v) {
      if (!failed && k === 'expenseLogger.entries.v1') {
        failed = true;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return realSet.call(this, k, v);
    };
    window.__elRestoreSetItem = () => { Storage.prototype.setItem = realSet; };
  });
  await page.click('button[data-tab="settings"]');
  await page.click('#syncNowBtn');
  await page.waitForSelector('#importModal.show', { timeout: 5000 });
  await page.click('#importConfirmBtn');
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__elRestoreSetItem());
  const afterRaw = await page.evaluate(() => localStorage.getItem('expenseLogger.entries.v1'));
  check('failed save leaves stored entries unchanged', afterRaw === beforeRaw && (await entries()).length === beforeCount);
  check('failed save sends no ack', !ackCalls.some((a) => a.body.batchId === 'batch-fail-1'));
  const stillPending = await page.evaluate(() => !!window.ExpenseLoggerTest.getPendingImport());
  check('failed commit keeps the review open for retry', stillPending === true);
  await page.evaluate(() => window.ExpenseLoggerTest.requestDismissImportReview());

  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r[1]);
  console.log(failed.length === 0 ? '\nALL PASS' : '\n' + failed.length + ' FAILED');
  process.exit(failed.length === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
