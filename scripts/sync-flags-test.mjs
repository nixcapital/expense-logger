/**
 * Bank sync flags + category hints (Plaid F, #52): modified rows show as "changed since import"
 * and removed rows as "bank removed this"; nothing changes without a tap. Category hints fill
 * "Other" rows; saved import rules win. Money in cents. Run: node scripts/sync-flags-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8944;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://sync.example.test';
const TOKEN = '12'.repeat(32);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = join(ROOT, p);
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});

const card = (id, amount, desc, pfc, extra) => Object.assign({
  transaction_id: id, account_id: 'plaid-card', amount, iso_currency_code: 'USD', date: '2026-10-04', authorized_date: '2026-10-03',
  name: desc, merchant_name: null, original_description: desc, pending: false, pending_transaction_id: null,
  personal_finance_category: pfc ? { primary: pfc[0], detailed: pfc[1] } : null
}, extra || {});
const PAYLOAD = {
  added: [
    card('h-groc', 23.45, 'FAKE MART 77', ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES']),
    card('h-rule', 18.00, 'FAKE CINEMA 9', ['ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES']),
    card('h-unknown', 7.00, 'FAKE THING 5', ['SOMETHING_NEW', 'SOMETHING_NEW_OTHER'])
  ],
  modified: [card('m-amt', 15.00, 'BLUE BOTTLE 1', ['FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE'], { merchant_name: 'Blue Bottle Coffee' })],
  removed: [{ transaction_id: 'r-gone', account_id: 'plaid-chk' }, { transaction_id: 'never-imported', account_id: 'plaid-chk' }],
  accounts: [{ itemId: 'i1', account_id: 'plaid-chk', appAccountId: 'acct-checking' }, { itemId: 'i1', account_id: 'plaid-card', appAccountId: 'acct-chase' }],
  needsReconnect: [], errors: []
};
let batch = 'batch-1';
const acks = [];
const cents = (n) => Math.round(n * 100);

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 428, height: 926 } });
  await context.route(WORKER + '/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.headers()['authorization'] !== 'Bearer ' + TOKEN) return reply(401, {});
    if (path === '/pull') return reply(200, Object.assign({ batchId: batch }, PAYLOAD));
    if (path === '/ack') { acks.push(JSON.parse(req.postData()).batchId); return reply(200, { ok: true, deleted: true }); }
    return reply(404, {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(({ worker, token }) => {
    const T = window.ExpenseLoggerTest;
    const noon = (d) => new Date(d + 'T12:00:00').getTime();
    localStorage.setItem('expenseLogger.sync.v1', JSON.stringify({ workerUrl: worker, deviceToken: token, pairedAt: new Date().toISOString(),
      lastAutoSyncAt: new Date().toISOString() })); // sync-on-open throttled; this test drives the button
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([
      { id: 'e-amt', amount: 12.34, categoryId: 'dining', note: 'Blue Bottle Coffee', ts: noon('2026-10-03'), importSource: 'card',
        accountId: 'acct-chase', importRowKey: 'plaid:m-amt', isTransfer: false },
      { id: 'e-gone', amount: 30.00, categoryId: 'fun', note: 'Fake Gym', ts: noon('2026-10-02'), importSource: 'bank',
        accountId: 'acct-checking', importRowKey: 'plaid:r-gone', isTransfer: false }
    ]));
    localStorage.setItem('expenseLogger.importRules.v1', JSON.stringify([{ id: 'rule1', pattern: T.descriptionMatchKey('FAKE CINEMA'), categoryId: 'bills' }]));
  }, { worker: WORKER, token: TOKEN });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab-btn[data-tab="settings"]');

  const ledger = async () => Object.fromEntries((await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')))).map((e) => [e.id, e]));
  const rows = () => page.evaluate(() => window.ExpenseLoggerTest.pendingImportRows());
  const waitRows = (key) => page.waitForFunction((k) => { const r = window.ExpenseLoggerTest.pendingImportRows(); return r && r.some((x) => x.importRowKey === k); }, key);
  const confirm = () => page.click('#importConfirmBtn');

  // Pass 1: flags shown, user does not tap them, so nothing changes.
  await page.click('#bankSyncNowBtn');
  await waitRows('plaid:m-amt');
  let r = await rows();
  const changed = r.find((x) => x.importRowKey === 'plaid:m-amt');
  assert.strictEqual(changed.status, 'changed');
  assert.strictEqual(changed.include, false, 'not applied without a tap');
  assert.strictEqual(cents(changed.oldAmount), 1234);
  assert.strictEqual(cents(changed.amount), 1500);
  assert.match(await page.locator('#importRowList').innerText(), /Changed since import: \$12\.34 → \$15\.00/);
  const cat = (k) => r.find((x) => x.importRowKey === k).categoryId;
  assert.strictEqual(cat('plaid:h-groc'), 'groceries', 'hint fills an Other row');
  assert.strictEqual(cat('plaid:h-rule'), 'bills', 'saved import rule beats the hint');
  assert.strictEqual(cat('plaid:h-unknown'), 'other', 'unknown category keeps the default');
  await confirm();
  await waitRows('plaid:r-gone');
  r = await rows();
  const gone = r.find((x) => x.importRowKey === 'plaid:r-gone');
  assert.strictEqual(gone.status, 'removed');
  assert.strictEqual(gone.include, false);
  assert.ok(!r.some((x) => x.importRowKey === 'plaid:never-imported'), 'removed rows never imported are ignored');
  assert.match(await page.locator('#importRowList').innerText(), /Bank removed this/);
  await confirm();
  await page.waitForFunction(() => !document.querySelector('#importModal.show'));
  await page.waitForTimeout(300);
  let L = await ledger();
  assert.strictEqual(cents(L['e-amt'].amount), 1234, 'original untouched until accepted');
  assert.ok(L['e-gone'], 'removed row still present until deleted');
  assert.strictEqual(cents(Object.values(L).find((e) => e.importRowKey === 'plaid:h-groc').amount), 2345);
  assert.strictEqual(Object.values(L).find((e) => e.importRowKey === 'plaid:h-groc').categoryId, 'groceries');
  assert.deepStrictEqual(acks, ['batch-1']);

  // Pass 2: same flags come back; tapping applies them.
  batch = 'batch-2';
  await page.click('#bankSyncNowBtn');
  await waitRows('plaid:m-amt');
  r = await rows();
  assert.strictEqual(r.find((x) => x.importRowKey === 'plaid:h-groc').status, 'duplicate', 'imported rows are not re-added');
  await page.click('[data-bank-change]');
  assert.strictEqual(await page.locator('[data-bank-change]').innerText(), 'Will update');
  await confirm();
  await waitRows('plaid:r-gone');
  await page.click('[data-bank-change]');
  await confirm();
  await page.waitForFunction(() => !document.querySelector('#importModal.show'));
  await page.waitForTimeout(300);
  L = await ledger();
  assert.strictEqual(cents(L['e-amt'].amount), 1500, 'accepted change applied');
  assert.strictEqual(L['e-amt'].note, 'Blue Bottle Coffee');
  assert.ok(!L['e-gone'], 'deleted after the tap');
  assert.deepStrictEqual(acks, ['batch-1', 'batch-2']);

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  server.close();
  console.log('sync-flags-test: all checks passed');
}

run().catch((e) => { console.error(e); server.close(); process.exit(1); });
