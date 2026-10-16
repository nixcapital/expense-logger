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

function addDays(t, n) {
  return FC.addDays(t, n);
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

console.log('forecast-test: small purchases not recurring');
var coffees = [];
for (var ci = 0; ci < 8; ci++) {
  coffees.push(entry('c' + ci, 5.5 + (ci % 3), 'Starbucks', ts(2026, 8, 5) + ci * 7 * MS_DAY, { categoryId: 'dining' }));
}
var coffeeSched = FC.detectRecurringSchedules(coffees, {
  checkingId: CHECKING, sinceMs: 0, nowMs: ts(2026, 9, 16), kind: 'outflow', transferPairs: []
});
assert.strictEqual(coffeeSched.length, 0, 'small debits stay in daily spend only');

console.log('forecast-test: two-post monthly rent (low confidence)');
var rentTwo = [
  entry('rt1', 1650, 'Maple Court Apts', ts(2026, 8, 1), {}),
  entry('rt2', 1650, 'Maple Court Apts', ts(2026, 9, 1), {})
];
var nowOct = ts(2026, 9, 16);
var rentTwoSched = FC.detectRecurringSchedules(rentTwo, {
  checkingId: CHECKING, sinceMs: 0, nowMs: nowOct, kind: 'outflow', transferPairs: []
});
assert.ok(rentTwoSched.length >= 1, 'two rent posts detected');
assert.strictEqual(rentTwoSched[0].confidence, 'low');

console.log('forecast-test: chart-window lowest');
var simWin = FC.simulateBalanceTimeline({
  nowMs: nowOct,
  startingBalance: 2000,
  entries: rentTwo,
  checkingId: CHECKING,
  transferPairs: [],
  recurringItems: [],
  chartDays: 60,
  maxLookaheadDays: 365,
  cushion: 600,
  dailySpend: 0
});
assert.ok(simWin.lowestInWindow);
assert.ok(simWin.lowestInWindow.ts <= FC.addDays(nowOct, 60));

console.log('forecast-test: monthly dom paycheck');
const paychecks = [
  entry('p1', 2140, 'ACME CORP PAYROLL', ts(2026, 7, 15), { isDeposit: true, categoryId: 'other' }),
  entry('p2', 2140, 'ACME CORP PAYROLL', ts(2026, 8, 15), { isDeposit: true, categoryId: 'other' }),
  entry('p3', 2140, 'ACME CORP PAYROLL', ts(2026, 9, 15), { isDeposit: true, categoryId: 'other' })
];
const recIn = FC.detectRecurringSchedules(paychecks, { checkingId: CHECKING, sinceMs: 0, kind: 'inflow', transferPairs: [] });
assert.ok(recIn.length >= 1, 'detect paycheck recurrence');
assert.strictEqual(recIn[0].scheduleType, 'monthly_dom');
assert.strictEqual(recIn[0].dayOfMonth, 15);

console.log('forecast-test: weekend shift for rent (Sat -> Mon)');
var rent = [
  entry('r1', 1650, 'Maple Court Apts', ts(2025, 9, 1), {}),
  entry('r2', 1650, 'Maple Court Apts', ts(2025, 10, 3), {}),
  entry('r3', 1650, 'Maple Court Apts', ts(2025, 11, 1), {}),
  entry('r4', 1650, 'Maple Court Apts', ts(2026, 0, 1), {}),
  entry('r5', 1650, 'Maple Court Apts', ts(2026, 1, 2), {})
];
var rentSched = FC.detectRecurringSchedules(rent, { checkingId: CHECKING, sinceMs: 0, kind: 'outflow', transferPairs: [] });
assert.ok(rentSched.length >= 1);
var satNominal = FC.dateMs(2025, 10, 1);
var shifted = FC.adjustToBusinessDay(satNominal, 'next');
assert.strictEqual(new Date(satNominal).getDay(), 6, 'Nov 1 2025 is Saturday');
assert.strictEqual(new Date(shifted).getDay(), 1, 'debit shifts to Monday');
assert.strictEqual(new Date(shifted).getDate(), 3);

console.log('forecast-test: biweekly anchoring');
var bi = [];
var anchor = ts(2026, 0, 9);
for (var i = 0; i < 6; i++) {
  bi.push(entry('b' + i, 200, 'Transfer to savings', anchor + i * 14 * MS_DAY, { isTransfer: true, transferKind: 'other' }));
}
var biSched = FC.detectRecurringSchedules(bi, { checkingId: CHECKING, sinceMs: 0, kind: 'transfer-other', transferPairs: [] });
assert.ok(biSched.length >= 1);
assert.strictEqual(biSched[0].scheduleType, 'biweekly');
var nextBi = FC.expandSchedule(biSched[0], bi[bi.length - 1].ts, ts(2026, 5, 1));
assert.ok(nextBi.length >= 1);
assert.strictEqual(nextBi[0].ts, addDays(bi[5].ts, 14));

console.log('forecast-test: semimonthly');
var semi = [];
[ts(2026, 0, 1), ts(2026, 0, 15), ts(2026, 1, 2), ts(2026, 1, 15), ts(2026, 2, 2), ts(2026, 2, 16)].forEach(function (t, idx) {
  semi.push(entry('s' + idx, 500, 'Split pay', t, { isDeposit: true, categoryId: 'other' }));
});
var semiSched = FC.detectRecurringSchedules(semi, { checkingId: CHECKING, sinceMs: 0, kind: 'inflow', transferPairs: [] });
assert.ok(semiSched.some(function (s) { return s.scheduleType === 'semimonthly'; }), 'semimonthly detected');

console.log('forecast-test: Chase payment day of month');
var paired = [
  { id: 'pair1', entryIds: ['b1', 'c1'], unlinked: false },
  { id: 'pair2', entryIds: ['b2', 'c2'], unlinked: false }
];
var cardEntries = [
  entry('b1', 1500, 'CHASE CARD PAYMENT', ts(2026, 6, 8), { isTransfer: true }),
  { id: 'c1', amount: 1500, note: 'Payment Thank You', ts: ts(2026, 6, 7), accountId: CHASE, isTransfer: true, categoryId: 'other' },
  entry('b2', 1566.75, 'CHASE CARD PAYMENT', ts(2026, 7, 8), { isTransfer: true }),
  { id: 'c2', amount: 1566.75, note: 'Payment Thank You', ts: ts(2026, 7, 7), accountId: CHASE, isTransfer: true, categoryId: 'other' }
];
var chaseSched = FC.detectCardPaymentSchedule(cardEntries, paired, CHECKING);
assert.ok(chaseSched);
assert.strictEqual(chaseSched.dayOfMonth, 8);
assert.ok(chaseSched.amount > 0);

console.log('forecast-test: holiday shift (Jul 4 observed)');
var july4Nominal = FC.dateMs(2026, 6, 4);
var adjusted = FC.adjustToBusinessDay(july4Nominal, 'next');
assert.ok(FC.isBankHoliday(july4Nominal) || new Date(july4Nominal).getDay() === 6 || new Date(july4Nominal).getDay() === 0);
assert.ok(FC.isBusinessDay(adjusted));

console.log('forecast-test: forecast overrides');
var now = ts(2026, 9, 16);
var runout = FC.runForecast({
  nowMs: now,
  checkingId: CHECKING,
  balance: 5000,
  balanceAsOfMs: now,
  cushion: 600,
  entries: rent.concat(paychecks),
  recurringItems: [],
  transferPairs: [],
  chartDays: 60,
  maxLookaheadDays: 120,
  dailySpend: 0,
  overrides: {}
});
assert.ok(runout.ok);

console.log('forecast-test: other-account transfer delta');
var xferOut = entry('x1', 200, 'Transfer to savings', ts(2026, 9, 1), { isTransfer: true, transferKind: 'other' });
assert.strictEqual(FC.entryCheckingDelta(xferOut, CHECKING, {}), -200);

console.log('PASS');
