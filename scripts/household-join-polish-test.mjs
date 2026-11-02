/**
 * Household join: confirm before replace, cancel/confirm paths, join error toast.
 * Fake fixtures only. Run: node scripts/household-join-polish-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8946;
const ROOT = process.env.EL_ROOT || '/workspace';
const WORKER = 'https://household.example.test';
const SYNC_KEY = 'expenseLogger.sync.v1';
const HOUSE_CFG = 'expenseLogger.household.v1';
const HOUSE_PASS = 'expenseLogger.householdPass.v1';
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

let pairFailNetwork = false;

async function mockWorker(context) {
  await context.route(WORKER + '/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    const reply = (status, data) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/household/pair') {
      if (pairFailNetwork) return route.abort('failed');
      if (body.setupCode === HOUSE_CODE) return reply(200, { viewerToken: VIEWER });
      return reply(401, { error: 'bad_setup_code' });
    }
    if (path === '/snapshot' && req.method() === 'GET') {
      if (req.headers()['authorization'] === 'Bearer ' + VIEWER) {
        return reply(200, {
          id: 1,
          blob: global.__testBlob || '',
          createdAt: new Date().toISOString()
        });
      }
      return reply(401, { error: 'unauthorized' });
    }
    return reply(404, { error: 'not_found' });
  });
}

async function encryptDoc(page, entryId) {
  return page.evaluate(async ({ pass, entryId }) => {
    const doc = {
      backupFormat: 2,
      appVersion: '2.6.2',
      createdAt: new Date().toISOString(),
      storage: {
        'expenseLogger.entries.v1': JSON.stringify([
          { id: entryId, amount: 7, categoryId: 'groceries', note: 'household', ts: Date.now() }
        ]),
        'expenseLogger.categories.v1': JSON.stringify([
          { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
        ])
      }
    };
    const r = await window.ExpenseHouseholdCrypto.encryptPlaintext(pass, null, JSON.stringify(doc));
    return r.blob;
  }, { pass: PASS, entryId });
}

const REF_SHEET_ID = 'backupRestoreModal';
const HOUSEHOLD_SHEET_IDS = ['householdJoinSheet', 'householdJoinConfirmSheet', 'householdRestoreSheet'];

async function sheetModalBackground(page, sheetId) {
  return page.evaluate((id) => {
    const ov = document.getElementById(id);
    ov.hidden = false;
    ov.classList.add('show');
    const modal = ov.querySelector('.modal');
    return getComputedStyle(modal).backgroundColor;
  }, sheetId);
}

async function assertHouseholdSheetStyles(page) {
  const refBg = await sheetModalBackground(page, REF_SHEET_ID);
  for (const id of HOUSEHOLD_SHEET_IDS) {
    const bg = await sheetModalBackground(page, id);
    assert.strictEqual(bg, refBg, id + ' modal background matches ' + REF_SHEET_ID);
  }
  await page.evaluate(({ householdIds, refId }) => {
    householdIds.concat([refId]).forEach((id) => {
      const ov = document.getElementById(id);
      if (!ov) return;
      ov.classList.remove('show');
      if (id !== refId) ov.hidden = true;
    });
  }, { householdIds: HOUSEHOLD_SHEET_IDS, refId: REF_SHEET_ID });
}

async function accessibleName(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return '';
    if (el.labels && el.labels.length) return el.labels[0].textContent.trim();
    return el.getAttribute('aria-label') || '';
  }, selector);
}

async function assertJoinFieldAccessibleNames(page) {
  await page.click('#householdJoinOpenBtn');
  await page.waitForSelector('#householdJoinSheet.show');
  assert.strictEqual(await accessibleName(page, '#householdJoinUrl'), 'Worker URL');
  assert.strictEqual(await accessibleName(page, '#householdJoinCode'), 'Household setup code');
  assert.strictEqual(await accessibleName(page, '#householdJoinPass'), 'Household passphrase');
  await page.click('#householdJoinCancelBtn');
  await page.waitForFunction(() => document.getElementById('householdJoinSheet').hidden);
}

async function assertRestoreFieldAccessibleName(page) {
  await page.evaluate(() => {
    const ov = document.getElementById('householdRestoreSheet');
    ov.hidden = false;
    ov.classList.add('show');
  });
  assert.strictEqual(await accessibleName(page, '#householdRestorePass'), 'Household passphrase');
  await page.evaluate(() => {
    const ov = document.getElementById('householdRestoreSheet');
    ov.hidden = true;
    ov.classList.remove('show');
  });
}

async function fillJoinForm(page) {
  await page.click('#householdJoinOpenBtn');
  await page.fill('#householdJoinUrl', WORKER + '/');
  await page.fill('#householdJoinCode', HOUSE_CODE);
  await page.fill('#householdJoinPass', PASS);
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 428, height: 926 },
    colorScheme: 'dark'
  });
  await mockWorker(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest && window.ExpenseHouseholdCrypto);

  global.__testBlob = await encryptDoc(page, 'from-household');

  await page.evaluate(() => {
    window.ExpenseLoggerTest.tryLocalStorageWrite('expenseLogger.entries.v1', JSON.stringify([
      { id: 'local-kept', amount: 2, categoryId: 'groceries', note: 'local', ts: Date.now() }
    ]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab-btn[data-tab="settings"]');

  await assertHouseholdSheetStyles(page);
  await assertJoinFieldAccessibleNames(page);
  await assertRestoreFieldAccessibleName(page);

  await fillJoinForm(page);
  await page.click('#householdJoinBtn');
  await page.waitForSelector('#householdJoinConfirmSheet.show');
  await page.click('#householdJoinConfirmCancelBtn');
  await page.waitForFunction(() => document.getElementById('householdJoinConfirmSheet').hidden);

  let ids = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).map((e) => e.id));
  assert.deepStrictEqual(ids, ['local-kept'], 'cancel keeps local entries');
  assert.strictEqual(await page.evaluate((k) => localStorage.getItem(k), HOUSE_CFG), null, 'cancel does not save viewer config');

  await page.click('#householdJoinBtn');
  await page.waitForSelector('#householdJoinConfirmSheet.show');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('#householdJoinConfirmBtn')
  ]);
  assert.strictEqual(await page.evaluate(() => window.ExpenseLoggerTest.isViewMode()), true);
  ids = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).map((e) => e.id));
  assert.deepStrictEqual(ids, ['from-household'], 'confirm replaces with household copy');

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab-btn[data-tab="settings"]');
  pairFailNetwork = true;
  await fillJoinForm(page);
  await page.click('#householdJoinBtn');
  await page.waitForFunction(() => /Could not reach the Worker/.test(document.getElementById('toast').textContent));
  assert.strictEqual(await page.locator('#householdJoinBtn').isEnabled(), true, 'join button re-enabled after error');

  assert.strictEqual(errors.length, 0, errors.join('; '));
  console.log('household-join-polish-test: PASS');
  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
