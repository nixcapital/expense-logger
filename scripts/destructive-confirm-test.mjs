/**
 * In-app destructive confirms (#95): no window.confirm.
 * Run: node scripts/destructive-confirm-test.mjs   (EL_ROOT if not /workspace)
 */
import assert from 'assert';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const PORT = 8965;
const ROOT = process.env.EL_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_KEY = 'expenseLogger.sync.v1';
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

async function waitScrim(page) {
  await page.waitForSelector('#destructiveConfirmScrim.show');
}

async function tapCancel(page) {
  await waitScrim(page);
  await page.click('#destructiveConfirmCancelBtn');
  await page.waitForFunction(() => !document.getElementById('destructiveConfirmScrim').classList.contains('show'));
}

async function tapConfirm(page) {
  await waitScrim(page);
  await page.waitForFunction(() => {
    const btn = document.getElementById('destructiveConfirmConfirmBtn');
    return btn && !btn.disabled;
  });
  await page.click('#destructiveConfirmConfirmBtn');
}

async function expenseLoggerKeys(page) {
  return page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('expenseLogger.')) keys.push(k);
    }
    return keys.sort();
  });
}

async function run() {
  assert.ok(!readFileSync(join(ROOT, 'app.js'), 'utf8').includes('window.confirm'), 'app.js must not call window.confirm');

  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });
  const errors = [];
  const nativeDialogs = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (dialog) => {
    nativeDialogs.push({ type: dialog.type(), message: dialog.message() });
    dialog.dismiss().catch(() => {});
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest && window.ExpenseLoggerTest.APP_VERSION === '2.6.6');

  const seedCats = [
    { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
    { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
    { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }
  ];
  const seedEntries = [{ id: 'e8', amount: 8, categoryId: 'groceries', note: 'fake latte', ts: Date.UTC(2026, 10, 1) }];
  await page.evaluate(({ cats, ents }) => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(cats));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(ents));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify([
      { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997', currentBalance: 1000, balanceAsOf: '2026-11-01' }
    ]));
    localStorage.setItem('expenseLogger.sync.v1', JSON.stringify({
      workerUrl: 'https://sync.example.test',
      deviceToken: 'ab'.repeat(32),
      pairedAt: new Date().toISOString()
    }));
  }, { cats: seedCats, ents: seedEntries });
  await page.reload({ waitUntil: 'networkidle' });

  console.log('destructive-confirm-test: delete entry cancel');
  await page.evaluate(() => window.ExpenseLoggerTest.openEntryEditor('e8'));
  await page.waitForSelector('#receiptModal.show');
  await page.click('#editDeleteBtn');
  await tapCancel(page);
  const stillThere = await page.evaluate(() => {
    const raw = localStorage.getItem('expenseLogger.entries.v1');
    const list = JSON.parse(raw || '[]');
    return list.some((e) => e.id === 'e8' && e.amount === 8);
  });
  assert.strictEqual(stillThere, true, '$8 entry survives cancel');

  console.log('destructive-confirm-test: delete receipt cancel');
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('expenseLogger', 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('receipts')) {
          r.result.createObjectStore('receipts', { keyPath: 'id' });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('receipts', 'readwrite');
      tx.objectStore('receipts').put({
        id: 'receipt:rcp1',
        dataURL: 'data:image/png;base64,QUFBQQ==',
        ts: Date.now()
      });
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    const list = [{ id: 'rcp1', amount: 3.5, categoryId: 'dining', note: 'fake receipt meal', ts: Date.UTC(2026, 10, 3), hasReceipt: true }];
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(list));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.ExpenseLoggerTest.openEntryEditor('rcp1'));
  await page.waitForSelector('#receiptModal.show');
  await page.waitForSelector('#receiptModalDelete:not([hidden])');
  await page.click('#receiptModalDelete');
  await tapCancel(page);
  const receiptKept = await page.evaluate(async () => {
    const entry = JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]')[0];
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('expenseLogger', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rec = await new Promise((res) => {
      const tx = db.transaction('receipts', 'readonly');
      const g = tx.objectStore('receipts').get('receipt:rcp1');
      g.onsuccess = () => res(g.result);
      g.onerror = () => res(null);
    });
    return entry && entry.hasReceipt === true && rec && rec.dataURL;
  });
  assert.ok(receiptKept, 'receipt photo survives cancel');

  console.log('destructive-confirm-test: delete entry confirm');
  await page.click('#editDeleteBtn');
  await tapConfirm(page);
  await page.waitForFunction(() => !document.getElementById('receiptModal').classList.contains('show'));
  const gone = await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]');
    return list.every((e) => e.id !== 'e8');
  });
  assert.strictEqual(gone, true, 'entry removed after confirm');

  console.log('destructive-confirm-test: category delete moves all expenses');
  const many = [];
  for (let i = 0; i < 12; i++) {
    many.push({ id: 'g' + i, amount: 1 + i, categoryId: 'groceries', note: 'fake item', ts: Date.UTC(2026, 10, 2, i) });
  }
  await page.evaluate((rows) => {
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(rows));
  }, many);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab-btn[data-tab="settings"]');
  const delBtn = page.locator('#categoryList [data-del="groceries"]');
  await delBtn.click();
  await waitScrim(page);
  const hint = await page.locator('#destructiveConfirmHint').innerText();
  assert.match(hint, /12 expenses will move to Other/, hint);
  await page.click('#destructiveConfirmConfirmBtn');
  await page.waitForFunction(() => !document.getElementById('destructiveConfirmScrim').classList.contains('show'));
  const moved = await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]');
    const cats = JSON.parse(localStorage.getItem('expenseLogger.categories.v1') || '[]');
    return {
      count: list.length,
      allOther: list.every((e) => e.categoryId === 'other'),
      groceriesGone: !cats.some((c) => c.id === 'groceries')
    };
  });
  assert.strictEqual(moved.count, 12);
  assert.strictEqual(moved.allOther, true);
  assert.strictEqual(moved.groceriesGone, true);

  console.log('destructive-confirm-test: category delete empty hides move hint');
  const delDining = page.locator('#categoryList [data-del="dining"]');
  await delDining.click();
  await waitScrim(page);
  const emptyHint = await page.evaluate(() => {
    const h = document.getElementById('destructiveConfirmHint');
    return { hidden: h.hidden, text: h.textContent.trim() };
  });
  assert.ok(emptyHint.hidden || emptyHint.text === '', 'empty category shows no move hint');
  await tapCancel(page);

  console.log('destructive-confirm-test: delete Other names first remaining category');
  await page.evaluate(() => {
    const rows = [
      { id: 'o1', amount: 2, categoryId: 'other', note: 'fake misc', ts: Date.UTC(2026, 10, 4) },
      { id: 'o2', amount: 4, categoryId: 'other', note: 'fake misc 2', ts: Date.UTC(2026, 10, 5) }
    ];
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(rows));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tab-btn[data-tab="settings"]');
  await page.locator('#categoryList [data-del="other"]').click();
  await waitScrim(page);
  const otherHint = await page.locator('#destructiveConfirmHint').innerText();
  assert.match(otherHint, /2 expenses will move to Dining/, otherHint);
  await tapCancel(page);

  console.log('destructive-confirm-test: clear all two-step cancel');
  const keysBefore = await expenseLoggerKeys(page);
  await page.click('#clearAllBtn');
  await waitScrim(page);
  const step1Copy = await page.evaluate(() => ({
    title: document.getElementById('destructiveConfirmTitle').textContent,
    hint: document.getElementById('destructiveConfirmHint').textContent
  }));
  assert.strictEqual(step1Copy.title, 'Clear all data?');
  assert.match(step1Copy.hint, /expenses, categories, budgets, recurring/i);
  assert.match(step1Copy.hint, /bank sync/i);
  assert.match(step1Copy.hint, /forecast settings are kept/i);
  await tapCancel(page);
  let keysAfter = await expenseLoggerKeys(page);
  assert.deepStrictEqual(keysAfter, keysBefore, 'cancel step 1 keeps keys');

  console.log('destructive-confirm-test: clear all double-tap step 2 guard');
  await page.click('#clearAllBtn');
  await waitScrim(page);
  await page.waitForFunction(() => {
    const btn = document.getElementById('destructiveConfirmConfirmBtn');
    return btn && !btn.disabled;
  });
  await page.evaluate(() => {
    const btn = document.getElementById('destructiveConfirmConfirmBtn');
    btn.click();
    btn.click();
  });
  await page.waitForTimeout(50);
  const afterDouble = await page.evaluate(() => ({
    title: document.getElementById('destructiveConfirmTitle').textContent,
    showing: document.getElementById('destructiveConfirmScrim').classList.contains('show')
  }));
  assert.strictEqual(afterDouble.showing, true, 'step 2 scrim still open');
  assert.strictEqual(afterDouble.title, "This can't be undone", 'step 2 title after double-tap');
  keysAfter = await expenseLoggerKeys(page);
  assert.deepStrictEqual(keysAfter, keysBefore, 'double-tap does not wipe data');
  await tapCancel(page);

  await page.click('#clearAllBtn');
  await tapConfirm(page);
  await waitScrim(page);
  const step2Title = await page.locator('#destructiveConfirmTitle').innerText();
  assert.strictEqual(step2Title, "This can't be undone");
  await tapCancel(page);
  keysAfter = await expenseLoggerKeys(page);
  assert.deepStrictEqual(keysAfter, keysBefore, 'cancel step 2 keeps keys');

  console.log('destructive-confirm-test: clear all confirm keeps accounts and sync');
  await page.click('#clearAllBtn');
  await tapConfirm(page);
  await tapConfirm(page);
  await page.waitForFunction(() => !document.getElementById('destructiveConfirmScrim').classList.contains('show'));
  const afterClear = await page.evaluate((syncKey) => ({
    entries: localStorage.getItem('expenseLogger.entries.v1'),
    accounts: localStorage.getItem('expenseLogger.accounts.v1'),
    sync: localStorage.getItem(syncKey)
  }), SYNC_KEY);
  const entryLen = await page.evaluate(() => window.ExpenseLoggerTest.getState().entries.length);
  assert.strictEqual(entryLen, 0);
  assert.ok(afterClear.accounts && afterClear.accounts.includes('Checking'), 'accounts preserved');
  assert.ok(afterClear.sync, 'bank sync pairing preserved');

  assert.deepStrictEqual(errors, [], 'no page errors');
  assert.deepStrictEqual(nativeDialogs, [], 'no native confirm/alert/prompt dialogs');
  await browser.close();
  server.close();
  console.log('destructive-confirm-test: all checks passed');
}

run().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});