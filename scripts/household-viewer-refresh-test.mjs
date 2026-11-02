/**
 * Viewer phone refreshes to the newest household snapshot; view-mode writes stay blocked.
 * Fake fixtures only. Run: node scripts/household-viewer-refresh-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8945;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://household.example.test';
const SYNC_KEY = 'expenseLogger.sync.v1';
const HOUSE_PASS = 'expenseLogger.householdPass.v1';
const HOUSE_CFG = 'expenseLogger.household.v1';
const DEVICE = 'ab'.repeat(32);
const VIEWER = 'cd'.repeat(32);
const PASS = 'fake-passphrase-12';
const VIEWER_LAST = 'el.viewerLastSnapshotId.v1';

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
let snapId = 0;

async function mockWorker(context) {
  await context.route(WORKER + '/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const auth = req.headers()['authorization'] || '';
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    calls.push({ path, auth, body, method: req.method() });
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/pair' && body.setupCode === 'fake-setup-code') {
      return reply(200, { deviceToken: DEVICE });
    }
    if (path === '/snapshot' && req.method() === 'GET') {
      if (auth === 'Bearer ' + VIEWER) {
        return reply(200, {
          id: global.__testSnapId || 1,
          blob: global.__testBlob || '',
          createdAt: new Date().toISOString()
        });
      }
      if (auth === 'Bearer ' + DEVICE) {
        return reply(200, {
          id: global.__testSnapId || 1,
          blob: global.__testBlob || '',
          createdAt: new Date().toISOString()
        });
      }
      return reply(401, { error: 'unauthorized' });
    }
    if (path === '/snapshot' && req.method() === 'POST') {
      if (auth !== 'Bearer ' + DEVICE) return reply(401, { error: 'unauthorized' });
      global.__testBlob = body.blob;
      global.__testSnapId = ++snapId;
      return reply(200, { ok: true });
    }
    if (path === '/brief' && req.method() === 'POST') {
      if (auth !== 'Bearer ' + DEVICE) return reply(401, { error: 'unauthorized' });
      return reply(200, { ok: true });
    }
    return reply(404, { error: 'not_found' });
  });
}

function entryDoc(entryId) {
  return {
    backupFormat: 2,
    appVersion: '2.6.3',
    createdAt: new Date().toISOString(),
    storage: {
      'expenseLogger.entries.v1': JSON.stringify([
        { id: entryId, amount: 4, categoryId: 'groceries', note: 'mirror', ts: Date.now() }
      ]),
      'expenseLogger.categories.v1': JSON.stringify([
        { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
      ])
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

  await page.click('.tab-btn[data-tab="settings"]');
  await page.fill('#bankSyncUrl', WORKER + '/');
  await page.fill('#bankSyncCode', 'fake-setup-code');
  await page.click('#bankSyncPairBtn');
  await page.waitForFunction((k) => !!localStorage.getItem(k), SYNC_KEY);

  await page.fill('#householdPassInput', PASS);
  await page.click('#householdPassSaveBtn');
  await page.waitForFunction((k) => !!localStorage.getItem(k), HOUSE_PASS);

  const encOld = await page.evaluate(async (pass) => {
    const doc = {
      backupFormat: 2,
      appVersion: '2.6.3',
      createdAt: new Date().toISOString(),
      storage: {
        'expenseLogger.entries.v1': JSON.stringify([
          { id: 'snap-old', amount: 1, categoryId: 'groceries', note: 'old', ts: Date.now() }
        ]),
        'expenseLogger.categories.v1': JSON.stringify([
          { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
        ])
      }
    };
    const r = await window.ExpenseLoggerHousehold.encryptHouseholdSnapshot(pass, null);
    return r.blob;
  }, PASS);

  global.__testBlob = encOld;
  global.__testSnapId = 1;

  await page.evaluate(({ cfg, pass, syncKey, viewer, worker, lastKey }) => {
    localStorage.setItem(cfg, JSON.stringify({ role: 'viewer', workerUrl: worker, viewerToken: viewer }));
    localStorage.setItem(pass, 'fake-passphrase-12');
    localStorage.removeItem(syncKey);
    localStorage.setItem(lastKey, '1');
    window.ExpenseLoggerBackup.commitBackupRestore({
      backupFormat: 2,
      appVersion: '2.6.3',
      createdAt: new Date().toISOString(),
      storage: {
        'expenseLogger.entries.v1': JSON.stringify([
          { id: 'snap-old', amount: 1, categoryId: 'groceries', note: 'old', ts: Date.now() }
        ]),
        'expenseLogger.categories.v1': JSON.stringify([
          { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
        ])
      }
    });
  }, { cfg: HOUSE_CFG, pass: HOUSE_PASS, syncKey: SYNC_KEY, viewer: VIEWER, worker: WORKER, lastKey: VIEWER_LAST });

  await page.reload({ waitUntil: 'networkidle' });
  assert.strictEqual(await page.evaluate(() => window.ExpenseLoggerTest.isViewMode()), true);
  let ids = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).map((e) => e.id));
  assert.deepStrictEqual(ids, ['snap-old']);

  const encNew = await page.evaluate(async (pass) => {
    const doc = {
      backupFormat: 2,
      appVersion: '2.6.3',
      createdAt: new Date().toISOString(),
      storage: {
        'expenseLogger.entries.v1': JSON.stringify([
          { id: 'snap-new', amount: 9, categoryId: 'groceries', note: 'new', ts: Date.now() }
        ]),
        'expenseLogger.categories.v1': JSON.stringify([
          { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
        ])
      }
    };
    const r = await window.ExpenseHouseholdCrypto.encryptPlaintext(pass, null, JSON.stringify(doc));
    return r.blob;
  }, PASS);

  global.__testBlob = encNew;
  global.__testSnapId = 2;

  const getCallsBefore = calls.filter((c) => c.path === '/snapshot' && c.method === 'GET').length;
  await page.evaluate(() => window.ExpenseLoggerTest.refreshViewerHouseholdSnapshot(true));
  await page.waitForNavigation({ waitUntil: 'networkidle' });

  ids = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).map((e) => e.id));
  assert.deepStrictEqual(ids, ['snap-new'], 'viewer picked up newer snapshot');

  const viewerGets = calls.filter((c) => c.path === '/snapshot' && c.method === 'GET' && c.auth === 'Bearer ' + VIEWER);
  assert.ok(viewerGets.length >= getCallsBefore + 1, 'viewer token used for GET /snapshot');

  const blocked = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    const before = T.getLocalStorageRaw('expenseLogger.entries.v1');
    T.tryLocalStorageWrite('expenseLogger.entries.v1', '[]');
    T.trySaveEntries();
    return T.getLocalStorageRaw('expenseLogger.entries.v1') === before;
  });
  assert.ok(blocked, 'view mode still blocks expenseLogger writes');

  const backupJson = await page.evaluate(() => JSON.stringify(window.ExpenseLoggerBackup.buildBackupDocument()));
  assert.ok(!backupJson.includes(SYNC_KEY), 'backup excludes sync key');
  assert.ok(!backupJson.includes(VIEWER), 'backup excludes viewer token');

  assert.strictEqual(errors.length, 0, errors.join('; '));
  console.log('household-viewer-refresh-test: PASS');
  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
