/**
 * Snapshot upload clears household dirty even when brief POST fails; brief retries without re-upload.
 * Fake fixtures only. Run: node scripts/household-brief-retry-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8945;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://household-brief-retry.example.test';
const SYNC_KEY = 'expenseLogger.sync.v1';
const HOUSE_PASS = 'expenseLogger.householdPass.v1';
const HOUSE_CFG = 'expenseLogger.household.v1';
const DEVICE = 'ab'.repeat(32);
const PASS = 'fake-passphrase-12';

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
let briefReject = true;

async function mockWorker(context) {
  await context.route(WORKER + '/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const auth = req.headers()['authorization'] || '';
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    calls.push({ path, auth, method: req.method(), body });
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/pair' && body.setupCode === 'fake-setup-code') {
      return reply(200, { deviceToken: DEVICE });
    }
    if (path === '/snapshot' && req.method() === 'POST') {
      if (auth !== 'Bearer ' + DEVICE) return reply(401, { error: 'unauthorized' });
      return reply(200, { ok: true });
    }
    if (path === '/brief' && req.method() === 'POST') {
      if (auth !== 'Bearer ' + DEVICE) return reply(401, { error: 'unauthorized' });
      if (briefReject) return reply(400, { error: 'brief_rejected' });
      return reply(200, { ok: true });
    }
    return reply(404, { error: 'not_found' });
  });
}

function snapshotPostCount() {
  return calls.filter((c) => c.path === '/snapshot' && c.method === 'POST').length;
}

function briefPostCount() {
  return calls.filter((c) => c.path === '/brief' && c.method === 'POST').length;
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
  await page.waitForTimeout(3500);

  calls.length = 0;
  await page.evaluate(() => {
    window.ExpenseLoggerTest.markHouseholdDirty();
  });
  await page.evaluate(() => window.ExpenseLoggerTest.uploadHouseholdMirror());
  await page.waitForFunction(() => {
    const h = JSON.parse(localStorage.getItem('expenseLogger.household.v1') || '{}');
    return h.dirty === false && h.briefDirty === true;
  });

  assert.strictEqual(snapshotPostCount(), 1, 'one snapshot upload');
  assert.strictEqual(briefPostCount(), 1, 'one brief attempt after snapshot');
  const cfgAfterFail = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), HOUSE_CFG);
  assert.strictEqual(cfgAfterFail.dirty, false);
  assert.strictEqual(cfgAfterFail.briefDirty, true);

  const snapBeforeReload = snapshotPostCount();
  const briefBeforeReload = briefPostCount();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  assert.strictEqual(snapshotPostCount(), snapBeforeReload, 'app open did not re-upload snapshot');
  assert.strictEqual(briefPostCount(), briefBeforeReload + 1, 'app open retried brief only');

  const snapBeforeRetry = snapshotPostCount();
  await page.evaluate(() => window.ExpenseLoggerTest.uploadHouseholdMirror());
  await page.waitForTimeout(300);
  assert.strictEqual(snapshotPostCount(), snapBeforeRetry, 'brief-only retry did not re-upload snapshot');
  assert.strictEqual(briefPostCount(), 2, 'brief retried');

  briefReject = false;
  await page.evaluate(() => window.ExpenseLoggerTest.retryHouseholdBriefUpload());
  await page.waitForFunction(() => {
    const h = JSON.parse(localStorage.getItem('expenseLogger.household.v1') || '{}');
    return h.briefDirty !== true;
  });
  assert.strictEqual(snapshotPostCount(), snapBeforeRetry, 'successful brief still did not re-upload snapshot');
  assert.strictEqual(briefPostCount(), 3, 'third brief attempt succeeded');

  assert.strictEqual(errors.length, 0, errors.join('; '));
  console.log('household-brief-retry-test: PASS');
  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
