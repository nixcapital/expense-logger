/**
 * Agent brief tests (brief.js). Fake fixtures only.
 * Run: node scripts/brief-test.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Repo root: EL_ROOT if set, else the folder above scripts/ (works on Windows and Linux).
const ROOT = process.env.EL_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Brief = require(resolve(ROOT, 'brief.js'));
const FC = require(resolve(ROOT, 'forecast.js'));

const CHECKING = 'acct-checking';
const CHASE = 'acct-chase';
const SECRETS = [
  '4491',
  '****4491',
  '001122334455',
  'plaid-acct-FAKE99',
  'plaid-txn-FAKE99',
  'tok_BRIEF_DEVICE_SECRET',
  'RAW-BANKTEXT-SECRET',
  'receipt-blob-SECRET',
  'txn-row-SECRETID',
  'sync-v1-SECRET-TOKEN',
  'item-PLAIDITEM-SECRET',
  'expenseLogger.sync.v1',
  '9999.99',
  'Payment Thank You',
  'Chase Payment',
  'Card Credit',
  'Rebate thing',
  'Acme Payroll',
  'TRADER JOE\'S #12',
  'Should Not Count'
];
const FORBIDDEN_KEYS = [
  'banktext', 'mask', 'accountnumber', 'account_number', 'plaidaccountid',
  'plaidtransactionid', 'plaid', 'receipt', 'receiptid', 'accesstoken',
  'access_token', 'transaction_id', 'transactionid', 'itemid', 'importrowkey',
  'note', 'accountid', 'categoryid', 'istransfer', 'isdeposit', 'entries',
  'sync', 'token', 'blob', 'image', 'expenselogger.sync.v1', 'id'
];

function ts(y, m, d) { return new Date(y, m, d, 12, 0, 0).getTime(); }

function entry(id, amount, note, y, m, d, extra) {
  return Object.assign({
    id: id, amount: amount, note: note, ts: ts(y, m, d),
    accountId: CHECKING, categoryId: 'bills'
  }, extra || {});
}

function monthRow(brief, key) {
  return brief.months.filter(function (row) { return row.month === key; })[0];
}

function billNamed(brief, name) {
  return (brief.upcomingBills || []).filter(function (b) { return b.name === name; })[0];
}

function assertClean(brief) {
  var raw = JSON.stringify(brief);
  SECRETS.forEach(function (secret) {
    assert.ok(raw.indexOf(secret) === -1, 'leaked ' + secret);
  });
  assert.ok(raw.indexOf(CHECKING) === -1 && raw.indexOf(CHASE) === -1, 'leaked account id');
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    Object.keys(node).forEach(function (key) {
      assert.ok(FORBIDDEN_KEYS.indexOf(key.toLowerCase()) === -1, 'forbidden key ' + key);
      walk(node[key]);
    });
  })(brief);
}

const categories = [
  { id: 'income', name: 'Income' },
  { id: 'bills', name: 'Bills' },
  { id: 'groceries', name: 'Groceries' },
  { id: 'dining', name: 'Dining' },
  { id: 'fun', name: 'Fun' }
];

const entries = [
  entry('txn-row-SECRETID', 25.99, 'Netflix', 2026, 7, 4, { accountId: CHASE, categoryId: 'fun', bankText: 'RAW-BANKTEXT-SECRET', plaidTransactionId: 'plaid-txn-FAKE99', receiptId: 'receipt-blob-SECRET' }),
  entry('n2', 25.99, 'Netflix', 2026, 8, 4, { accountId: CHASE, categoryId: 'fun' }),
  entry('pay-sep', 4000, 'Acme Payroll', 2026, 8, 1, { isDeposit: true, categoryId: 'income' }),
  entry('rent-sep', 1500, 'Maple Court', 2026, 8, 1),
  entry('g1', 60, 'Trader Joe\'s', 2026, 8, 5, { accountId: CHASE, categoryId: 'groceries' }),
  entry('g2', 50, 'Costco', 2026, 8, 6, { accountId: CHASE, categoryId: 'groceries' }),
  entry('g3', 40, 'Aldi', 2026, 8, 7, { accountId: CHASE, categoryId: 'groceries' }),
  entry('g4', 30, 'Whole Foods', 2026, 8, 8, { accountId: CHASE, categoryId: 'groceries' }),
  entry('g5', 20, 'Safeway', 2026, 8, 9, { accountId: CHASE, categoryId: 'groceries' }),
  entry('g6', 10, 'Kroger', 2026, 8, 10, { accountId: CHASE, categoryId: 'groceries' }),
  entry('s1', 5.61, 'STARBUCKS #4412', 2026, 8, 12, { accountId: CHASE, categoryId: 'dining' }),
  entry('s2', 5.61, 'Starbucks Store 12', 2026, 8, 14, { accountId: CHASE, categoryId: 'dining' }),
  entry('refund', 12.34, 'Card Credit', 2026, 8, 3, { accountId: CHASE, isDeposit: true, categoryId: 'income' }),
  entry('skip-spend', 77.77, 'Rebate thing', 2026, 8, 18, { accountId: CHASE, countAsSpending: false, categoryId: 'fun' }),
  entry('pay-oct', 4000, 'Acme Payroll', 2026, 9, 1, { isDeposit: true, categoryId: 'income' }),
  entry('rent-oct', 1500, 'Maple Court', 2026, 9, 1),
  entry('g7', 80.1, 'TRADER JOE\'S #12', 2026, 9, 15, { accountId: CHASE, categoryId: 'groceries', receipt: { blob: 'receipt-blob-SECRET' } }),
  entry('pay-chk', 500, 'Chase Payment', 2026, 9, 20, { isTransfer: true, categoryId: 'bills' }),
  entry('pay-card', 500, 'Payment Thank You', 2026, 9, 20, { accountId: CHASE, isTransfer: true, categoryId: 'bills' }),
  entry('excluded', 9999.99, 'Should Not Count', 2026, 9, 21, { accountId: CHASE, excluded: true, categoryId: 'fun' })
];

const input = {
  nowMs: ts(2026, 10, 2),
  entries: entries,
  categories: categories,
  accounts: [
    {
      id: CHECKING, name: 'Checking', type: 'bank', color: '#20C997',
      currentBalance: 3149.4, balanceAsOf: '2026-11-02',
      mask: '4491', accountNumber: '001122334455', plaidAccountId: 'plaid-acct-FAKE99',
      itemId: 'item-PLAIDITEM-SECRET', accessToken: 'tok_BRIEF_DEVICE_SECRET'
    },
    {
      id: CHASE, name: 'Chase card', type: 'credit_card', color: '#748FFC',
      currentBalance: 1840.4, balanceAsOf: '2026-10-01', mask: '****4491'
    }
  ],
  recurringItems: [
    { id: 'r-hulu', amount: 17.99, categoryId: 'fun', note: 'Hulu', dayOfMonth: 20 }
  ],
  transferPairs: [{ entryIds: ['pay-chk', 'pay-card'] }],
  receipts: [{ id: 'receipt-blob-SECRET', data: 'receipt-blob-SECRET' }]
};
input['expenseLogger.sync.v1'] = 'sync-v1-SECRET-TOKEN';

assert.strictEqual(Brief.roundToNearest100(50), 100);
assert.strictEqual(Brief.roundToNearest100(49.99), 0);
assert.strictEqual(Brief.roundToNearest100(150), 200);
assert.strictEqual(Brief.roundToNearest100(3150), 3200);
assert.strictEqual(Brief.roundToNearest100(-50), -100);
assert.strictEqual(Brief.roundToNearest100(-150), -200);
assert.strictEqual(Brief.roundToNearest100(0), 0);
assert.strictEqual(Brief.roundToNearest100(null), null);

const edge = Brief.buildAgentBrief({
  nowMs: ts(2026, 10, 2),
  accounts: [
    { id: CHECKING, type: 'bank', currentBalance: 50, balanceAsOf: '2026-11-02' },
    { id: CHASE, type: 'credit_card', currentBalance: -50, balanceAsOf: '2026-11-02' }
  ]
});
assert.deepStrictEqual(edge.balances, { checking: 100, chaseOwed: -100 });
assert.strictEqual(edge.forecast.lowPointAmount, 50);
assert.strictEqual(edge.forecast.runwayDays, null);
assert.strictEqual(edge.level, 'L0');
assert.ok(!('upcomingBills' in edge) && !('topMerchants' in edge));
assert.strictEqual(Brief.buildAgentBrief({ level: 'L2' }).level, 'L0');
assert.deepStrictEqual(Brief.buildAgentBrief({ nowMs: input.nowMs }).balances, { checking: null, chaseOwed: null });

const projected = Brief.buildAgentBrief({
  nowMs: input.nowMs,
  accounts: [{ id: CHECKING, type: 'bank', currentBalance: 2000, balanceAsOf: '2026-10-01' }],
  entries: [entry('later', 60, 'After anchor', 2026, 9, 20)]
});
assert.strictEqual(projected.balances.checking, 1900);

const tight = Brief.buildAgentBrief({
  nowMs: input.nowMs,
  accounts: [{ id: CHECKING, type: 'bank', currentBalance: 80, balanceAsOf: '2026-11-02' }],
  recurringItems: [{ id: 'r-tax', amount: 400, note: 'Town Tax', dayOfMonth: 6 }]
});
assert.ok(tight.forecast.runwayDays > 0);
assert.strictEqual(tight.balances.checking, 100);

const l0 = Brief.buildAgentBrief(Object.assign({ level: 'L0' }, input));
const l1 = Brief.buildAgentBrief(Object.assign({ level: 'L1' }, input));

assert.strictEqual(l0.schema, 1);
assert.strictEqual(l0.level, 'L0');
assert.strictEqual(l1.level, 'L1');
assert.strictEqual(l0.generatedAt, new Date(input.nowMs).toISOString());
assert.deepStrictEqual(Object.keys(l0).sort(), ['balances', 'forecast', 'generatedAt', 'level', 'months', 'schema']);
assert.deepStrictEqual(Object.keys(l1).sort(), ['balances', 'forecast', 'generatedAt', 'level', 'months', 'schema', 'topMerchants', 'upcomingBills']);
assert.deepStrictEqual(l0.months, l1.months);
assert.deepStrictEqual(l0.forecast, l1.forecast);
assert.deepStrictEqual(l0.balances, l1.balances);
assert.deepStrictEqual(l0.balances, { checking: 3100, chaseOwed: 1400 });

assert.deepStrictEqual(monthRow(l0, '2026-08'), {
  month: '2026-08', income: 0, spend: 25.99, savingsRate: null, byCategory: { Fun: 25.99 }
});
assert.deepStrictEqual(monthRow(l0, '2026-09'), {
  month: '2026-09',
  income: 4000,
  spend: 1747.21,
  savingsRate: 0.56,
  byCategory: { Bills: 1500, Dining: 11.22, Fun: 25.99, Groceries: 210 }
});
assert.deepStrictEqual(monthRow(l0, '2026-10'), {
  month: '2026-10',
  income: 4000,
  spend: 1580.1,
  savingsRate: 0.6,
  byCategory: { Bills: 1500, Groceries: 80.1 }
});
assert.deepStrictEqual(l0.months.map(function (row) { return row.month; }), ['2026-08', '2026-09', '2026-10']);

const owed = FC.computeCardBalanceOwed({
  anchorAmount: 1840.4,
  anchorAsOfMs: FC.dateMs(2026, 9, 1),
  entries: entries,
  chaseId: CHASE,
  nowMs: input.nowMs
});
assert.strictEqual(owed.owed, 1420.5);
assert.strictEqual(l0.balances.chaseOwed, Brief.roundToNearest100(owed.owed));

const forecastInput = {
  nowMs: input.nowMs,
  checkingId: CHECKING,
  chaseId: CHASE,
  balance: 3149.4,
  balanceAsOfMs: FC.dateMs(2026, 10, 2),
  cardBalanceOwed: owed.owed,
  entries: entries,
  recurringItems: input.recurringItems,
  transferPairs: input.transferPairs,
  maxLookaheadDays: 365
};
const forecast = FC.runForecast(forecastInput);
assert.strictEqual(forecast.ok, true);
assert.strictEqual(l0.balances.checking, Brief.roundToNearest100(forecast.startingBalance));
assert.strictEqual(forecast.startingBalance, 3149.4);
assert.strictEqual(l0.forecast.lowPointDate, FC.dayKey(forecast.lowest.ts));
assert.strictEqual(l0.forecast.lowPointAmount, Math.round(forecast.lowest.balance * 100) / 100);
assert.strictEqual(l0.forecast.runwayDays, forecast.daysAway);
assert.notStrictEqual(l0.forecast.lowPointAmount, Brief.roundToNearest100(forecast.lowest.balance));
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(l0.forecast.lowPointDate));
assert.ok(l0.forecast.runwayDays == null || l0.forecast.runwayDays >= 0);

assert.ok(JSON.stringify(l0).indexOf('Hulu') === -1);
assert.ok(JSON.stringify(l0).indexOf('Starbucks') === -1);
assert.ok(JSON.stringify(l0).indexOf('Maple Court') === -1);

const hulu = billNamed(l1, 'Hulu');
const netflix = billNamed(l1, 'Netflix');
const rent = billNamed(l1, 'Maple Court');
assert.deepStrictEqual(hulu, { name: 'Hulu', amount: 17.99, dueDate: '2026-11-20' });
assert.ok(netflix && netflix.amount === 25.99 && netflix.dueDate === '2026-11-04');
assert.ok(rent && rent.amount === 1500 && rent.dueDate === '2026-12-01');
l1.upcomingBills.forEach(function (bill) {
  assert.deepStrictEqual(Object.keys(bill).sort(), ['amount', 'dueDate', 'name']);
  assert.notStrictEqual(bill.name, 'Chase card payment');
});
assert.deepStrictEqual(l1.topMerchants.Dining, [{ name: 'Starbucks', total: 11.22 }]);
assert.deepStrictEqual(l1.topMerchants.Groceries.map(function (row) { return row.name; }), [
  'Trader Joe\'s', 'Costco', 'Aldi', 'Whole Foods', 'Safeway'
]);
assert.strictEqual(l1.topMerchants.Groceries.length, 5);
assert.strictEqual(l1.topMerchants.Groceries[0].total, 140.1);
assert.ok(JSON.stringify(l1.topMerchants).indexOf('Kroger') === -1);
l1.topMerchants.Groceries.forEach(function (row) {
  assert.deepStrictEqual(Object.keys(row).sort(), ['name', 'total']);
});

assertClean(l0);
assertClean(l1);

const src = readFileSync(resolve(ROOT, 'brief.js'), 'utf8');
assert.ok(!/localStorage|indexedDB|document\.|fetch\(/.test(src), 'brief.js touches storage or DOM');
assert.ok(src.indexOf('computeCardBalanceOwed') !== -1 && src.indexOf('runForecast') !== -1);

console.log('brief-test: ok');
