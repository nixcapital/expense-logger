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
const ROOT = '/workspace';
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
  assert.strictEqual(version, '1.9.0');

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

  await browser.close();
  server.close();
  console.log('qol-190-test: PASS');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
