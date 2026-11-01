/**
 * Bank sync balances + Reconnect banner (Plaid G, #53). Mock Worker via Playwright route; fake data.
 * Run: node scripts/sync-balance-test.mjs   (EL_ROOT if not /workspace)
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8943;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://sync.example.test';
const TOKEN = 'ab'.repeat(32);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = join(ROOT, p);
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});

const cents = (n) => Math.round(n * 100);
const now = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
const txn = (id, acct, amount, date, name) => ({
  transaction_id: id, account_id: acct, amount, iso_currency_code: 'USD', date, authorized_date: null, name, merchant_name: null,
  original_description: name.toUpperCase() + ' FAKE', pending: false, pending_transaction_id: null, personal_finance_category: null
});
let state = {
  added: [txn('k1', 'plaid-chk', 20.00, iso(yday), 'Fake Cafe'), txn('k2', 'plaid-card', 30.00, iso(yday), 'Fake Store')],
  needsReconnect: [], batchId: 'b1'
};
const ACCOUNTS = () => [
  { itemId: 'i1', account_id: 'plaid-chk', appAccountId: 'acct-checking', type: 'depository', current: 1234.56, available: 1200 },
  { itemId: 'i2', account_id: 'plaid-card', appAccountId: 'acct-chase', type: 'credit', current: 987.65, available: null }
];
const acks = [];

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 428, height: 926 } });
  await context.route(WORKER + '/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (req.headers()['authorization'] !== 'Bearer ' + TOKEN) return reply(401, {});
    if (path === '/pull') return reply(200, { batchId: state.batchId, added: state.added, modified: [], removed: [], accounts: ACCOUNTS(), needsReconnect: state.needsReconnect, errors: [] });
    if (path === '/ack') { acks.push(JSON.parse(req.postData()).batchId); return reply(200, { ok: true }); }
    return reply(404, {});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(({ worker, token }) => {
    localStorage.setItem('expenseLogger.sync.v1', JSON.stringify({ workerUrl: worker, deviceToken: token, pairedAt: new Date().toISOString(),
      lastAutoSyncAt: new Date().toISOString() }));
  }, { worker: WORKER, token: TOKEN });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab-btn[data-tab="settings"]');

  const accts = () => page.evaluate(() => Object.fromEntries(window.ExpenseLoggerTest.getState().accounts.map((a) => [a.id, a])));
  const todayKey = iso(now);

  // 1. Offer appears off by default, for checking and then for the card.
  await page.click('#bankSyncNowBtn');
  await page.waitForSelector('#importModal.show');
  assert.ok(await page.locator('#importBalanceUseBtn').count(), 'checking offer shown');
  assert.strictEqual(await page.getAttribute('#importBalanceUseBtn', 'aria-pressed'), 'false', 'offer starts off');
  assert.match(await page.textContent('.import-balance-offer-title'), /\$1,234\.56/);
  const beforeChk = (await accts())['acct-checking'];
  // Not using the offer leaves the balance alone.
  await page.click('#importConfirmBtn');
  await page.waitForFunction(() => { const r = window.ExpenseLoggerTest.pendingImportRows(); return r && r.some((x) => x.importRowKey === 'plaid:k2'); });
  assert.deepStrictEqual((await accts())['acct-checking'].currentBalance, beforeChk.currentBalance, 'unused offer changes nothing');
  assert.ok(await page.locator('#importBalanceUseBtn').count(), 'card offer shown');
  assert.match(await page.textContent('.import-balance-offer-title'), /\$987\.65/);
  await page.click('#importBalanceUseBtn');
  assert.strictEqual(await page.getAttribute('#importBalanceUseBtn', 'aria-pressed'), 'true');
  await page.click('#importConfirmBtn');
  await page.waitForFunction(() => !document.querySelector('#importModal.show'));
  await page.waitForTimeout(300);
  const chase = (await accts())['acct-chase'];
  assert.strictEqual(cents(chase.currentBalance), 98765, 'card owed set from bank');
  assert.strictEqual(chase.balanceAsOf, todayKey, 'anchor is today');
  assert.deepStrictEqual(acks, ['b1']);

  // 2. Using the checking offer sets balance and date.
  state = { added: [txn('k3', 'plaid-chk', 5.00, iso(yday), 'Fake Cafe Two')], needsReconnect: [], batchId: 'b2' };
  await page.click('#bankSyncNowBtn');
  await page.waitForSelector('#importModal.show');
  await page.click('#importBalanceUseBtn');
  await page.click('#importConfirmBtn');
  await page.waitForFunction(() => !document.querySelector('#importModal.show'));
  await page.waitForTimeout(300);
  const chk = (await accts())['acct-checking'];
  assert.strictEqual(cents(chk.currentBalance), 123456);
  assert.strictEqual(chk.balanceAsOf, todayKey);

  // 3. Reconnect banner: shown with the right link, hidden once the Worker stops reporting it.
  state = { added: [], needsReconnect: ['i2'], batchId: null };
  await page.click('#bankSyncNowBtn');
  await page.waitForSelector('#bankSyncReconnect a');
  const href = await page.getAttribute('#bankSyncReconnect a', 'href');
  assert.strictEqual(href, 'link.html?update=i2&worker=' + encodeURIComponent(WORKER));
  assert.match(await page.textContent('#bankSyncReconnect'), /Reconnect Chase card/);
  state = { added: [], needsReconnect: [], batchId: null };
  await page.click('#bankSyncNowBtn');
  await page.waitForFunction(() => document.getElementById('bankSyncReconnect').hidden);

  // 4. link.html update mode: asks the Worker for an update token for that Item, not a new link.
  let linkBody = null;
  await context.route(WORKER + '/link/token', async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    linkBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ linkToken: 'link-sandbox-FAKE' }) });
  });
  await context.route('https://cdn.plaid.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.Plaid={create:function(c){window.__plaidCfg=c;return{open:function(){window.__plaidOpened=true;}};}};' }));
  const link = await context.newPage();
  await link.goto(`http://127.0.0.1:${PORT}/link.html?update=i2&worker=${encodeURIComponent(WORKER)}`);
  assert.strictEqual(await link.inputValue('#worker'), WORKER);
  await link.fill('#code', 'fake-setup-code');
  await link.click('#go');
  await link.waitForFunction(() => window.__plaidOpened === true);
  assert.deepStrictEqual(linkBody, { itemId: 'i2' });
  // success in update mode skips the account mapping
  await link.evaluate(() => window.__plaidCfg.onSuccess('public-sandbox-FAKE', {}));
  assert.ok(await link.locator('#map').isHidden(), 'no account mapping in update mode');
  assert.match(await link.textContent('#msg'), /Reconnected/);

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  server.close();
  console.log('sync-balance-test: all checks passed');
}

run().catch((e) => { console.error(e); server.close(); process.exit(1); });
