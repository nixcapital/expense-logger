/**
 * Household mirror: encryption envelope, upload payload, view-mode writes, sync.v1 exclusion.
 * Fake fixtures only. Run: node scripts/household-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8944;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://household.example.test';
const SYNC_KEY = 'expenseLogger.sync.v1';
const HOUSE_PASS = 'expenseLogger.householdPass.v1';
const HOUSE_CFG = 'expenseLogger.household.v1';
const DEVICE = 'ab'.repeat(32);
const VIEWER = 'cd'.repeat(32);
const PASS = 'fake-passphrase-12';
const HOUSE_CODE = 'fake-household-code';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = join(ROOT, p);
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});

const calls = [];

async function mockWorker(context) {
  await context.route(WORKER + '/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const auth = req.headers()['authorization'] || '';
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    calls.push({ path, auth, body, raw: req.postData() || '' });
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/pair' && body.setupCode === 'fake-setup-code') {
      return reply(200, { deviceToken: DEVICE });
    }
    if (path === '/household/pair' && body.setupCode === HOUSE_CODE) {
      return reply(200, { viewerToken: VIEWER });
    }
    if (path === '/snapshot' && req.method() === 'GET') {
      if (auth === 'Bearer ' + VIEWER || auth === 'Bearer ' + DEVICE) {
        return reply(200, { id: 1, blob: global.__testBlob || '', createdAt: new Date().toISOString() });
      }
      return reply(401, { error: 'unauthorized' });
    }
    if (path === '/snapshot' && req.method() === 'POST') {
      if (auth !== 'Bearer ' + DEVICE) return reply(401, { error: 'unauthorized' });
      global.__testBlob = body.blob;
      return reply(200, { ok: true });
    }
    if (path === '/brief' && req.method() === 'POST') {
      if (auth !== 'Bearer ' + DEVICE) return reply(401, { error: 'unauthorized' });
      return reply(200, { ok: true });
    }
    return reply(404, { error: 'not_found' });
  });
}

function restoreDoc(format, id) {
  return {
    backupFormat: format,
    appVersion: format === 1 ? '1.3.1' : '2.4.0',
    createdAt: new Date().toISOString(),
    storage: {
      'expenseLogger.entries.v1': JSON.stringify([{ id, amount: 3.5, categoryId: 'groceries', note: 'fake', ts: Date.now() }]),
      'expenseLogger.categories.v1': JSON.stringify([{ id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }]),
      [SYNC_KEY]: JSON.stringify({ workerUrl: WORKER, deviceToken: 'evil'.repeat(32) })
    }
  };
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 428, height: 926 } });
  await mockWorker(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest && window.ExpenseHouseholdCrypto);

  // Pair writer + configure household passphrase
  await page.click('.tab-btn[data-tab="settings"]');
  await page.fill('#bankSyncUrl', WORKER + '/');
  await page.fill('#bankSyncCode', 'fake-setup-code');
  await page.click('#bankSyncPairBtn');
  await page.waitForFunction((k) => !!localStorage.getItem(k), SYNC_KEY);
  await page.waitForFunction(() => !document.getElementById('householdWriterForm').hidden);

  await page.fill('#householdPassInput', PASS);
  await page.click('#householdPassSaveBtn');
  await page.waitForFunction((k) => !!localStorage.getItem(k), HOUSE_PASS);

  await page.evaluate(() => {
    window.ExpenseLoggerTest.markHouseholdDirty();
    window.ExpenseLoggerTest.tryLocalStorageWrite('expenseLogger.entries.v1', JSON.stringify([
      { id: 'snap1', amount: 4, categoryId: 'groceries', note: 'mirror', ts: Date.now() }
    ]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  let snapCall = null;
  for (let i = 0; i < 40; i++) {
    snapCall = calls.find((c) => c.path === '/snapshot' && c.body && c.body.blob);
    if (snapCall) break;
    await page.waitForTimeout(500);
  }
  assert.ok(snapCall, 'snapshot uploaded');
  assert.ok(!snapCall.raw.includes(PASS), 'passphrase never in upload body');
  assert.ok(!snapCall.raw.includes(HOUSE_PASS), 'pass key name not uploaded');
  const backupJson = await page.evaluate(() => JSON.stringify(window.ExpenseLoggerBackup.buildBackupDocument()));
  assert.ok(!backupJson.includes(SYNC_KEY), 'snapshot doc excludes sync key');
  assert.ok(!backupJson.includes(DEVICE), 'snapshot doc excludes device token');

  const briefCall = calls.find((c) => c.path === '/brief');
  assert.ok(briefCall, 'brief uploaded');

  // Format 1 and 2 restore still work (from sync-pair-test pattern)
  for (const format of [1, 2]) {
    const id = 'hf' + format;
    const ok = await page.evaluate((doc) => window.ExpenseLoggerBackup.commitBackupRestore(doc), restoreDoc(format, id));
    assert.notStrictEqual(ok, false, 'format ' + format);
    const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).map((e) => e.id));
    assert.deepStrictEqual(ids, [id]);
  }

  // View mode blocks expenseLogger.* writes
  const callsBeforeView = calls.length;
  await page.evaluate(({ cfg, pass, syncKey }) => {
    localStorage.setItem(cfg, JSON.stringify({ role: 'viewer', workerUrl: 'https://household.example.test', viewerToken: 'ee'.repeat(32) }));
    localStorage.setItem(pass, 'viewer-passphrase-12');
    localStorage.removeItem(syncKey);
  }, { cfg: HOUSE_CFG, pass: HOUSE_PASS, syncKey: SYNC_KEY });
  await page.reload({ waitUntil: 'networkidle' });
  assert.strictEqual(await page.evaluate(() => window.ExpenseLoggerTest.isViewMode()), true);
  const blocked = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    const before = T.getLocalStorageRaw('expenseLogger.entries.v1');
    T.tryLocalStorageWrite('expenseLogger.entries.v1', '[]');
    T.trySaveEntries();
    return T.getLocalStorageRaw('expenseLogger.entries.v1') === before;
  });
  assert.ok(blocked, 'view mode did not overwrite entries');
  const viewCalls = calls.slice(callsBeforeView);
  assert.ok(!viewCalls.some((c) => c.path === '/pull'), 'view mode does not bank-sync pull');

  assert.strictEqual(errors.length, 0, errors.join('; '));
  console.log('household-test: PASS');
  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
