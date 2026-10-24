/**
 * Corrupt localStorage guard — raw data must not be replaced with empty saves.
 * Run: node scripts/storage-guard-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8882;
const ROOT = '/workspace';
const ENTRIES_KEY = 'expenseLogger.entries.v1';
const CATS_KEY = 'expenseLogger.categories.v1';
const ACCOUNTS_KEY = 'expenseLogger.accounts.v1';

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

const VALID_CATS = JSON.stringify([
  { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
  { id: 'other', name: 'Other', icon: 'dots', color: '#878e96' }
]);

async function openFresh(page) {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest && window.ExpenseLoggerTest.APP_VERSION);
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // --- corrupt entries: add attempt must not write [] ---
  const corruptEntries = '{not:json';
  await openFresh(page);
  await page.evaluate(({ corrupt, cats }) => {
    localStorage.setItem('expenseLogger.entries.v1', corrupt);
    localStorage.setItem('expenseLogger.categories.v1', cats);
  }, { corrupt: corruptEntries, cats: VALID_CATS });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ExpenseLoggerTest);

  let entriesCase = await page.evaluate((corrupt) => {
    const T = window.ExpenseLoggerTest;
    const rawAfterLoad = T.getLocalStorageRaw('expenseLogger.entries.v1');
    const guard = T.storageGuardStatus();
    const st = T.getState();
    st.entries.push({
      id: 'new1',
      amount: 9.99,
      categoryId: 'groceries',
      note: 'try save',
      ts: Date.now()
    });
    T.setState({ entries: st.entries });
    const saved = T.trySaveEntries();
    const rawAfterSave = T.getLocalStorageRaw('expenseLogger.entries.v1');
    const bootErr = document.getElementById('homeBootError') && !document.getElementById('homeBootError').hidden;
    return {
      rawAfterLoad,
      rawAfterSave,
      saved,
      guard,
      bootErr
    };
  }, corruptEntries);

  assert.strictEqual(entriesCase.rawAfterLoad, corruptEntries, 'corrupt entries: raw unchanged after load');
  assert.strictEqual(entriesCase.rawAfterSave, corruptEntries, 'corrupt entries: raw unchanged after save attempt');
  assert.strictEqual(entriesCase.saved, false, 'corrupt entries: save refused');
  assert.strictEqual(entriesCase.guard.entries, true, 'corrupt entries: guard flag');
  assert.ok(entriesCase.bootErr, 'corrupt entries: home boot error visible');

  // --- corrupt categories: migrate must not save [] over raw ---
  const corruptCats = '{bad:categories';
  await openFresh(page);
  await page.evaluate(({ corruptCats, cats }) => {
    localStorage.setItem('expenseLogger.categories.v1', corruptCats);
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.accounts.v1', cats);
  }, { corruptCats, cats: JSON.stringify([
    { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997' }
  ]) });
  await page.reload({ waitUntil: 'networkidle' });

  const catsCase = await page.evaluate((corruptCats) => {
    const T = window.ExpenseLoggerTest;
    return {
      raw: T.getLocalStorageRaw('expenseLogger.categories.v1'),
      guard: T.storageGuardStatus(),
      saveOk: T.trySaveCategories()
    };
  }, corruptCats);

  assert.strictEqual(catsCase.raw, corruptCats, 'corrupt categories: raw unchanged after boot/migrate');
  assert.strictEqual(catsCase.guard.categories, true, 'corrupt categories: guard flag');
  assert.strictEqual(catsCase.saveOk, false, 'corrupt categories: save refused');

  // --- corrupt accounts: defaults must not overwrite truncated string ---
  const corruptAccounts = '[{"id":"acct-checking","name":"Checking","type":"bank"';
  await openFresh(page);
  await page.evaluate(({ corruptAccounts, cats }) => {
    localStorage.setItem('expenseLogger.accounts.v1', corruptAccounts);
    localStorage.setItem('expenseLogger.categories.v1', cats);
    localStorage.setItem('expenseLogger.entries.v1', '[]');
  }, { corruptAccounts, cats: VALID_CATS });
  await page.reload({ waitUntil: 'networkidle' });

  const acctCase = await page.evaluate((corruptAccounts) => {
    const T = window.ExpenseLoggerTest;
    const state = T.getState();
    return {
      raw: T.getLocalStorageRaw('expenseLogger.accounts.v1'),
      guard: T.storageGuardStatus(),
      accountCount: state.accounts.length,
      saveOk: T.trySaveAccounts()
    };
  }, corruptAccounts);

  assert.strictEqual(acctCase.raw, corruptAccounts, 'corrupt accounts: raw unchanged');
  assert.strictEqual(acctCase.guard.accounts, true, 'corrupt accounts: guard flag');
  assert.strictEqual(acctCase.saveOk, false, 'corrupt accounts: save refused');
  assert.strictEqual(acctCase.accountCount, 0, 'corrupt accounts: in-memory list empty');

  // --- valid entry round-trip ---
  const validEntry = {
    id: 'e-round',
    amount: 12.34,
    categoryId: 'groceries',
    ts: new Date('2026-10-15T12:00:00').getTime()
  };
  await openFresh(page);
  await page.evaluate(({ entry, cats }) => {
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([entry]));
    localStorage.setItem('expenseLogger.categories.v1', cats);
  }, { entry: validEntry, cats: VALID_CATS });
  await page.reload({ waitUntil: 'networkidle' });

  const roundTrip = await page.evaluate((id) => {
    const T = window.ExpenseLoggerTest;
    const guard = T.storageGuardStatus();
    const loaded = T.getState().entries.find((e) => e.id === id);
    loaded.amount = 12.34;
    loaded.note = 'updated';
    const saved = T.trySaveEntries();
    const raw = T.getLocalStorageRaw('expenseLogger.entries.v1');
    const parsed = JSON.parse(raw);
    const again = parsed.find((e) => e.id === id);
    return { guard, saved, amount: again && again.amount, note: again && again.note };
  }, validEntry.id);

  assert.strictEqual(roundTrip.guard.entries, false, 'valid entry: no entries guard');
  assert.strictEqual(roundTrip.saved, true, 'valid entry: save ok');
  assert.strictEqual(roundTrip.amount, 12.34, 'valid entry: amount persisted');
  assert.strictEqual(roundTrip.note, 'updated', 'valid entry: note persisted');

  assert.strictEqual(errors.length, 0, 'no page errors: ' + errors.join('; '));
  console.log('storage-guard-test: PASS');

  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
