/**
 * Bank sync pull into import review (Plaid E, #51). Mock Worker via Playwright route; fake data.
 * Money asserts are in cents. Run: node scripts/sync-import-test.mjs   (EL_ROOT if not /workspace)
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8942;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://sync.example.test';
const TOKEN = 'ef'.repeat(32);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = join(ROOT, p);
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});

const txn = (id, acct, amount, date, name, extra) => Object.assign({
  transaction_id: id, account_id: acct, amount, iso_currency_code: 'USD', date, authorized_date: null,
  name, merchant_name: null, original_description: name.toUpperCase() + ' FAKE', pending: false,
  pending_transaction_id: null, personal_finance_category: null
}, extra || {});
const ROWS = [
  txn('b-dep', 'plaid-chk', -2000.00, '2026-10-01', 'Acme Payroll', { original_description: 'ACME PAYROLL DIRECT DEP' }),
  txn('b-dup', 'plaid-chk', 45.67, '2026-10-05', 'Shell', { original_description: 'SHELL OIL 1234' }),
  txn('c-buy', 'plaid-card', 12.34, '2026-10-04', 'Blue Bottle', { authorized_date: '2026-10-03', merchant_name: 'Blue Bottle Coffee' }),
  txn('c-pay', 'plaid-card', -500.00, '2026-10-06', 'Payment Thank You', {
    personal_finance_category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' } }),
  txn('c-ref', 'plaid-card', -25.00, '2026-10-07', 'Fake Store Refund'),
  txn('c-old', 'plaid-card', 9.99, '2024-12-31', 'Old Purchase')
];
const ACCOUNTS = [{ itemId: 'i1', account_id: 'plaid-chk', appAccountId: 'acct-checking' }, { itemId: 'i1', account_id: 'plaid-card', appAccountId: 'acct-chase' }];
let pullBatch = 'batch-1';
const acks = [];

const cents = (n) => Math.round(n * 100);

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 428, height: 926 } });
  await context.route(WORKER + '/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const ok = req.headers()['authorization'] === 'Bearer ' + TOKEN;
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (!ok) return reply(401, { error: 'unauthorized' });
    if (path === '/pull') return reply(200, { batchId: pullBatch, added: ROWS, modified: [], removed: [], accounts: ACCOUNTS, needsReconnect: [], errors: [] });
    if (path === '/ack') { acks.push(JSON.parse(req.postData()).batchId); return reply(200, { ok: true, deleted: true }); }
    return reply(404, {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(({ worker, token }) => {
    localStorage.setItem('expenseLogger.sync.v1', JSON.stringify({ workerUrl: worker, deviceToken: token, pairedAt: new Date().toISOString() }));
    // Fake row from an earlier CSV import that the bank sends again.
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([{ id: 'csv1', amount: 45.67, categoryId: 'gas', note: 'SHELL OIL 1234',
      ts: new Date(2026, 9, 5, 12).getTime(), importSource: 'bank', accountId: 'acct-checking', importRowKey: 'r:fake', isTransfer: false }]));
  }, { worker: WORKER, token: TOKEN });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab-btn[data-tab="settings"]');
  assert.strictEqual(await page.inputValue('#bankSyncCutoverChase'), '2025-01-01', 'default cutover');

  const ledger = () => page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')));
  const reviewRows = () => page.evaluate(() => window.ExpenseLoggerTest.pendingImportRows());
  const openReview = async () => { await page.click('#bankSyncNowBtn'); await page.waitForSelector('#importModal.show'); };
  const before = await ledger();

  // 1. A failed save leaves entries unchanged and sends no ack; discarding sends no ack either.
  await openReview();
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    window.__realSet = real;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'expenseLogger.entries.v1') throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, k, v);
    };
  });
  await page.click('#importConfirmBtn');
  await page.waitForFunction(() => /not saved/.test(document.getElementById('toast').textContent));
  await page.evaluate(() => { Storage.prototype.setItem = window.__realSet; });
  assert.deepStrictEqual(await ledger(), before, 'failed save leaves entries unchanged');
  assert.strictEqual((await page.evaluate(() => window.ExpenseLoggerTest.getState().entries.length)), 1, 'memory rolled back');
  await page.evaluate(() => window.ExpenseLoggerTest.requestDismissImportReview());
  await page.waitForTimeout(400);
  assert.deepStrictEqual(acks, [], 'no ack after failed save or discard');

  // 2. Checking review: $2,000.00 deposit to import, the CSV row flagged as duplicate.
  await openReview();
  let rows = await reviewRows();
  const dep = rows.find((r) => r.importRowKey === 'plaid:b-dep');
  assert.strictEqual(dep.status, 'import');
  assert.strictEqual(dep.isDeposit, true);
  assert.strictEqual(cents(dep.amount), 200000);
  assert.strictEqual(dep.bankText, 'ACME PAYROLL DIRECT DEP');
  const dup = rows.find((r) => r.importRowKey === 'plaid:b-dup');
  assert.strictEqual(dup.status, 'duplicate', 'row matching a CSV import is a duplicate');
  assert.strictEqual(dup.existingEntryId, 'csv1');
  await page.click('#importConfirmBtn');

  // Card review: $12.34 purchase dated by authorized_date, $500.00 payment is a transfer,
  // $25.00 refund is a credit (not spending), the 2024 row is dropped by the cutover.
  await page.waitForFunction(() => { const r = window.ExpenseLoggerTest.pendingImportRows(); return r && r.some((x) => x.importRowKey === 'plaid:c-buy'); });
  rows = await reviewRows();
  const buy = rows.find((r) => r.importRowKey === 'plaid:c-buy');
  assert.strictEqual(buy.status, 'import');
  assert.strictEqual(cents(buy.amount), 1234);
  assert.strictEqual(buy.note, 'Blue Bottle Coffee', 'note is merchant_name');
  assert.strictEqual(await page.evaluate((ts) => window.ExpenseLoggerTest.dayKey(ts), buy.ts), '2026-10-03', 'card uses authorized_date');
  const pay = rows.find((r) => r.importRowKey === 'plaid:c-pay');
  assert.strictEqual(pay.status, 'transfer');
  assert.strictEqual(cents(pay.amount), 50000);
  const ref = rows.find((r) => r.importRowKey === 'plaid:c-ref');
  assert.strictEqual(ref.status, 'credit');
  assert.strictEqual(cents(ref.amount), 2500);
  assert.ok(!rows.some((r) => r.importRowKey === 'plaid:c-old'), 'row before 2025-01-01 dropped');
  assert.deepStrictEqual(acks, [], 'no ack until every review is saved');
  await page.click('#importConfirmBtn');
  await page.waitForFunction(() => !document.querySelector('#importModal.show'));
  await page.waitForTimeout(300);
  assert.deepStrictEqual(acks, ['batch-1'], 'ack after both commits');

  const after = await ledger();
  const byKey = Object.fromEntries(after.filter((e) => e.importRowKey && e.importRowKey.startsWith('plaid:')).map((e) => [e.importRowKey, e]));
  assert.deepStrictEqual(Object.keys(byKey).sort(), ['plaid:b-dep', 'plaid:c-buy', 'plaid:c-pay']);
  assert.strictEqual(cents(byKey['plaid:b-dep'].amount), 200000);
  assert.strictEqual(byKey['plaid:b-dep'].accountId, 'acct-checking');
  assert.strictEqual(cents(byKey['plaid:c-buy'].amount), 1234);
  assert.strictEqual(byKey['plaid:c-buy'].accountId, 'acct-chase');
  assert.strictEqual(cents(byKey['plaid:c-pay'].amount), 50000);
  const spend = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    return T.getState().entries.filter((e) => (e.importRowKey || '').startsWith('plaid:')).map((e) => [e.importRowKey, T.entryCountsAsSpending(e)]);
  });
  assert.deepStrictEqual(Object.fromEntries(spend), { 'plaid:b-dep': false, 'plaid:c-buy': true, 'plaid:c-pay': false }, 'only the purchase is spending');
  assert.strictEqual(after.length, before.length + 3);

  // 3. Second pull of the same rows (new batch id) adds zero and is still acked.
  pullBatch = 'batch-2';
  await page.click('#bankSyncNowBtn');
  await page.waitForTimeout(800);
  assert.strictEqual(await page.locator('#importModal.show').count(), 0, 'no review when nothing is new');
  assert.strictEqual((await ledger()).length, after.length, 'second pull adds zero');
  assert.deepStrictEqual(acks, ['batch-1', 'batch-2']);

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  server.close();
  console.log('sync-import-test: all checks passed');
}

run().catch((e) => { console.error(e); server.close(); process.exit(1); });
