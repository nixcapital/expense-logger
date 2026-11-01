/**
 * Bank sync pairing tests (step D, #50) with a mocked Worker.
 * Run: node scripts/sync-pair-test.mjs   (EL_ROOT overrides the repo root)
 *
 * Covers: pairing stores expenseLogger.sync.v1; the device token and the sync
 * key never appear in a backup; disconnect calls /disconnect and clears the
 * key; a restore keeps the pairing; backup formats 1 and 2 still restore.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8891;
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
  results.push([name, !!ok, detail || '']);
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());

  // Mock Worker: /pair issues the fake token; /disconnect records its auth.
  const workerCalls = [];
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
    workerCalls.push({
      path: url.pathname,
      method: req.method(),
      auth: req.headers()['authorization'] || '',
      body: req.postData() || ''
    });
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (url.pathname === '/pair') {
      const body = JSON.parse(req.postData() || '{}');
      if (body.setupCode !== 'fake-setup-code') {
        await route.fulfill({ status: 401, headers: cors, body: JSON.stringify({ error: 'bad_setup_code' }) });
        return;
      }
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ deviceToken: DEVICE_TOKEN }) });
      return;
    }
    if (url.pathname === '/disconnect') {
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ error: 'not_found' }) });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' },
      { id: 'other', name: 'Other', emoji: '📦', color: '#adb5bd' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([
      { id: 'e1', amount: 12.5, categoryId: 'groceries', note: 'fake seed', ts: Date.now() - 86400000 }
    ]));
  });
  await page.reload({ waitUntil: 'networkidle' });

  const version = await page.evaluate(() => window.ExpenseLoggerTest.APP_VERSION);
  check('app version is 2.1.0', version === '2.1.0', version);

  // Pair through the real Settings UI.
  await page.click('button[data-tab="settings"]');
  await page.fill('#syncWorkerUrl', WORKER);
  await page.fill('#syncSetupCode', 'fake-setup-code');
  await page.click('#syncPairBtn');
  await page.waitForFunction(() => !!localStorage.getItem('expenseLogger.sync.v1'), { timeout: 5000 });

  const syncRaw = await page.evaluate(() => localStorage.getItem('expenseLogger.sync.v1'));
  const sync = JSON.parse(syncRaw);
  check('pairing stores workerUrl + device token + pairedAt',
    sync.workerUrl === WORKER && sync.deviceToken === DEVICE_TOKEN && !!sync.pairedAt,
    JSON.stringify(Object.keys(sync)));
  const pairCall = workerCalls.find((c) => c.path === '/pair');
  check('pair posted the setup code', !!pairCall && JSON.parse(pairCall.body).setupCode === 'fake-setup-code');
  const statusText = await page.locator('#syncStatusLine').innerText();
  check('status line shows paired', /Paired/.test(statusText), statusText);

  // The token and its key must never appear in a backup or export payload.
  const backupLeak = await page.evaluate(() => {
    const B = window.ExpenseLoggerBackup;
    const docJson = JSON.stringify(B.buildBackupDocument());
    const keys = Object.keys(B.collectExpenseLoggerKeys());
    return {
      docHasToken: docJson.includes('cd'.repeat(32)),
      docHasSyncKey: docJson.includes('expenseLogger.sync.v1'),
      collectedHasSyncKey: keys.includes('expenseLogger.sync.v1')
    };
  });
  check('backup document has no device token', backupLeak.docHasToken === false);
  check('backup document has no sync key', backupLeak.docHasSyncKey === false);
  check('collected backup keys exclude the sync key', backupLeak.collectedHasSyncKey === false);

  // Restores (formats 1 and 2) still work and never delete the pairing.
  for (const fmt of [1, 2]) {
    const restored = await page.evaluate(async (format) => {
      const B = window.ExpenseLoggerBackup;
      const okRestore = await B.commitBackupRestore({
        backupFormat: format,
        appVersion: '1.3.1',
        createdAt: new Date().toISOString(),
        storage: {
          'expenseLogger.entries.v1': JSON.stringify([
            { id: 'fmt' + format, amount: 42, categoryId: 'groceries', note: 'restored fake', ts: Date.now() }
          ]),
          'expenseLogger.categories.v1': JSON.stringify([
            { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
          ]),
          'expenseLogger.budgets.v1': JSON.stringify({}),
          'expenseLogger.recurring.v1': JSON.stringify([]),
          'expenseLogger.importSettings.v1': JSON.stringify({ countCardPayments: false }),
          'expenseLogger.ui.v1': JSON.stringify({ tab: 'summary' })
        }
      });
      const entries = JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]');
      return {
        okRestore,
        entryIds: entries.map((e) => e.id),
        syncKept: localStorage.getItem('expenseLogger.sync.v1')
      };
    }, fmt);
    check('format ' + fmt + ' backup restores', restored.okRestore === true && restored.entryIds.includes('fmt' + fmt),
      JSON.stringify(restored.entryIds));
    check('format ' + fmt + ' restore keeps the pairing', restored.syncKept === syncRaw);
  }

  // Even a backup that (maliciously) contains a sync key must not overwrite it.
  const hostile = await page.evaluate(async () => {
    const B = window.ExpenseLoggerBackup;
    await B.commitBackupRestore({
      backupFormat: 2,
      appVersion: '2.0.0',
      createdAt: new Date().toISOString(),
      storage: {
        'expenseLogger.entries.v1': JSON.stringify([{ id: 'h1', amount: 1, categoryId: 'groceries', ts: Date.now() }]),
        'expenseLogger.sync.v1': JSON.stringify({ workerUrl: 'https://evil.test', deviceToken: 'evil' })
      }
    });
    return localStorage.getItem('expenseLogger.sync.v1');
  });
  check('backup cannot overwrite the pairing', hostile === syncRaw);

  // Disconnect: Worker is called with the bearer token and the key is cleared.
  await page.click('button[data-tab="settings"]');
  await page.click('#syncDisconnectBtn');
  await page.waitForFunction(() => !localStorage.getItem('expenseLogger.sync.v1'), { timeout: 5000 });
  const discCall = workerCalls.find((c) => c.path === '/disconnect');
  check('disconnect called the Worker with the device token',
    !!discCall && discCall.auth === 'Bearer ' + DEVICE_TOKEN, discCall ? discCall.auth.slice(0, 12) + '…' : 'no call');
  check('disconnect cleared the sync key', true);
  const statusAfter = await page.locator('#syncStatusLine').innerText();
  check('status line shows not paired after disconnect', /Not paired/.test(statusAfter), statusAfter);

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
