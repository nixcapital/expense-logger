/**
 * Backup / restore round-trip tests with fake localStorage data.
 * Run: node scripts/backup-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, extname } from 'path';
import { tmpdir } from 'os';
import assert from 'assert';

const PORT = 8879;
const ROOT = '/workspace';

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

function fakeSeed() {
  const now = Date.now();
  return {
    'expenseLogger.entries.v1': JSON.stringify([
      { id: 'e1', amount: 12.5, categoryId: 'groceries', note: 'fake', ts: now - 86400000 * 40 },
      { id: 'e2', amount: 8, categoryId: 'dining', note: '', ts: now - 86400000 * 5 }
    ]),
    'expenseLogger.categories.v1': JSON.stringify([
      { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
      { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' }
    ]),
    'expenseLogger.budgets.v1': JSON.stringify({ groceries: 400 }),
    'expenseLogger.importRules.v1': JSON.stringify([{ id: 'r1', pattern: 'COFFEE', categoryId: 'dining' }]),
    'expenseLogger.importSettings.v1': JSON.stringify({ countCardPayments: true }),
    'expenseLogger.recurring.v1': JSON.stringify([]),
    'expenseLogger.ui.v1': JSON.stringify({ tab: 'summary', dismissedWrapped: {} })
  };
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });

  const seed = fakeSeed();
  await page.evaluate((s) => {
    Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
  }, seed);
  await page.reload({ waitUntil: 'networkidle' });

  const roundTrip = await page.evaluate(async () => {
    const B = window.ExpenseLoggerBackup;
    const before = B.collectExpenseLoggerKeys();
    const doc = B.buildBackupDocument();
    const check = B.validateBackupDocument(doc);
    if (!check.ok) return { ok: false, step: 'validate-built', error: check.error };
    const keyCount = Object.keys(before).length;
    if (keyCount < 6) return { ok: false, step: 'seed', keyCount };
    const restorePayload = {
      backupFormat: 1,
      appVersion: '1.3.1',
      createdAt: new Date().toISOString(),
      storage: {
        'expenseLogger.entries.v1': JSON.stringify([{ id: 'x9', amount: 99, categoryId: 'groceries', ts: Date.now() }]),
        'expenseLogger.categories.v1': JSON.stringify([{ id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }]),
        'expenseLogger.importRules.v1': JSON.stringify([]),
        'expenseLogger.budgets.v1': JSON.stringify({}),
        'expenseLogger.recurring.v1': JSON.stringify([]),
        'expenseLogger.importSettings.v1': JSON.stringify({ countCardPayments: false }),
        'expenseLogger.ui.v1': JSON.stringify({ tab: 'summary' })
      }
    };
    await B.commitBackupRestore(restorePayload);
    const afterReplace = B.collectExpenseLoggerKeys();
    const entryCount = JSON.parse(afterReplace['expenseLogger.entries.v1']).length;
    if (entryCount !== 1) return { ok: false, step: 'replace', entryCount };

    B.applyStorageSnapshot(before);
    const afterUndoKeys = B.collectExpenseLoggerKeys();
    const keysMatch = Object.keys(before).every((k) => afterUndoKeys[k] === before[k]);
    return { ok: keysMatch, step: 'undo-keys', keyCount: keyCount };
  });

  assert.strictEqual(roundTrip.ok, true, 'round trip failed at ' + roundTrip.step);

  const corruptOk = await page.evaluate(() => {
    const B = window.ExpenseLoggerBackup;
    const snap = B.collectExpenseLoggerKeys();
    const bad = { backupFormat: 99, storage: {} };
    const v = B.validateBackupDocument(bad);
    if (v.ok) return false;
    B.applyStorageSnapshot(snap);
    const after = B.collectExpenseLoggerKeys();
    return Object.keys(snap).every((k) => after[k] === snap[k]);
  });
  assert.strictEqual(corruptOk, true, 'corrupt backup must not mutate data');

  await page.evaluate(() => {
    const seed = {
      'expenseLogger.entries.v1': JSON.stringify([
        { id: 'keep1', amount: 1, categoryId: 'groceries', ts: Date.now() }
      ]),
      'expenseLogger.categories.v1': JSON.stringify([
        { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
      ])
    };
    Object.keys(seed).forEach((k) => localStorage.setItem(k, seed[k]));
  });
  await page.reload({ waitUntil: 'networkidle' });

  const tmpDir = mkdtempSync(join(tmpdir(), 'el-backup-'));
  const backupPath = join(tmpDir, 'restore-me.json');
  const restoreDoc = {
    backupFormat: 1,
    appVersion: '1.3.1',
    createdAt: new Date().toISOString(),
    storage: {
      'expenseLogger.entries.v1': JSON.stringify([
        { id: 'new1', amount: 42, categoryId: 'groceries', ts: Date.now() },
        { id: 'new2', amount: 3, categoryId: 'groceries', ts: Date.now() - 1000 }
      ]),
      'expenseLogger.categories.v1': JSON.stringify([
        { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
      ]),
      'expenseLogger.budgets.v1': JSON.stringify({}),
      'expenseLogger.recurring.v1': JSON.stringify([]),
      'expenseLogger.importRules.v1': JSON.stringify([]),
      'expenseLogger.importSettings.v1': JSON.stringify({ countCardPayments: false }),
      'expenseLogger.ui.v1': JSON.stringify({ tab: 'summary' })
    }
  };
  writeFileSync(backupPath, JSON.stringify(restoreDoc));

  await page.click('button[data-tab="settings"]');
  await page.locator('#backupFileInput').setInputFiles(backupPath);
  await page.waitForSelector('#backupRestoreModal.show');
  await page.click('#backupRestoreConfirmBtn');
  await page.waitForTimeout(400);

  let countAfter = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length
  );
  assert.strictEqual(countAfter, 2, 'restore via UI should apply backup entries');

  await page.click('#undoBtn');
  await page.waitForTimeout(400);
  const countUndo = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length
  );
  assert.strictEqual(countUndo, 1, 'undo after restore should revert to prior data');
  assert.strictEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1'))[0].id),
    'keep1'
  );

  const defaultCatsBackup = await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'expenseLogger.entries.v1',
      JSON.stringify([{ id: 'only1', amount: 2, categoryId: 'groceries', ts: Date.now() }])
    );
    return true;
  });
  assert.strictEqual(defaultCatsBackup, true);
  await page.reload({ waitUntil: 'networkidle' });

  const resolvedCats = await page.evaluate(() => {
    const B = window.ExpenseLoggerBackup;
    const doc = B.buildBackupDocument();
    const raw = doc.storage['expenseLogger.categories.v1'];
    if (!raw) return 0;
    return JSON.parse(raw).length;
  });
  assert.ok(resolvedCats >= 6, 'backup must include resolved default categories, got ' + resolvedCats);

  const restoreDefaults = await page.evaluate(async () => {
    const B = window.ExpenseLoggerBackup;
    const doc = B.buildBackupDocument();
    localStorage.removeItem('expenseLogger.categories.v1');
    await B.commitBackupRestore(doc);
    const raw = localStorage.getItem('expenseLogger.categories.v1');
    return raw ? JSON.parse(raw).length : 0;
  });
  assert.ok(restoreDefaults >= 6, 'restore must write categories from backup');

  const categoryLabel = await page.evaluate(() => {
    const B = window.ExpenseLoggerBackup;
    const summary = B.summarizeBackupStorage({
      'expenseLogger.entries.v1': JSON.stringify([{ id: 'a', amount: 1, categoryId: 'groceries', ts: 1 }]),
      'expenseLogger.ui.v1': '{}'
    });
    return B.formatCategorySummaryLabel(summary);
  });
  assert.strictEqual(categoryLabel, 'Default categories');

  const metaIso = '2025-06-01T12:00:00.000Z';
  const metaKept = await page.evaluate(async (iso) => {
    localStorage.setItem('expenseLogger.meta.v1', JSON.stringify({ lastBackupAt: iso }));
    localStorage.setItem(
      'expenseLogger.categories.v1',
      JSON.stringify([{ id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }])
    );
    const B = window.ExpenseLoggerBackup;
    await B.commitBackupRestore({
      backupFormat: 1,
      appVersion: '1.3.1',
      createdAt: new Date().toISOString(),
      storage: {
        'expenseLogger.entries.v1': JSON.stringify([{ id: 'n', amount: 9, categoryId: 'groceries', ts: Date.now() }]),
        'expenseLogger.meta.v1': JSON.stringify({ lastBackupAt: '2020-01-01T00:00:00.000Z' })
      }
    });
    const meta = JSON.parse(localStorage.getItem('expenseLogger.meta.v1') || '{}');
    return meta.lastBackupAt;
  }, metaIso);
  assert.strictEqual(metaKept, metaIso, 'device last-backup time must survive restore');

  // Restore must keep receipt photos already on the device (#37) and keep the
  // hasReceipt flag on entries whose photo is missing, showing "Photo missing".
  const receiptCheck = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('expenseLogger', 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('receipts')) r.result.createObjectStore('receipts', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('receipts', 'readwrite');
      tx.objectStore('receipts').put({ id: 'receipt:has-photo', dataURL: 'data:image/png;base64,AAAA', ts: 1 });
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    const now = Date.now();
    const prevIds = JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]').map((e) => e.id);
    await window.ExpenseLoggerBackup.commitBackupRestore({
      backupFormat: 2,
      appVersion: '1.9.9',
      createdAt: new Date().toISOString(),
      storage: {
        'expenseLogger.entries.v1': JSON.stringify([
          { id: 'has-photo', amount: 5, categoryId: 'groceries', ts: now, hasReceipt: true },
          { id: 'no-photo', amount: 6, categoryId: 'groceries', ts: now - 1000, hasReceipt: true }
        ]),
        'expenseLogger.categories.v1': JSON.stringify([
          { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
        ])
      }
    });
    const kept = await new Promise((res) => {
      const r = db.transaction('receipts', 'readonly').objectStore('receipts').get('receipt:has-photo');
      r.onsuccess = () => res(!!(r.result && r.result.dataURL));
    });
    const flags = JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).map((e) => e.hasReceipt === true);
    return { kept, flags, prevIds };
  });
  assert.strictEqual(receiptCheck.kept, true, 'restore must not delete receipt photos');
  assert.deepStrictEqual(receiptCheck.flags, [true, true], 'restore must keep hasReceipt flags');
  // "Photo missing" shows on the Home recent list for the entry without a photo.
  await page.waitForFunction(
    () => document.querySelectorAll('#recentEntries .receipt-missing').length === 1,
    null,
    { timeout: 5000 }
  );
  assert.strictEqual(await page.locator('#recentEntries .receipt-missing').innerText(), 'Photo missing');

  // Undo brings back the previous entries and the photo set from before the restore.
  await page.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('expenseLogger', 1);
    r.onsuccess = () => {
      const tx = r.result.transaction('receipts', 'readwrite');
      tx.objectStore('receipts').delete('receipt:has-photo');
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    };
  }));
  await page.click('#undoBtn');
  await page.waitForTimeout(500);
  const afterUndo = await page.evaluate(async () => {
    const photo = await new Promise((res) => {
      const r = indexedDB.open('expenseLogger', 1);
      r.onsuccess = () => {
        const g = r.result.transaction('receipts', 'readonly').objectStore('receipts').get('receipt:has-photo');
        g.onsuccess = () => res(!!(g.result && g.result.dataURL));
      };
    });
    const ids = JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]').map((e) => e.id);
    return { photo, ids };
  });
  assert.strictEqual(afterUndo.photo, true, 'undo must put the pre-restore photos back');
  assert.deepStrictEqual(afterUndo.ids, receiptCheck.prevIds, 'undo must put the previous entries back');

  // A write failing part-way through a restore (storage full) must leave the old data
  // exactly as it was, show an error toast, and never show the success toast (#38).
  await page.evaluate(() => document.getElementById('undoToast').classList.remove('show'));
  const quotaCheck = await page.evaluate(async () => {
    const B = window.ExpenseLoggerBackup;
    const before = B.collectExpenseLoggerKeys();
    const realSet = Storage.prototype.setItem;
    let calls = 0;
    // Allow the restore's second write, then fail like a full quota; stop failing once rolled back.
    Storage.prototype.setItem = function (k, v) {
      calls++;
      if (calls === 3) throw new DOMException('quota', 'QuotaExceededError');
      return realSet.call(this, k, v);
    };
    let result;
    let toastText = '';
    try {
      result = await B.commitBackupRestore({
        backupFormat: 2,
        appVersion: '1.9.9',
        createdAt: new Date().toISOString(),
        storage: {
          'expenseLogger.entries.v1': JSON.stringify([{ id: 'q1', amount: 1, categoryId: 'groceries', ts: Date.now() }]),
          'expenseLogger.categories.v1': JSON.stringify([{ id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }]),
          'expenseLogger.budgets.v1': JSON.stringify({ groceries: 1 }),
          'expenseLogger.ui.v1': JSON.stringify({ tab: 'summary' })
        }
      });
      toastText = document.getElementById('toast').textContent;
    } finally {
      Storage.prototype.setItem = realSet;
    }
    const after = B.collectExpenseLoggerKeys();
    const same = Object.keys(before).length === Object.keys(after).length
      && Object.keys(before).every((k) => after[k] === before[k]);
    return { result, toastText, same, calls };
  });
  assert.strictEqual(quotaCheck.result, false, 'failed restore must report failure');
  assert.strictEqual(quotaCheck.same, true, 'failed restore must leave all data unchanged');
  assert.ok(/Restore failed/.test(quotaCheck.toastText), 'error toast expected, got: ' + quotaCheck.toastText);
  assert.ok(!(await page.locator('#undoToast.show').count()), 'no restore-undo toast after a failed restore');

  rmSync(tmpDir, { recursive: true, force: true });
  await browser.close();
  server.close();

  assert.strictEqual(errors.length, 0, 'page errors: ' + errors.join('; '));
  console.log('backup-test: PASS');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
