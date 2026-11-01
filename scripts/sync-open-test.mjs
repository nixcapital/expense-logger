/**
 * Bank sync on app open (Plaid E, #51): runs after boot only when paired and online, is
 * throttled, opens the normal import review when rows come back, and stays quiet (no toast,
 * no ack) when nothing is new, on failure, or on discard. Mock Worker; fake data.
 * Run: node scripts/sync-open-test.mjs   (EL_ROOT if the repo is not at /workspace)
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8946;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://sync.example.test';
const TOKEN = '34'.repeat(32);
const SYNC_KEY = 'expenseLogger.sync.v1';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = join(ROOT, p);
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});

const ROW = { transaction_id: 'o-1', account_id: 'plaid-chk', amount: 4.56, iso_currency_code: 'USD', date: '2026-10-20', authorized_date: null,
  name: 'Fake Bakery', merchant_name: 'Fake Bakery', original_description: 'FAKE BAKERY 42', pending: false, pending_transaction_id: null, personal_finance_category: null };
let mode = 'rows'; // rows | empty | fail
const pulls = [];
const acks = [];

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 428, height: 926 } });
  await context.addInitScript(() => {
    if (sessionStorage.getItem('test.offline') === '1') Object.defineProperty(navigator, 'onLine', { get: () => false });
  });
  await context.route(WORKER + '/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/pull') {
      pulls.push(mode);
      if (mode === 'fail') return reply(500, { error: 'boom' });
      return reply(200, { batchId: mode === 'rows' ? 'open-1' : null, added: mode === 'rows' ? [ROW] : [], modified: [], removed: [],
        accounts: [{ itemId: 'i1', account_id: 'plaid-chk', appAccountId: 'acct-checking' }], needsReconnect: [], errors: [] });
    }
    if (path === '/ack') { acks.push(JSON.parse(req.postData()).batchId); return reply(200, { ok: true }); }
    return reply(404, {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const settle = () => page.waitForTimeout(2600); // auto sync starts 1.5 s after boot
  const toastShown = () => page.evaluate(() => document.getElementById('toast').classList.contains('show'));
  const setSync = (extra) => page.evaluate(({ k, w, t, extra }) => {
    if (extra === null) return localStorage.removeItem(k);
    localStorage.setItem(k, JSON.stringify(Object.assign({ workerUrl: w, deviceToken: t, pairedAt: new Date().toISOString() }, extra)));
  }, { k: SYNC_KEY, w: WORKER, t: TOKEN, extra });
  const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

  // 1. Not paired: no Worker call.
  await page.goto(url, { waitUntil: 'networkidle' });
  await settle();
  assert.strictEqual(pulls.length, 0, 'unpaired: no pull');

  // 2. Paired, never synced: pulls on open and opens the same import review as the button.
  await setSync({});
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#importModal.show', { timeout: 5000 });
  assert.deepStrictEqual(pulls, ['rows'], 'paired: one pull on open');
  const rows = await page.evaluate(() => window.ExpenseLoggerTest.pendingImportRows());
  assert.ok(rows.some((r) => r.importRowKey === 'plaid:o-1' && r.status === 'import'), 'review shows the bank row');
  const stamped = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SYNC_KEY)).lastAutoSyncAt;
  assert.ok(Date.now() - Date.parse(stamped) < 60000, 'throttle stamp written');
  await page.evaluate(() => window.ExpenseLoggerTest.requestDismissImportReview());
  await page.waitForTimeout(300);
  assert.deepStrictEqual(acks, [], 'discard never acks');

  // 3. Relaunch within the throttle window: no pull.
  await page.reload({ waitUntil: 'networkidle' });
  await settle();
  assert.strictEqual(pulls.length, 1, 'throttled: no second pull');
  await setSync({ lastAutoSyncAt: hoursAgo(1) });
  await page.reload({ waitUntil: 'networkidle' });
  await settle();
  assert.strictEqual(pulls.length, 1, 'throttled at 1 h');

  // 4. Throttle expired, nothing new: pulls, stays quiet (no toast, no review).
  mode = 'empty';
  await setSync({ lastAutoSyncAt: hoursAgo(5) });
  await page.reload({ waitUntil: 'networkidle' });
  await settle();
  assert.deepStrictEqual(pulls, ['rows', 'empty']);
  assert.strictEqual(await toastShown(), false, 'nothing new: no toast');
  assert.strictEqual(await page.locator('#importModal.show').count(), 0);

  // 5. Worker failure: quiet, no ack, and still throttled afterwards.
  mode = 'fail';
  await setSync({ lastAutoSyncAt: hoursAgo(5) });
  await page.reload({ waitUntil: 'networkidle' });
  await settle();
  assert.deepStrictEqual(pulls, ['rows', 'empty', 'fail']);
  assert.strictEqual(await toastShown(), false, 'failure: no toast');
  await page.reload({ waitUntil: 'networkidle' });
  await settle();
  assert.strictEqual(pulls.length, 3, 'failed attempt still throttles');

  // 6. Offline: no pull even when the throttle has expired.
  mode = 'rows';
  await setSync({ lastAutoSyncAt: hoursAgo(5) });
  await page.evaluate(() => sessionStorage.setItem('test.offline', '1'));
  await page.reload({ waitUntil: 'networkidle' });
  await settle();
  assert.strictEqual(pulls.length, 3, 'offline: no pull');
  assert.deepStrictEqual(acks, [], 'no ack in any quiet path');

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  server.close();
  console.log('sync-open-test: all checks passed');
}

run().catch((e) => { console.error(e); server.close(); process.exit(1); });
