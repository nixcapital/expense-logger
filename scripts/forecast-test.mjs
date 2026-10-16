/**
 * Forecast projection unit tests (pure forecast.js).
 * Run: node scripts/forecast-test.mjs
 */
import { createRequire } from 'module';
import assert from 'assert';

const require = createRequire(import.meta.url);
const FC = require('../forecast.js');

const MS_DAY = FC.MS_DAY;
const CHECKING = 'acct-checking';
const CHASE = 'acct-chase';

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

function entry(id, amount, note, dayTs, extra) {
  return Object.assign({
    id: id,
    amount: amount,
    note: note,
    ts: dayTs,
    accountId: CHECKING,
    categoryId: 'bills',
    isTransfer: false
  }, extra || {});
}

console.log('forecast-test: recurrence detection');
const paychecks = [
  entry('p1', 2140, 'ACME CORP PAYROLL', ts(2026, 7, 15), { isDeposit: true, categoryId: 'other' }),
  entry('p2', 2140, 'ACME CORP PAYROLL', ts(2026, 8, 15), { isDeposit: true, categoryId: 'other' }),
  entry('p3', 2140, 'ACME CORP PAYROLL', ts(2026, 9, 15), { isDeposit: true, categoryId: 'other' })
];
const recIn = FC.detectRecurrences(paychecks, { checkingId: CHECKING, sinceMs: 0, kind: 'inflow', transferPairs: [] });
assert.ok(recIn.length >= 1, 'detect paycheck recurrence');
assert.strictEqual(recIn[0].interval, 'monthly');

console.log('forecast-test: daily spend');
const dailyEntries = [];
for (var i = 0; i < 30; i++) {
  dailyEntries.push(entry('d' + i, 18 + (i % 3), 'Coffee shop', ts(2026, 8, 1) + i * MS_DAY, { categoryId: 'dining' }));
}
var daily = FC.estimateDailySpend(dailyEntries, CHECKING, [], ts(2026, 9, 1));
assert.ok(daily > 10 && daily < 30, 'daily spend estimate');

console.log('forecast-test: card payment estimate');
var paired = [{
  id: 'pair1', entryIds: ['b1', 'c1'], unlinked: false
}];
var cardEntries = [
  entry('b1', 1500, 'CHASE CARD PAYMENT', ts(2026, 8, 8), { isTransfer: true }),
  { id: 'c1', amount: 1500, note: 'Payment Thank You', ts: ts(2026, 8, 7), accountId: CHASE, isTransfer: true, categoryId: 'other' },
  entry('b2', 1566.75, 'CHASE CARD PAYMENT', ts(2026, 9, 8), { isTransfer: true })
];
paired.push({ id: 'pair2', entryIds: ['b2', 'c2'], unlinked: false });
cardEntries.push({ id: 'c2', amount: 1566.75, note: 'Payment Thank You', ts: ts(2026, 9, 7), accountId: CHASE, isTransfer: true, categoryId: 'other' });
var cardEst = FC.estimateCardPayment(cardEntries, paired, CHECKING, CHASE, ts(2026, 9, 15));
assert.ok(cardEst && cardEst.amount > 0, 'card payment estimate');

console.log('forecast-test: other-account transfer delta');
var xferOut = entry('x1', 200, 'Transfer to savings', ts(2026, 9, 1), { isTransfer: true, transferKind: 'other' });
var dOut = FC.entryCheckingDelta(xferOut, CHECKING, {});
assert.strictEqual(dOut, -200);
var xferIn = entry('x2', 200, 'TRANSFER FROM SAV', ts(2026, 9, 2), { isTransfer: true, transferKind: 'other', isDeposit: true });
assert.strictEqual(FC.entryCheckingDelta(xferIn, CHECKING, {}), 200);

console.log('forecast-test: as-of adjustment');
var bal = FC.projectedStartingBalance(2000, ts(2026, 9, 1), [
  entry('a1', 50, 'Coffee', ts(2026, 9, 2), { categoryId: 'dining' }),
  entry('a2', 2140, 'ACME CORP PAYROLL', ts(2026, 9, 3), { isDeposit: true, categoryId: 'other' })
], CHECKING, [], ts(2026, 9, 5));
assert.strictEqual(bal, 2000 - 50 + 2140);

console.log('forecast-test: lasts-until date');
var now = ts(2026, 9, 16);
var burn = [];
for (var j = 0; j < 5; j++) {
  burn.push(entry('big' + j, 500, 'Big bill', now + (j + 1) * MS_DAY, { categoryId: 'bills' }));
}
var runout = FC.runForecast({
  nowMs: now,
  checkingId: CHECKING,
  balance: 1200,
  balanceAsOfMs: now,
  cushion: 600,
  entries: burn,
  recurringItems: [],
  transferPairs: [],
  chartDays: 30,
  maxLookaheadDays: 60,
  dailySpend: 0
});
assert.ok(runout.ok);
assert.ok(!runout.neverRunsOut);
assert.ok(runout.lastsUntil > now);

console.log('forecast-test: never runs out');
var stable = FC.runForecast({
  nowMs: now,
  checkingId: CHECKING,
  balance: 50000,
  balanceAsOfMs: now,
  cushion: 600,
  entries: [],
  recurringItems: [],
  transferPairs: [],
  chartDays: 30,
  maxLookaheadDays: 365,
  dailySpend: 5
});
assert.ok(stable.neverRunsOut);

console.log('forecast-test: transfer pattern normalize');
var pat = FC.normalizeTransferPattern('ONLINE TRANSFER TO SAV ...4821');
assert.ok(pat.indexOf('online transfer to sav') !== -1 || pat.indexOf('online') !== -1);
assert.ok(FC.patternMatches('ONLINE TRANSFER TO SAV 1234', pat));

console.log('PASS');
