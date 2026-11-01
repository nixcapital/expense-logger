/**
 * Bank sync flags + category hint tests (step F, #52) with a mocked Worker.
 * Run: node scripts/sync-flags-test.mjs   (EL_ROOT overrides the repo root)
 *
 * Covers: a modified Plaid row already in the ledger is flagged "changed
 * since import" with old + new values and the original entry is untouched
 * until the user accepts; a removed row is flagged "bank removed this" and
 * stays until the user chooses delete; a personal_finance_category hint
 * fills a row that would otherwise be Other; a saved import rule overrides
 * the hint. Money asserts in explicit cents.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8893;
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
const CHASE_ACCOUNTS = [{ account_id: 'plaid-chase', appAccountId: 'acct-chase', mask: '1111', type: 'credit' }];

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
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, deleted: true }) });
      return;
    }
    await route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ error: 'not_found' }) });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  const seedTs = await page.evaluate(() => new Date(2026, 9, 19, 12, 0, 0, 0).getTime());
  await page.evaluate((args) => {
    const [worker, ts] = args;
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' },
      { id: 'dining', name: 'Dining', emoji: '🍽️', color: '#ff922b' },
      { id: 'gas', name: 'Gas', emoji: '⛽', color: '#51cf66' },
      { id: 'bills', name: 'Bills', emoji: '📄', color: '#cc5de8' },
      { id: 'fun', name: 'Fun', emoji: '🎉', color: '#f783ac' },
      { id: 'other', name: 'Other', emoji: '📦', color: '#adb5bd' },
      { id: 'income', name: 'Income', emoji: '💵', color: '#34C77B' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([{
      id: 'led1', amount: 10, categoryId: 'other', note: 'Corner Shop', ts,
      importBatchId: 'plaid:batch-0', importRowKey: 'plaid:txn-m1', importSource: 'card',
      accountId: 'acct-chase', isTransfer: false, bankText: 'CORNER SHOP',
      importDedupeSnapshot: { ts, amount: 10, note: 'Corner Shop', categoryId: 'other', accountId: 'acct-chase', sign: 'out' }
    }]));
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.sync.v1', JSON.stringify({
      workerUrl: worker, deviceToken: 'cd'.repeat(32), pairedAt: new Date().toISOString()
    }));
  }, [WORKER, seedTs]);
  await page.reload({ waitUntil: 'networkidle' });

  const version = await page.evaluate(() => window.ExpenseLoggerTest.APP_VERSION);
  check('app version is 2.2.0', version === '2.2.0', version);

  async function entries() {
    return page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]'));
  }
  async function openSync() {
    await page.click('button[data-tab="settings"]');
    await page.click('#syncNowBtn');
    await page.waitForSelector('#importModal.show', { timeout: 5000 });
  }
  async function confirm() {
    await page.click('#importConfirmBtn');
    await page.waitForTimeout(700);
  }

  // --- Category hint fills an Other row ---
  pullPayload = {
    batchId: 'batch-hint-1',
    added: [{
      transaction_id: 'txn-groc', account_id: 'plaid-chase', amount: 42.5,
      date: '2026-10-24', authorized_date: '2026-10-24',
      name: 'FRESH MARKET', merchant_name: 'Fresh Market', original_description: 'FRESH MARKET',
      pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' }
    }],
    modified: [], removed: [], accounts: CHASE_ACCOUNTS, needsReconnect: [], errors: []
  };
  await openSync();
  let rows = await page.evaluate(() => window.ExpenseLoggerTest.getPendingImport().rows);
  check('groceries hint fills a row that would otherwise be Other',
    rows.length === 1 && rows[0].categoryId === 'groceries', JSON.stringify(rows.map((r) => r.categoryId)));
  await confirm();
  let es = await entries();
  const groc = es.find((e) => e.importRowKey === 'plaid:txn-groc');
  check('hinted row commits with the hint category, 4250 cents',
    !!groc && groc.categoryId === 'groceries' && cents(groc.amount) === 4250,
    groc ? groc.categoryId + '/' + cents(groc.amount) : 'missing');

  // --- A saved import rule overrides the hint ---
  await page.evaluate(() => {
    window.ExpenseLoggerTest.upsertImportRule('fresh market', { categoryId: 'dining', isTransfer: false, countAsSpending: true });
  });
  pullPayload = {
    batchId: 'batch-hint-2',
    added: [{
      transaction_id: 'txn-groc-2', account_id: 'plaid-chase', amount: 11.25,
      date: '2026-10-25', authorized_date: '2026-10-25',
      name: 'FRESH MARKET', merchant_name: 'Fresh Market', original_description: 'FRESH MARKET',
      pending: false, personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' }
    }],
    modified: [], removed: [], accounts: CHASE_ACCOUNTS, needsReconnect: [], errors: []
  };
  await openSync();
  rows = await page.evaluate(() => window.ExpenseLoggerTest.getPendingImport().rows);
  check('import rule overrides the hint', rows.length === 1 && rows[0].categoryId === 'dining',
    JSON.stringify(rows.map((r) => r.categoryId)));
  await confirm();

  // --- Modified row: flagged, untouched until accepted ---
  const modifiedTxn = {
    transaction_id: 'txn-m1', account_id: 'plaid-chase', amount: 15.5,
    date: '2026-10-20', authorized_date: '2026-10-19',
    name: 'CORNER SHOP RENAMED', merchant_name: 'Corner Shop Renamed', original_description: 'CORNER SHOP RENAMED',
    pending: false, personal_finance_category: null
  };
  pullPayload = { batchId: 'batch-mod-1', added: [], modified: [modifiedTxn], removed: [], accounts: CHASE_ACCOUNTS, needsReconnect: [], errors: [] };
  await openSync();
  rows = await page.evaluate(() => window.ExpenseLoggerTest.getPendingImport().rows);
  const mrow = rows[0] || {};
  check('modified row flagged with old and new values',
    rows.length === 1 && mrow.plaidModified === true && cents(mrow.oldAmount) === 1000 && cents(mrow.amount) === 1550,
    JSON.stringify({ old: mrow.oldAmount, next: mrow.amount, flag: mrow.plaidModified }));
  const summaryText = await page.locator('#importRowList').innerText();
  check('review shows "Changed since import"', /Changed since import/.test(summaryText));
  await confirm(); // no tap on "Use bank values"
  es = await entries();
  const led = es.find((e) => e.id === 'led1');
  check('unaccepted change leaves the original entry untouched',
    !!led && cents(led.amount) === 1000 && led.note === 'Corner Shop',
    led ? cents(led.amount) + '/' + led.note : 'missing');

  pullPayload = { batchId: 'batch-mod-2', added: [], modified: [modifiedTxn], removed: [], accounts: CHASE_ACCOUNTS, needsReconnect: [], errors: [] };
  await openSync();
  await page.click('#importRowList [data-expand="0"]');
  await page.waitForSelector('[data-plaid-accept="0"]', { timeout: 5000 });
  await page.click('[data-plaid-accept="0"]');
  await page.waitForTimeout(300);
  await confirm();
  es = await entries();
  const led2 = es.find((e) => e.id === 'led1');
  check('accepted change rewrites the entry in place (1550 cents, same id)',
    !!led2 && cents(led2.amount) === 1550 && led2.note === 'Corner Shop Renamed' && es.filter((e) => e.importRowKey === 'plaid:txn-m1').length === 1,
    led2 ? cents(led2.amount) + '/' + led2.note : 'missing');

  // --- Removed row: flagged, present until the user chooses delete ---
  pullPayload = {
    batchId: 'batch-rem-1', added: [], modified: [],
    removed: [{ transaction_id: 'txn-m1', account_id: 'plaid-chase' }],
    accounts: CHASE_ACCOUNTS, needsReconnect: [], errors: []
  };
  await openSync();
  rows = await page.evaluate(() => window.ExpenseLoggerTest.getPendingImport().rows);
  check('removed row flagged', rows.length === 1 && rows[0].plaidRemoved === true,
    JSON.stringify(rows.map((r) => !!r.plaidRemoved)));
  const listText = await page.locator('#importRowList').innerText();
  check('review shows "Bank removed this"', /Bank removed this/.test(listText));
  await confirm(); // no delete tap
  es = await entries();
  check('removed row still present until deleted', es.some((e) => e.id === 'led1'));

  pullPayload = {
    batchId: 'batch-rem-2', added: [], modified: [],
    removed: [{ transaction_id: 'txn-m1', account_id: 'plaid-chase' }],
    accounts: CHASE_ACCOUNTS, needsReconnect: [], errors: []
  };
  await openSync();
  await page.click('#importRowList [data-expand="0"]');
  await page.waitForSelector('[data-plaid-delete="0"]', { timeout: 5000 });
  await page.click('[data-plaid-delete="0"]');
  await page.waitForTimeout(300);
  await confirm();
  es = await entries();
  check('chosen delete removes the entry', !es.some((e) => e.id === 'led1'));

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
