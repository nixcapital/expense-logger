/**
 * Chase card balance owed — unit tests (math, forecast, correction, migration).
 * Run: node scripts/chase-balance-test.mjs
 */
import assert from 'assert';
import { createRequire } from 'module';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { buildChaseBalanceFixture, CHECKING as FX_CHECKING, CHASE as FX_CHASE, FIXTURE_NOW } from './chase-balance-fixture.mjs';

const require = createRequire(import.meta.url);
const FC = require('../forecast.js');

const CHASE = 'acct-chase';
const CHECKING = 'acct-checking';
const MS_DAY = 86400000;

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

function entry(id, amount, note, t, extra) {
  return Object.assign({
    id: id,
    amount: amount,
    categoryId: 'dining',
    note: note,
    ts: t,
    accountId: CHECKING
  }, extra || {});
}

console.log('chase-balance-test: balance math');

const anchorMs = ts(2026, 9, 1);
const fixtureEntries = [
  entry('pay-b', 2410.55, 'CHASE CREDIT CRD AUTOPAY', ts(2026, 9, 3), { isTransfer: true, categoryId: 'transfer' }),
  {
    id: 'pay-c',
    amount: 2410.55,
    note: 'Payment Thank You',
    ts: ts(2026, 9, 3),
    accountId: CHASE,
    isTransfer: true,
    categoryId: 'transfer',
    isDeposit: true
  },
  entry('p1', 7.75, 'Blue Bottle Coffee', ts(2026, 9, 16), { accountId: CHASE }),
  entry('p2', 84.12, "Trader Joe's", ts(2026, 9, 15), { accountId: CHASE, categoryId: 'groceries' }),
  entry('p3', 41.85, 'Shell', ts(2026, 9, 13), { accountId: CHASE, categoryId: 'gas' }),
  entry('p4', 1178.7, 'Other purchases', ts(2026, 9, 10), { accountId: CHASE, categoryId: 'other' }),
  entry('ref', 28.25, 'Amazon refund', ts(2026, 9, 14), { accountId: CHASE, amount: -28.25, categoryId: 'other' })
];

var snap = FC.computeCardBalanceOwed({
  anchorAmount: 2410.55,
  anchorAsOfMs: anchorMs,
  entries: fixtureEntries,
  chaseId: CHASE,
  nowMs: ts(2026, 9, 16)
});
assert.ok(snap.ok);
assert.strictEqual(snap.purchasesTotal, 1312.42);
assert.strictEqual(snap.paymentsTotal, 2438.8);
assert.strictEqual(snap.owed, 1284.17);

console.log('chase-balance-test: negative owed (credit balance)');
var neg = FC.computeCardBalanceOwed({
  anchorAmount: 50,
  anchorAsOfMs: anchorMs,
  entries: [
    { id: 'r1', amount: -120, note: 'Refund', ts: ts(2026, 9, 5), accountId: CHASE, categoryId: 'other' }
  ],
  chaseId: CHASE,
  nowMs: ts(2026, 9, 16)
});
assert.ok(neg.ok);
assert.strictEqual(neg.owed, -70);

console.log('chase-balance-test: forecast payment uses balance owed');

var paired = [{ id: 'pair1', entryIds: ['pay-b', 'pay-c'], unlinked: false }];
var cardPayEntries = fixtureEntries.concat([
  entry('b2', 1500, 'CHASE CARD PAYMENT', ts(2026, 6, 8), { isTransfer: true }),
  { id: 'c2', amount: 1500, note: 'Payment Thank You', ts: ts(2026, 6, 7), accountId: CHASE, isTransfer: true }
]);
paired.push({ id: 'pair2', entryIds: ['b2', 'c2'], unlinked: false });

var built = FC.buildScheduledEvents({
  nowMs: ts(2026, 9, 16),
  checkingId: CHECKING,
  chaseId: CHASE,
  entries: cardPayEntries,
  transferPairs: paired,
  cardBalanceOwed: 1284.17,
  maxLookaheadDays: 120
});
var cardSched = built.schedules.find(function (s) { return s && s.kind === 'card-payment'; });
assert.ok(cardSched);
assert.strictEqual(cardSched.amount, 1284.17);
assert.strictEqual(cardSched.fromBalanceOwed, true);

var builtMedian = FC.buildScheduledEvents({
  nowMs: ts(2026, 9, 16),
  checkingId: CHECKING,
  chaseId: CHASE,
  entries: cardPayEntries,
  transferPairs: paired,
  maxLookaheadDays: 120
});
var medianSched = builtMedian.schedules.find(function (s) { return s && s.kind === 'card-payment'; });
assert.ok(medianSched);
assert.notStrictEqual(medianSched.amount, 1284.17);

console.log('chase-balance-test: runForecast uses balance owed');
var runPayload = {
  nowMs: ts(2026, 9, 16),
  checkingId: CHECKING,
  chaseId: CHASE,
  balance: 3560,
  balanceAsOfMs: ts(2026, 9, 16),
  entries: fixtureEntries,
  transferPairs: paired,
  cardBalanceOwed: 1284.17,
  chartDays: 30,
  maxLookaheadDays: 120,
  recurringItems: [],
  overrides: {},
  countedOneOffs: []
};
var run = FC.runForecast(runPayload);
assert.ok(run.ok);
var upChase = (run.upcoming || []).find(function (u) { return u.label === 'Chase card payment'; });
assert.ok(upChase);
assert.strictEqual(upChase.amount, 1284.17);

console.log('chase-balance-test: computeWindowBreakdown uses balance owed');
var fx = buildChaseBalanceFixture();
var fxOwed = FC.computeCardBalanceOwed({
  anchorAmount: 2410.55,
  anchorAsOfMs: ts(2026, 9, 1),
  entries: fx.entries,
  chaseId: FX_CHASE,
  nowMs: FIXTURE_NOW
});
assert.ok(fxOwed.ok);
assert.strictEqual(fxOwed.owed, 1284.17);
var windowBr = FC.computeWindowBreakdown({
  nowMs: FIXTURE_NOW,
  windowDays: 30,
  startingBalance: 3560,
  entries: fx.entries,
  checkingId: FX_CHECKING,
  chaseId: FX_CHASE,
  transferPairs: fx.transferPairs,
  recurringItems: [],
  overrides: {},
  countedOneOffs: [],
  maxLookaheadDays: 365,
  cardBalanceOwed: fxOwed.owed
});
assert.ok(windowBr.ok);
assert.strictEqual(windowBr.cardPayments, 1284.17);
assert.strictEqual(windowBr.net, -1284.17);

console.log('chase-balance-test: browser migration + neutral correction');

const PORT = 8918;
const ROOT = '/workspace';
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function server() {
  return createServer((req, res) => {
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
}

const legacyAccounts = JSON.stringify([
  { id: CHECKING, name: 'Checking', type: 'bank', color: '#20C997', currentBalance: 3560, balanceAsOf: '2026-10-16' },
  { id: CHASE, name: 'Chase card', type: 'credit_card', color: '#748FFC' }
]);

const srv = server();
await new Promise((r) => srv.listen(PORT, r));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 428, height: 926 } });
const page = await context.newPage();

await page.addInitScript((accountsJson) => {
  localStorage.setItem('expenseLogger.accounts.v1', accountsJson);
  localStorage.setItem('expenseLogger.entries.v1', '[]');
}, legacyAccounts);

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.ExpenseLoggerTest && window.ExpenseLoggerTest.APP_VERSION);

const migrated = await page.evaluate(() => {
  const T = window.ExpenseLoggerTest;
  const chase = T.getChaseAccount();
  return {
    version: T.APP_VERSION,
    chaseName: chase && chase.name,
    hasAnchor: T.hasCardBalanceAnchor(chase),
    accountsLen: T.getState().accounts.length
  };
});
assert.strictEqual(migrated.version, '1.9.4');
assert.strictEqual(migrated.chaseName, 'Chase card');
assert.strictEqual(migrated.hasAnchor, false);
assert.strictEqual(migrated.accountsLen, 2);

await page.evaluate(() => {
  const T = window.ExpenseLoggerTest;
  const chase = T.getChaseAccount();
  chase.currentBalance = 2410.55;
  chase.balanceAsOf = '2026-10-01';
  T.persist();
});

const beforeSpend = await page.evaluate(() => {
  const T = window.ExpenseLoggerTest;
  return T.entryCountsAsSpending({
    id: 'x',
    amount: 12,
    categoryId: 'dining',
    note: 'Test',
    ts: Date.now(),
    accountId: 'acct-chase'
  });
});
assert.strictEqual(beforeSpend, true);

await page.evaluate(() => {
  const T = window.ExpenseLoggerTest;
  T.setState({
    entries: T.getState().entries.concat([
      { id: 'c1', amount: 25, categoryId: 'dining', note: 'Coffee', ts: Date.UTC(2026, 9, 16), accountId: 'acct-chase' }
    ])
  });
  T.persist();
});

await page.evaluate(() => {
  window.ExpenseLoggerTest.openChaseBalanceSheet();
  document.getElementById('chaseBalanceAsOfInput').value = '2026-10-16';
  const inp = document.getElementById('chaseBalanceAmountInput');
  inp.value = '1309.42';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  window.ExpenseLoggerTest.saveChaseBalanceSheet();
});

const afterSave = await page.evaluate(() => {
  const T = window.ExpenseLoggerTest;
  const chase = T.getChaseAccount();
  const spendCount = T.getState().entries.filter((e) => T.entryCountsAsSpending(e)).length;
  const checking = T.getState().accounts.find((a) => a.type === 'bank');
  return {
    balance: chase.currentBalance,
    asOf: chase.balanceAsOf,
    spendCount: spendCount,
    checkingBalance: checking && checking.currentBalance
  };
});
assert.strictEqual(afterSave.balance, 1309.42);
assert.strictEqual(afterSave.asOf, '2026-10-16');
assert.strictEqual(afterSave.spendCount, 1);
assert.strictEqual(afterSave.checkingBalance, 3560);

await browser.close();
srv.close();

console.log('chase-balance-test: all passed');
