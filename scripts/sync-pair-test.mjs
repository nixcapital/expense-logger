/**
 * Bank sync pairing (Plaid D, #50): pair, disconnect, and keep the device token
 * (expenseLogger.sync.v1) out of every backup and export. Mock Worker via Playwright route.
 * Run: node scripts/sync-pair-test.mjs   (set EL_ROOT if the repo is not at /workspace)
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8940;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://sync.example.test';
const SYNC_KEY = 'expenseLogger.sync.v1';
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

const calls = [];
async function mockWorker(context) {
  await context.route(WORKER + '/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    calls.push({ path, auth: req.headers()['authorization'] || '', body });
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/pair') return body.setupCode === 'fake-setup-code' ? reply(200, { deviceToken: TOKEN }) : reply(401, { error: 'bad_setup_code' });
    if (path === '/disconnect') return req.headers()['authorization'] === 'Bearer ' + TOKEN ? reply(200, { ok: true }) : reply(401, { error: 'unauthorized' });
    return reply(404, { error: 'not_found' });
  });
}

function restoreDoc(format, id) {
  return {
    backupFormat: format,
    appVersion: format === 1 ? '1.3.1' : '1.9.9',
    createdAt: new Date().toISOString(),
    storage: {
      'expenseLogger.entries.v1': JSON.stringify([{ id, amount: 12.34, categoryId: 'groceries', note: 'fake', ts: Date.now() }]),
      'expenseLogger.categories.v1': JSON.stringify([{ id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }]),
      // A hostile or hand-edited backup must not be able to plant a device token.
      [SYNC_KEY]: JSON.stringify({ workerUrl: 'https://evil.example.test', deviceToken: 'cd'.repeat(32) })
    }
  };
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 428, height: 926 }, acceptDownloads: true });
  await mockWorker(context);
  // No share sheet in tests: exports fall back to a plain download.
  await context.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.click('.tab-btn[data-tab="settings"]');
  assert.strictEqual(await page.locator('#bankSyncStatus').innerText(), 'Not paired');

  // Wrong setup code: nothing stored.
  await page.fill('#bankSyncUrl', WORKER + '/');
  await page.fill('#bankSyncCode', 'wrong-code');
  await page.click('#bankSyncPairBtn');
  await page.waitForFunction(() => /not accepted/.test(document.getElementById('toast').textContent));
  assert.strictEqual(await page.evaluate((k) => localStorage.getItem(k), SYNC_KEY), null, 'bad code stores nothing');

  // Right code: key holds {workerUrl, deviceToken, pairedAt}; setup code is not kept.
  await page.fill('#bankSyncCode', 'fake-setup-code');
  await page.click('#bankSyncPairBtn');
  await page.waitForFunction((k) => !!localStorage.getItem(k), SYNC_KEY);
  const stored = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SYNC_KEY));
  assert.strictEqual(stored.workerUrl, WORKER, 'trailing slash trimmed');
  assert.strictEqual(stored.deviceToken, TOKEN);
  assert.ok(!isNaN(Date.parse(stored.pairedAt)), 'pairedAt is a date');
  assert.ok(!JSON.stringify(stored).includes('fake-setup-code'), 'setup code not stored');
  assert.strictEqual(await page.inputValue('#bankSyncCode'), '', 'setup code field cleared');
  assert.match(await page.locator('#bankSyncStatus').innerText(), /^Paired with sync\.example\.test/);
  assert.strictEqual(await page.locator('#bankSyncPairForm').isHidden(), true);

  // Backups and exports never carry the token or the key name.
  await page.evaluate(() => localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([
    { id: 'seed1', amount: 5, categoryId: 'groceries', note: 'fake seed', ts: Date.now() }
  ])));
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab-btn[data-tab="settings"]');
  const backupJson = await page.evaluate(() => JSON.stringify(window.ExpenseLoggerBackup.buildBackupDocument()));
  const undoKeys = await page.evaluate(() => JSON.stringify(window.ExpenseLoggerBackup.collectExpenseLoggerKeys()));
  for (const [label, text] of [['backup', backupJson], ['undo snapshot', undoKeys]]) {
    assert.ok(!text.includes(SYNC_KEY), label + ' must not contain ' + SYNC_KEY);
    assert.ok(!text.includes(TOKEN), label + ' must not contain the device token');
  }
  for (const btn of ['#backupDataBtn', '#exportJsonBtn', '#exportBtn']) {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click(btn)]);
    const text = readFileSync(await dl.path(), 'utf8');
    assert.ok(text.length > 0, btn + ' produced a file');
    assert.ok(!text.includes(SYNC_KEY) && !text.includes(TOKEN), btn + ' file must not contain the token');
  }

  // Format 1 and 2 backups still restore, and restore + undo leave the pairing alone.
  for (const format of [1, 2]) {
    const id = 'restored-f' + format;
    const r = await page.evaluate((doc) => window.ExpenseLoggerBackup.commitBackupRestore(doc), restoreDoc(format, id));
    assert.notStrictEqual(r, false, 'format ' + format + ' restore applied');
    const after = await page.evaluate((k) => ({
      ids: JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).map((e) => e.id),
      sync: localStorage.getItem(k)
    }), SYNC_KEY);
    assert.deepStrictEqual(after.ids, [id], 'format ' + format + ' entries restored');
    assert.strictEqual(JSON.parse(after.sync).deviceToken, TOKEN, 'restore keeps this phone paired (format ' + format + ')');
  }
  await page.click('#undoBtn');
  await page.waitForTimeout(300);
  assert.strictEqual(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), SYNC_KEY)).deviceToken, TOKEN, 'undo keeps pairing');

  // Disconnect calls the Worker with the bearer token and clears the key.
  page.once('dialog', (d) => d.accept());
  await page.click('#bankSyncDisconnectBtn');
  await page.waitForFunction((k) => localStorage.getItem(k) === null, SYNC_KEY);
  const disc = calls.filter((c) => c.path === '/disconnect');
  assert.strictEqual(disc.length, 1);
  assert.strictEqual(disc[0].auth, 'Bearer ' + TOKEN);
  assert.strictEqual(await page.locator('#bankSyncStatus').innerText(), 'Not paired');

  // link.html is static (no app code or keys) and the service worker never precaches it.
  assert.ok(!/app\.js|expenseLogger\./.test(readFileSync(join(ROOT, 'link.html'), 'utf8')), 'link.html has no app code');
  assert.ok(!/SHELL_URLS = \[[^\]]*link\.html/.test(readFileSync(join(ROOT, 'sw.js'), 'utf8')), 'link.html not precached');

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  server.close();
  console.log('sync-pair-test: all checks passed');
}

run().catch((e) => { console.error(e); server.close(); process.exit(1); });
