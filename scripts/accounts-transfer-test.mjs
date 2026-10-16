/**
 * Accounts, import tagging, transfer pairing, backup tests.
 * Run: node scripts/accounts-transfer-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import assert from 'assert';

const PORT = 8881;
const ROOT = '/workspace';
const FIX = join(ROOT, 'test/fixtures');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

async function importThroughAccountSheet(page, relPath) {
  await page.locator('#importFileInput').setInputFiles(join(FIX, relPath));
  await page.waitForSelector('#importAccountModal.show', { timeout: 5000 });
  await page.click('#importAccountContinueBtn');
  await page.waitForSelector('#importModal.show', { timeout: 5000 });
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });
  const results = [];

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
      { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
      { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
      { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });

  const suggest = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    T.ensureDefaultAccounts();
    return {
      card: T.suggestImportAccountId('card'),
      bank: T.suggestImportAccountId('bank')
    };
  });
  results.push(['suggest chase for card csv', suggest.card === 'acct-chase', suggest.card]);
  results.push(['suggest checking for bank', suggest.bank === 'acct-checking', suggest.bank]);

  await page.click('button[data-tab="settings"]');
  await importThroughAccountSheet(page, 'sample-card.csv');
  await page.click('#importConfirmBtn');
  await page.waitForTimeout(400);

  const tagged = await page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    const spending = entries.filter((e) => !e.isTransfer);
    return spending.length > 0 && spending.every((e) => e.accountId === 'acct-chase');
  });
  results.push(['card import tags spending rows', tagged]);

  await importThroughAccountSheet(page, 'sample-card.csv');
  const dupSummary = await page.locator('#importSummary').innerText();
  await page.click('#importConfirmBtn');
  await page.waitForTimeout(400);
  const afterRe = await page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    const spending = entries.filter((e) => !e.isTransfer);
    return { n: spending.length, allTagged: spending.every((e) => e.accountId === 'acct-chase') };
  });
  results.push(['reimport keeps count', afterRe.n === 5 && afterRe.allTagged, afterRe]);
  results.push(['reimport shows duplicates', /duplicate/i.test(dupSummary)]);

  const pairing = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    const tsAt = (y, m, d) => new Date(y, m, d, 12, 0, 0).getTime();
    T.setState({
      entries: [],
      accounts: [
        { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997' },
        { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
      ],
      transferPairs: [],
      transferUnlinkKeys: []
    });
    const bankId = 'b1';
    const cardId = 'c1';
    T.setState({
      entries: [
        {
          id: bankId, amount: 1250, categoryId: 'bills', note: 'CHASE CRD AUTOPAY', ts: tsAt(2026, 9, 15),
          isTransfer: true, accountId: 'acct-checking', importSource: 'bank'
        },
        {
          id: cardId, amount: 1250, categoryId: 'bills', note: 'Payment Thank You', ts: tsAt(2026, 9, 16),
          isTransfer: true, accountId: 'acct-chase', importSource: 'card', typeVal: 'payment'
        }
      ]
    });
    T.autoPairTransfers();
    const st = T.getState();
    const paired = st.transferPairs.filter((p) => !p.unlinked).length === 1;
    const items = T.buildActivityDisplayItems(st.entries);
    const summary = T.computeActivitySummary(items, T.getActivityRangeBounds('this-month', new Date(2026, 9, 16)));
    const spendingOk = summary.total === 0 && summary.transferCount === 1;
    return { paired, spendingOk, transferCount: summary.transferCount };
  });
  results.push(['pair match same amount', pairing.paired && pairing.spendingOk, pairing]);

  const mismatch = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    const tsAt = (y, m, d) => new Date(y, m, d, 12, 0, 0).getTime();
    T.setState({ entries: [], transferPairs: [], transferUnlinkKeys: [] });
    T.setState({
      entries: [
        { id: 'b2', amount: 100, isTransfer: true, accountId: 'acct-checking', categoryId: 'bills', note: 'CHASE EPAY', ts: tsAt(2026, 9, 1) },
        { id: 'c2', amount: 99, isTransfer: true, accountId: 'acct-chase', categoryId: 'bills', note: 'Payment Thank You', ts: tsAt(2026, 9, 2), typeVal: 'payment' }
      ]
    });
    T.autoPairTransfers();
    return T.getState().transferPairs.filter((p) => !p.unlinked).length === 0;
  });
  results.push(['no pair amount mismatch', mismatch]);

  const farApart = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    const tsAt = (y, m, d) => new Date(y, m, d, 12, 0, 0).getTime();
    T.setState({ entries: [], transferPairs: [], transferUnlinkKeys: [] });
    T.setState({
      entries: [
        { id: 'b3', amount: 50, isTransfer: true, accountId: 'acct-checking', categoryId: 'bills', note: 'CHASE EPAY', ts: tsAt(2026, 9, 1) },
        { id: 'c3', amount: 50, isTransfer: true, accountId: 'acct-chase', categoryId: 'bills', note: 'Payment Thank You', ts: tsAt(2026, 9, 10), typeVal: 'payment' }
      ]
    });
    T.autoPairTransfers();
    return T.getState().transferPairs.filter((p) => !p.unlinked).length === 0;
  });
  results.push(['no pair >5 days', farApart]);

  const sameType = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    const tsAt = (y, m, d) => new Date(y, m, d, 12, 0, 0).getTime();
    T.setState({ entries: [], transferPairs: [], transferUnlinkKeys: [] });
    T.setState({
      entries: [
        { id: 'b4', amount: 40, isTransfer: true, accountId: 'acct-checking', categoryId: 'bills', note: 'CHASE EPAY', ts: tsAt(2026, 9, 3) },
        { id: 'b5', amount: 40, isTransfer: true, accountId: 'acct-checking', categoryId: 'bills', note: 'OTHER EPAY', ts: tsAt(2026, 9, 4) }
      ]
    });
    T.autoPairTransfers();
    return T.getState().transferPairs.filter((p) => !p.unlinked).length === 0;
  });
  results.push(['no pair same-type accounts', sameType]);

  const unlink = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    const tsAt = (y, m, d) => new Date(y, m, d, 12, 0, 0).getTime();
    const bankId = 'bu';
    const cardId = 'cu';
    T.setState({
      accounts: [
        { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997' },
        { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
      ],
      entries: [
        { id: bankId, amount: 80, isTransfer: true, accountId: 'acct-checking', categoryId: 'bills', note: 'CHASE CRD AUTOPAY', ts: tsAt(2026, 9, 5) },
        { id: cardId, amount: 80, isTransfer: true, accountId: 'acct-chase', categoryId: 'bills', note: 'Payment Thank You', ts: tsAt(2026, 9, 6), typeVal: 'payment' }
      ],
      transferPairs: [],
      transferUnlinkKeys: []
    });
    T.autoPairTransfers();
    const pairs = T.getState().transferPairs.filter((p) => !p.unlinked);
    if (!pairs.length) return false;
    const pid = pairs[0].id;
    T.unlinkTransferPair(pid);
    T.autoPairTransfers();
    const st = T.getState();
    return st.transferPairs.some((p) => p.id === pid && p.unlinked === true) && T.isTransferPairBlocked(bankId, cardId);
  });
  results.push(['unlink blocks re-pair', unlink]);

  const backupRound = await page.evaluate(async () => {
    const B = window.ExpenseLoggerBackup;
    const T = window.ExpenseLoggerTest;
    T.ensureDefaultAccounts();
    T.setState({
      entries: [{ id: 'e1', amount: 12, categoryId: 'groceries', accountId: 'acct-chase', ts: Date.now() }],
      transferPairs: [{ id: 'p1', entryIds: ['a', 'b'], auto: true, unlinked: false }],
      transferUnlinkKeys: ['a|b']
    });
    T.persist();
    const doc = B.buildBackupDocument();
    if (doc.backupFormat !== 2) return false;
    localStorage.clear();
    await B.commitBackupRestore(doc);
    T.reloadFromStorage();
    const st = T.getState();
    return st.accounts.length >= 2 && st.entries[0].accountId === 'acct-chase' && st.transferPairs.length === 1;
  });
  results.push(['backup round-trip v2', backupRound]);

  const legacyRestore = await page.evaluate(async () => {
    const B = window.ExpenseLoggerBackup;
    localStorage.clear();
    const legacy = {
      backupFormat: 1,
      appVersion: '1.4.3',
      createdAt: new Date().toISOString(),
      storage: {
        'expenseLogger.entries.v1': JSON.stringify([
          { id: 'old1', amount: 9, categoryId: 'groceries', ts: Date.now() }
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
    const v = B.validateBackupDocument(legacy);
    if (!v.ok) return false;
    await B.commitBackupRestore(legacy);
    const entries = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    return entries.length === 1 && entries[0].id === 'old1';
  });
  results.push(['legacy backup restore', legacyRestore]);

  let failed = 0;
  results.forEach(([name, ok, detail]) => {
    const pass = !!ok;
    if (!pass) failed++;
    console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : ''));
  });

  await browser.close();
  server.close();
  if (failed) process.exit(1);
  console.log('accounts-transfer-test: all passed');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
