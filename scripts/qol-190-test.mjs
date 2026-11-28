/**
 * QoL 1.9.0 unit/integration tests (fake fixtures only).
 * Run: node scripts/qol-190-test.mjs
 */
import assert from 'assert';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const PORT = 8919;
const ROOT = process.env.EL_ROOT || '/workspace';
const FIX = join(ROOT, 'test/fixtures');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.csv': 'text/csv'
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

function parseTable(text) {
  return text.split(/\r?\n/).filter((l) => l.trim()).map((line) => line.split(','));
}

async function run() {
  const FC = require(join(ROOT, 'forecast.js'));
  assert.ok(FC.applyForecastOverrides, 'forecast bundle');

  console.log('qol-190-test: override expiry (node)');
  const afterOct18 = new Date(2026, 9, 18).getTime();
  const rentKey = 'maplecourt';
  const nov15 = new Date(2026, 10, 15).getTime();
  const novOnly = [{ ts: nov15, amount: 1650, itemKey: rentKey + '|a165000', kind: 'outflow', label: 'Rent' }];
  const staleOverride = {
    [rentKey]: { amount: 1650, nextTs: new Date(2026, 9, 17).getTime(), applyFromTs: new Date(2026, 9, 15).getTime(), kind: 'outflow' }
  };
  const afterStale = FC.applyForecastOverrides(novOnly, staleOverride, afterOct18);
  assert.ok(afterStale.some((e) => e.itemKey.indexOf(rentKey) === 0 && FC.startOfDay(e.ts) === FC.startOfDay(nov15)));
  const pruned = FC.pruneForecastOverrides(staleOverride, afterOct18);
  assert.strictEqual(Object.keys(pruned).length, 0);

  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
      { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
      { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' },
      { id: 'income', name: 'Income', icon: 'circle-dot', color: '#20C997' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([
      { id: 's1', amount: 6.75, categoryId: 'other', note: 'STARBUCKS STORE 1188', ts: Date.UTC(2026, 9, 15) },
      { id: 's2', amount: 5.95, categoryId: 'other', note: 'STARBUCKS STORE 1188', ts: Date.UTC(2026, 9, 13) },
      { id: 't1', amount: 500, categoryId: 'other', note: 'ONLINE TRANSFER TO SAV 4471', ts: Date.UTC(2026, 9, 12), isTransfer: false, accountId: 'acct-checking' }
    ]));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify([
      { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997', currentBalance: 3980, balanceAsOf: '2026-10-01' },
      { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#5B8CFF' }
    ]));
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });

  const version = await page.evaluate(() => window.ExpenseLoggerTest.APP_VERSION);
  assert.strictEqual(version, '2.6.6');

  console.log('qol-190-test: apply-to-similar import rows');
  const messy = readFileSync(join(FIX, 'fake-chase-oct-messy.csv'), 'utf8');
  const table = parseTable(messy);
  const similar = await page.evaluate((rows) => {
    const T = window.ExpenseLoggerTest;
    const header = rows[0];
    const data = rows.slice(1);
    const layout = T.detectImportLayout(header);
    const parsed = T.rowsFromTable(data, header, layout, 'test-batch', 'acct-chase');
    const row = parsed.find((r) => r.note && r.note.indexOf('STARBUCKS STORE 1188') !== -1 && r.status === 'import');
    if (!row || !T.countSimilarImportRowsForRows) return { n: 0, err: 'missing-row-or-fn' };
    const n = T.countSimilarImportRowsForRows(parsed, row, 'dining');
    return { n, layout };
  }, table);
  assert.ok(similar.n >= 2, 'expected multiple similar Starbucks rows, got ' + JSON.stringify(similar));

  console.log('qol-190-test: balance column parsing');
  const checkingCsv = readFileSync(join(FIX, 'fake-checking-oct.csv'), 'utf8');
  const checkingTable = parseTable(checkingCsv);
  const bal = await page.evaluate((rows) => {
    const T = window.ExpenseLoggerTest;
    const layout = T.detectImportLayout(rows[0]);
    return T.extractCheckingBalanceOffer(rows, layout);
  }, checkingTable);
  assert.ok(bal && bal.amount > 3000, JSON.stringify(bal));

  const balDesc = readFileSync(join(FIX, 'fake-checking-oct-desc.csv'), 'utf8');
  const balDescTable = parseTable(balDesc);
  const bal2 = await page.evaluate((rows) => {
    const T = window.ExpenseLoggerTest;
    const layout = T.detectImportLayout(rows[0]);
    return T.extractCheckingBalanceOffer(rows, layout);
  }, balDescTable);
  assert.ok(bal2 && bal2.ts, 'descending CSV should still pick newest row');
  assert.strictEqual(bal.amount, 4212.37, 'ascending CSV uses newest-dated row balance');
  assert.strictEqual(bal2.amount, 3120.55, 'descending CSV uses first Oct 14 row balance');

  console.log('qol-190-test: rule learning from Edit');
  await page.evaluate(() => {
    window.ExpenseLoggerTest.upsertImportRule('starbucks store #', { categoryId: 'dining', isTransfer: false, countAsSpending: true });
  });
  const rules = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.importRules.v1') || '[]'));
  assert.ok(rules.some((r) => r.pattern === 'starbucks store #' && r.categoryId === 'dining'));

  console.log('qol-190-test: type change affects spending totals');
  const spend = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    T.reloadFromStorage();
    const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    const e = es.find((x) => x.id === 't1');
    const before = T.entryCountsAsSpending(e);
    e.isTransfer = true;
    e.transferKind = 'other';
    const after = T.entryCountsAsSpending(e);
    return { before, after };
  });
  assert.strictEqual(spend.before, true);
  assert.strictEqual(spend.after, false);

  console.log('qol-190-test: import review More… lists every category (no prompt)');
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  const cats8 = [
    { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
    { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
    { id: 'gas', name: 'Gas', icon: 'fuel', color: '#51cf66' },
    { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
    { id: 'fun', name: 'Fun', icon: 'ticket', color: '#f783ac' },
    { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' },
    { id: 'income', name: 'Income', icon: 'circle-dot', color: '#34C77B' },
    { id: 'pets', name: 'Pets', icon: 'boxes', color: '#e8590c' }
  ];
  await page.evaluate((cats) => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(cats));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
  }, cats8);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('button[data-tab="settings"]');
  await page.locator('#importFileInput').setInputFiles(join(FIX, 'fake-chase-oct-messy.csv'));
  await page.waitForSelector('#importAccountModal.show');
  await page.waitForTimeout(300);
  await page.locator('[data-account-pick="acct-chase"]').click();
  await page.click('#importAccountContinueBtn');
  await page.waitForSelector('#importModal.show');
  await page.waitForTimeout(300);
  // Stay on the default "Needs review" filter: the row must stay open after a pick moves it out of Other.

  const reviewRows = () => page.evaluate(() => window.ExpenseLoggerTest.pendingImportRows().map((r, i) => ({
    i, note: r.note, status: r.status, categoryId: r.categoryId || 'other', userSetCategory: !!r.userSetCategory
  })));
  const before = await reviewRows();
  const sbux = before.find((r) => r.status === 'import' && r.note.indexOf('STARBUCKS STORE 1188') !== -1);
  const uber = before.find((r) => r.status === 'import' && r.note.indexOf('UBER') !== -1);
  assert.ok(sbux && uber, 'fixture rows present: ' + JSON.stringify(before.map((r) => r.note)));
  assert.strictEqual(sbux.categoryId, 'other');
  const sbuxSel = `.import-row[data-idx="${sbux.i}"]`;
  const chipIds = (sel) => page.$$eval(sel + ' .import-cat-chip[data-cat]', (els) => els.map((e) => e.dataset.cat));

  await page.click(sbuxSel + ' .import-row-hit');
  assert.deepStrictEqual(await chipIds(sbuxSel), ['groceries', 'dining', 'gas', 'bills', 'fun'], 'short list is first five non-income');
  await page.click(sbuxSel + ' [data-more]');
  const allButIncome = cats8.map((c) => c.id).filter((id) => id !== 'income');
  assert.deepStrictEqual(await chipIds(sbuxSel), allButIncome, 'More… shows every category (no Income on a purchase)');
  assert.strictEqual(await page.locator(sbuxSel + ' [data-less]').getAttribute('aria-expanded'), 'true');
  await page.click(sbuxSel + ' .import-cat-chip[data-cat="pets"]');
  let after = await reviewRows();
  assert.strictEqual(after[sbux.i].categoryId, 'pets', '8th category set on the row');
  assert.strictEqual(after[sbux.i].userSetCategory, true);
  assert.strictEqual(await page.locator(sbuxSel + ' .import-cat-chip.is-selected').getAttribute('data-cat'), 'pets');

  // Apply-to-similar still runs after a pick from the full list, and only touches the same merchant.
  const sameMerchant = before.filter((r) => r.status === 'import' && r.i !== sbux.i && /STARBUCKS STORE \d+/.test(r.note));
  assert.ok(sameMerchant.length >= 2, 'similar Starbucks rows: ' + sameMerchant.length);
  assert.strictEqual(await page.locator(sbuxSel).count(), 1, 'picked row stays open in Needs review');
  await page.click(sbuxSel + ' [data-apply-all]');
  after = await reviewRows();
  sameMerchant.forEach((r) => assert.strictEqual(after[r.i].categoryId, 'pets', r.note));
  before.filter((r) => r.status === 'import' && !/STARBUCKS/.test(r.note)).forEach((r) => {
    assert.strictEqual(after[r.i].categoryId, r.categoryId, 'other merchant untouched: ' + r.note);
  });
  await page.click(sbuxSel + ' .import-row-hit');
  assert.strictEqual(await page.locator(sbuxSel).count(), 0, 'collapsed row leaves Needs review');

  // "Less" closes the full list without changing the row.
  const uberSel = `.import-row[data-idx="${uber.i}"]`;
  await page.click(uberSel + ' .import-row-hit');
  await page.click(uberSel + ' [data-more]');
  assert.strictEqual(await page.locator(uberSel + ' .import-cat-chip[data-cat]').count(), allButIncome.length);
  await page.click(uberSel + ' [data-less]');
  assert.deepStrictEqual(await chipIds(uberSel), ['groceries', 'dining', 'gas', 'bills', 'fun']);
  assert.strictEqual(await page.locator(uberSel + ' [data-more]').getAttribute('aria-expanded'), 'false');
  after = await reviewRows();
  assert.strictEqual(after[uber.i].categoryId, uber.categoryId, 'Less leaves the category as it was');

  // Other (6th) is reachable without typing.
  await page.click(uberSel + ' [data-more]');
  await page.click(uberSel + ' .import-cat-chip[data-cat="groceries"]');
  await page.click(uberSel + ' .import-cat-chip[data-cat="other"]');
  after = await reviewRows();
  assert.strictEqual(after[uber.i].categoryId, 'other', 'can move a row back to Other');

  // A deposit row lists Income too (and shows it selected); switching back to Expense keeps it listed until moved.
  const third = before.find((r) => r.status === 'import' && r.categoryId === 'other' && !/STARBUCKS|UBER/.test(r.note));
  assert.ok(third, 'a third Other row');
  const thirdSel = `.import-row[data-idx="${third.i}"]`;
  await page.click(thirdSel + ' .import-row-hit');
  await page.click(thirdSel + ' .seg-btn[data-mode="income"]');
  await page.click(thirdSel + ' [data-more]');
  assert.deepStrictEqual(await chipIds(thirdSel), cats8.map((c) => c.id), 'deposit row lists Income');
  assert.strictEqual(await page.locator(thirdSel + ' .import-cat-chip.is-selected').getAttribute('data-cat'), 'income');
  await page.click(thirdSel + ' .seg-btn[data-mode="expense"]');
  assert.ok((await chipIds(thirdSel)).includes('income'), 'row still in Income keeps the chip so it can be seen');
  await page.click(thirdSel + ' .import-cat-chip[data-cat="groceries"]');
  assert.deepStrictEqual(await chipIds(thirdSel), allButIncome, 'Income drops once the purchase leaves it');
  after = await reviewRows();
  assert.strictEqual(after[third.i].categoryId, 'groceries');

  await page.click('#importConfirmBtn');
  await page.waitForFunction(() => !document.getElementById('importModal').classList.contains('show'), { timeout: 5000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1') || '[]'));
  const savedSbux = saved.filter((e) => /STARBUCKS STORE \d+/.test(e.note || ''));
  assert.ok(savedSbux.length >= 3, 'Starbucks rows saved: ' + savedSbux.length);
  savedSbux.forEach((e) => assert.strictEqual(e.categoryId, 'pets', e.note));
  const known = new Set(cats8.map((c) => c.id));
  saved.forEach((e) => assert.ok(known.has(e.categoryId), 'saved under a real category: ' + e.categoryId));
  const savedRules = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.importRules.v1') || '[]'));
  assert.ok(savedRules.some((r) => r.pattern === 'starbucks store #' && r.categoryId === 'pets'), JSON.stringify(savedRules));
  assert.deepStrictEqual(dialogs, [], 'no browser dialogs');
  assert.ok(!/\bprompt\(/.test(readFileSync(join(ROOT, 'app.js'), 'utf8').replace(/\/\/.*$/gm, '')), 'app.js has no prompt() call');

  await browser.close();
  server.close();
  console.log('qol-190-test: PASS');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
