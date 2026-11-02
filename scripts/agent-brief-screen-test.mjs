/**
 * Settings agent brief: preview, Copy, and Save file are one payload.
 * Fake fixtures only. Run: node scripts/agent-brief-screen-test.mjs
 */
import assert from 'assert';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const PORT = 8951;
const ROOT = process.env.EL_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWPORT = { width: 428, height: 926 };
const SYNC_KEY = 'expenseLogger.sync.v1';
const TOKEN = 'sync-v1-SECRET-TOKEN';
const SECRETS = [
  SYNC_KEY, TOKEN, '****4491', '001122334455', 'plaid-acct-FAKE99', 'plaid-txn-FAKE99',
  'tok_BRIEF_DEVICE_SECRET', 'RAW-BANKTEXT-SECRET', 'receipt-blob-SECRET', 'idb-receipt-SECRET',
  'txn-row-SECRETID', 'item-PLAIDITEM-SECRET', 'acct-checking', 'acct-chase',
  'Chase Payment', 'Should Not Count'
];
const FORBIDDEN_KEYS = [
  'banktext', 'mask', 'accountnumber', 'account_number', 'plaidaccountid', 'plaidtransactionid',
  'plaid', 'receipt', 'receiptid', 'accesstoken', 'access_token', 'transaction_id', 'transactionid',
  'itemid', 'note', 'accountid', 'categoryid', 'entries', 'sync', 'token', 'blob', 'image',
  'expenselogger.sync.v1', 'id', 'devicetoken', 'ts'
];

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'app.js'), 'utf8');
assert.ok(html.includes('brief.js?v=2.6.3'));
assert.ok(readFileSync(join(ROOT, 'sw.js'), 'utf8').includes("CACHE_VERSION = 'expense-logger-v2.6.3'"));
assert.ok(appSrc.includes("APP_VERSION = '2.6.3'"));
const copyFn = appSrc.slice(appSrc.indexOf('function copyAgentBrief('), appSrc.indexOf('function saveAgentBriefFile'));
const saveFn = appSrc.slice(appSrc.indexOf('function saveAgentBriefFile'), appSrc.indexOf('function exportCSV'));
assert.ok(!/publishAgentBrief|buildAgentBrief|Date\.now\(/.test(copyFn + saveFn));

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function stamp(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
const now = new Date();
const y = now.getFullYear();
const m = now.getMonth();
const prev = new Date(y, m - 1, 1);
const at = (yy, mm, day) => new Date(yy, mm, day, 12, 0, 0).getTime();

const fixture = {
  entries: [
    { id: 'txn-row-SECRETID', amount: 42.25, note: 'Northwind Market', ts: at(prev.getFullYear(), prev.getMonth(), 6), accountId: 'acct-chase', categoryId: 'groceries', bankText: 'RAW-BANKTEXT-SECRET', plaidTransactionId: 'plaid-txn-FAKE99', receiptId: 'receipt-blob-SECRET', receipt: { blob: 'receipt-blob-SECRET' }, deviceToken: TOKEN },
    { id: 'pay-in', amount: 4000, note: 'Example Payroll', ts: at(prev.getFullYear(), prev.getMonth(), 1), accountId: 'acct-checking', categoryId: 'income', isDeposit: true },
    { id: 'rent', amount: 1500, note: 'Harbor Rent', ts: at(prev.getFullYear(), prev.getMonth(), 2), accountId: 'acct-checking', categoryId: 'bills' },
    { id: 'pay-chk', amount: 80, note: 'Chase Payment', ts: at(y, m, 2), accountId: 'acct-checking', categoryId: 'bills', isTransfer: true },
    { id: 'skip', amount: 77.77, note: 'Should Not Count', ts: at(y, m, 3), accountId: 'acct-chase', categoryId: 'fun', excluded: true }
  ],
  accounts: [
    { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997', currentBalance: 3149.4, balanceAsOf: stamp(now), mask: '****4491', accountNumber: '001122334455', plaidAccountId: 'plaid-acct-FAKE99', itemId: 'item-PLAIDITEM-SECRET', accessToken: 'tok_BRIEF_DEVICE_SECRET' },
    { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC', currentBalance: 1840.4, balanceAsOf: stamp(prev), mask: '****4491' }
  ],
  recurring: [{ id: 'r-stream', amount: 17.99, categoryId: 'fun', note: 'Picnic Streaming', dayOfMonth: 15 }]
};

function assertClean(raw) {
  const brief = JSON.parse(raw);
  SECRETS.forEach((secret) => assert.ok(!raw.includes(secret), 'leaked ' + secret));
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    Object.keys(node).forEach((key) => {
      assert.ok(!FORBIDDEN_KEYS.includes(key.toLowerCase()), 'forbidden key ' + key);
      walk(node[key]);
    });
  })(brief);
  assert.strictEqual(brief.schema, 1);
  assert.match(brief.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  if (brief.level === 'L0') {
    assert.ok(!('upcomingBills' in brief) && !('topMerchants' in brief));
    assert.ok(!/Northwind|Picnic Streaming|Harbor Rent/.test(raw));
  } else {
    assert.ok(brief.upcomingBills.some((bill) => bill.name === 'Picnic Streaming'));
    assert.ok(JSON.stringify(brief.topMerchants).includes('Northwind'));
  }
  ['checking', 'chaseOwed'].forEach((key) => {
    const n = brief.balances[key];
    if (typeof n === 'number') assert.strictEqual(n % 100, 0);
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function server() {
  return createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p);
    if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
}

async function previewText(page) {
  return page.evaluate(() => document.getElementById('agentBriefPreview').textContent);
}

async function roundTrip(page, level) {
  const preview = await previewText(page);
  assert.strictEqual(JSON.parse(preview).level, level);
  const again = await page.evaluate(() => JSON.stringify(
    window.ExpenseBrief.buildAgentBrief(window.ExpenseLoggerTest.agentBriefInput()), null, 2
  ));
  assert.strictEqual(again, preview, 'preview is not the brief.js payload');
  assert.strictEqual(await page.evaluate(() => window.ExpenseLoggerTest.agentBriefText()), preview);
  const before = await page.evaluate(() => window.__elBriefCopy.length);
  await page.click('#agentBriefCopyBtn');
  await page.waitForFunction((n) => window.__elBriefCopy.length >= n, before + 1);
  await page.waitForTimeout(300);
  await page.click('#agentBriefCopyBtn');
  await page.waitForFunction((n) => window.__elBriefCopy.length >= n, before + 2);
  assert.deepStrictEqual(await page.evaluate((n) => window.__elBriefCopy.slice(n), before), [preview, preview]);
  assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), preview);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#agentBriefSaveBtn')]);
  assert.match(download.suggestedFilename(), new RegExp('^agent-brief-' + level.toLowerCase() + '-\\d{4}-\\d{2}-\\d{2}\\.json$'));
  assert.strictEqual(readFileSync(await download.path(), 'utf8'), preview);
  assert.strictEqual(await previewText(page), preview);
  assertClean(preview);
  return preview;
}

async function run() {
  const httpServer = server();
  await new Promise((resolve) => httpServer.listen(PORT, resolve));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:' + PORT });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript(() => {
    window.__elBriefCopy = [];
    const clip = navigator.clipboard;
    if (!clip || !clip.writeText) return;
    const orig = clip.writeText.bind(clip);
    clip.writeText = (text) => { window.__elBriefCopy.push(String(text)); return orig(text); };
  });

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(async ({ rows, accounts, recurring, syncKey, token }) => {
      localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(rows));
      localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify(accounts));
      localStorage.setItem('expenseLogger.recurring.v1', JSON.stringify(recurring));
      localStorage.setItem(syncKey, JSON.stringify({ workerUrl: 'https://sync.example.test', deviceToken: token, pairedAt: '2026-01-01T00:00:00.000Z' }));
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('expenseLogger', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('receipts')) req.result.createObjectStore('receipts', { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const tx = req.result.transaction('receipts', 'readwrite');
          tx.objectStore('receipts').put({ id: 'receipt:txn-row-SECRETID', dataURL: 'data:image/png;base64,idb-receipt-SECRET' });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, { rows: fixture.entries, accounts: fixture.accounts, recurring: fixture.recurring, syncKey: SYNC_KEY, token: TOKEN });
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('button[data-tab="settings"]');
    await page.waitForFunction(() => (document.getElementById('agentBriefPreview').textContent || '').indexOf('"level": "L0"') !== -1);

    const l0 = await roundTrip(page, 'L0');
    assert.strictEqual(await page.getAttribute('#agentBriefL0', 'aria-pressed'), 'true');
    await page.click('#agentBriefL1');
    await page.waitForFunction(() => document.getElementById('agentBriefPreview').textContent.indexOf('"level": "L1"') !== -1);
    const l1 = await roundTrip(page, 'L1');
    assert.notStrictEqual(l1, l0);
    assert.strictEqual(await page.getAttribute('#agentBriefL1', 'aria-pressed'), 'true');
    await page.click('#agentBriefL0');
    await page.waitForFunction(() => document.getElementById('agentBriefPreview').textContent.indexOf('"level": "L0"') !== -1);
    assert.notStrictEqual(await roundTrip(page, 'L0'), l0);

    const still = await page.evaluate((key) => localStorage.getItem(key), SYNC_KEY);
    assert.ok(still && still.includes(TOKEN));
    assert.strictEqual(await page.evaluate(() => window.ExpenseLoggerTest.APP_VERSION), '2.6.3');
    assert.strictEqual(await page.locator('#agentBriefGroup .hint, #agentBriefGroup p').count(), 0);
    await page.evaluate(() => {
      const header = document.querySelector('#tab-settings .screen-header-wrap');
      const group = document.getElementById('agentBriefGroup');
      window.scrollTo(0, Math.max(0, group.getBoundingClientRect().top + window.scrollY - header.getBoundingClientRect().height));
    });
    const layout = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const pre = document.getElementById('agentBriefPreview');
      return {
        l0: r('agentBriefL0'), l1: r('agentBriefL1'), copy: r('agentBriefCopyBtn'), save: r('agentBriefSaveBtn'),
        preview: r('agentBriefPreview'), labelTop: document.querySelector('#agentBriefGroup .group-label').getBoundingClientRect().top,
        open: document.querySelector('.agent-brief-details').open,
        groupHeight: document.getElementById('agentBriefGroup').getBoundingClientRect().height,
        scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, innerHeight: window.innerHeight
      };
    });
    assert.ok(layout.l0.height >= 44 && layout.l1.height >= 44 && layout.copy.height >= 44 && layout.save.height >= 44);
    assert.ok(Math.abs(layout.l0.top - layout.l1.top) < 2 && layout.l1.left >= layout.l0.right - 2);
    assert.ok(Math.abs(layout.copy.top - layout.save.top) < 2 && layout.save.left >= layout.copy.right - 2);
    assert.ok(layout.copy.top >= layout.l0.bottom - 2);
    assert.strictEqual(layout.open, false, 'preview collapsed by default');
    assert.ok(layout.groupHeight < 260, 'collapsed group is compact: ' + layout.groupHeight);
    await page.click('#agentBriefGroup .agent-brief-details > summary');
    const opened = await page.evaluate(() => {
      const pre = document.getElementById('agentBriefPreview');
      const r = pre.getBoundingClientRect();
      return { open: document.querySelector('.agent-brief-details').open, h: r.height, scrolls: pre.scrollHeight > pre.clientHeight + 1 };
    });
    assert.ok(opened.open && opened.h <= 201 && opened.scrolls, 'open preview is a short scroll box');
    await page.click('#agentBriefGroup .agent-brief-details > summary');
    assert.ok(layout.labelTop > 40 && layout.save.right <= layout.innerWidth + 1);
    assert.ok(layout.scrollWidth <= layout.innerWidth + 1 && layout.copy.bottom < layout.innerHeight - 49);
    assert.deepStrictEqual(errors, []);
    console.log('agent-brief-screen-test: PASS');
  } finally {
    await browser.close();
    httpServer.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
