/**
 * Forecast projection unit tests (pure forecast.js).
 * Run: node scripts/forecast-test.mjs
 */
import { createRequire } from 'module';
import assert from 'assert';
import { buildForecastFixture164, FIXTURE_NOW } from './forecast-fixture-164.mjs';

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

console.log('forecast-test: override targets tapped occurrence');
var nowFix = ts(2026, 9, 16);
var itemKey = 'dukeenergy';
var oct22 = ts(2026, 9, 22);
var oct25 = ts(2026, 9, 25);
var nov22 = ts(2026, 10, 22);
var baseEvents = [
  { ts: oct22, amount: 142.4, itemKey: itemKey, kind: 'outflow', label: 'Duke Energy' },
  { ts: nov22, amount: 142.4, itemKey: itemKey, kind: 'outflow', label: 'Duke Energy' }
];
var overridden = FC.applyForecastOverrides(baseEvents, {
  dukeenergy: { amount: 142.4, nextTs: oct25, applyFromTs: oct22, kind: 'outflow' }
}, nowFix);
assert.ok(overridden.some(function (e) { return e.itemKey === itemKey && e.ts === FC.startOfDay(oct25); }));
assert.ok(!overridden.some(function (e) { return e.itemKey === itemKey && e.ts === FC.startOfDay(oct22); }));
assert.ok(overridden.some(function (e) { return e.itemKey === itemKey && e.ts === nov22; }));

console.log('forecast-test: money lasts until last solvent EOD');
var eodSim = FC.simulateBalanceTimeline({
  nowMs: nowFix,
  startingBalance: 50,
  entries: [],
  checkingId: CHECKING,
  transferPairs: [],
  recurringItems: [],
  chartDays: 30,
  maxLookaheadDays: 30,
  cushion: 600,
  dailySpend: 20
});
assert.ok(eodSim.lastsUntil != null);
assert.strictEqual(eodSim.lastsUntil, FC.addDays(nowFix, 2));
var brokePoint = eodSim.points.filter(function (p) { return p.ts === FC.addDays(nowFix, 3); })[0];
assert.ok(brokePoint && brokePoint.balance < 0);

console.log('forecast-test: upcoming row matches chart EOD on bill day');
var billEntries = [
  entry('b1', 1650, 'Maple Court Apts', ts(2026, 8, 1), {}),
  entry('b2', 1650, 'Maple Court Apts', ts(2026, 9, 1), {})
];
var billSim = FC.simulateBalanceTimeline({
  nowMs: nowFix,
  startingBalance: 2000,
  entries: billEntries,
  checkingId: CHECKING,
  transferPairs: [],
  recurringItems: [],
  chartDays: 90,
  maxLookaheadDays: 90,
  cushion: 600,
  dailySpend: 18
});
var rentRow = billSim.upcoming.filter(function (u) { return /maple/i.test(u.label); })[0];
assert.ok(rentRow, 'scheduled rent row exists');
var chartBal = billSim.points.filter(function (p) { return p.ts === rentRow.ts; })[0];
assert.ok(chartBal, 'chart point on rent day exists');
assert.strictEqual(rentRow.balanceAfter, chartBal.balance);

console.log('forecast-test: y-axis hides tick near $600 cushion');
var axisPlan = FC.planForecastChartYAxisLabels({
  minBal: 0,
  maxBal: 2500,
  step: 500,
  cushion: 600,
  cushionNear: true,
  padT: 12,
  innerH: 162,
  baselineNudge: 4
});
assert.strictEqual(FC.yAxisLabelsCollide(axisPlan), false);
assert.ok(axisPlan.hidden.some(function (h) { return h.bal === 500; }), '500 tick hidden near 600 cushion');
assert.ok(axisPlan.labels.some(function (l) { return l.isCushion && l.bal === 600; }));

console.log('forecast-test: y-axis plan across chart windows');
[30, 60, 90].forEach(function (days) {
  var simW = FC.simulateBalanceTimeline({
    nowMs: nowFix,
    startingBalance: 2382.42,
    entries: billEntries,
    checkingId: CHECKING,
    transferPairs: [],
    recurringItems: [],
    chartDays: days,
    maxLookaheadDays: 365,
    cushion: 600,
    dailySpend: 18
  });
  var pts = simW.points.filter(function (p) { return p.ts <= FC.addDays(nowFix, days); });
  var dMin = pts[0].balance;
  var dMax = pts[0].balance;
  pts.forEach(function (p) {
    if (p.balance < dMin) dMin = p.balance;
    if (p.balance > dMax) dMax = p.balance;
  });
  var spanW = Math.max(80, dMax - dMin);
  var near = 600 >= dMin - spanW * 0.25 && 600 <= dMax + spanW * 0.2;
  if (near) {
    var dMinA = Math.min(dMin, 600);
    var dMaxA = Math.max(dMax, 600);
    var stepW = FC.forecastChartAxisStep(dMaxA - dMinA);
    var minB = Math.floor((dMinA - stepW * 0.35) / stepW) * stepW;
    var maxB = Math.ceil((dMaxA + stepW * 0.35) / stepW) * stepW;
    var planW = FC.planForecastChartYAxisLabels({
      minBal: minB, maxBal: maxB, step: stepW, cushion: 600, cushionNear: true, padT: 12, innerH: 162
    });
    assert.strictEqual(FC.yAxisLabelsCollide(planW), false, 'window ' + days + 'd');
  }
});

console.log('forecast-test: projected balance ignores future-dated entries');
var nowProj = FC.startOfDay(FC.dateMs(2026, 9, 16));
var futureXfer = entry('fut-xfer', 612.9, 'CHASE CREDIT CRD AUTOPAY', FC.dateMs(2026, 10, 10), {
  accountId: CHECKING,
  isTransfer: true,
  isDeposit: false
});
var projEntries = billEntries.concat([futureXfer]);
var projected = FC.projectedStartingBalance(
  1234.56,
  nowProj,
  projEntries,
  CHECKING,
  [],
  nowProj
);
assert.strictEqual(projected, 1234.56, 'future ledger rows must not reduce today balance');

console.log('forecast-test: invalid / iOS-style date inputs');
var badForecast = FC.runForecast({
  nowMs: Date.now(),
  checkingId: CHECKING,
  balance: 1200,
  balanceAsOfMs: Date.now(),
  entries: [
    entry('bad1', 10, 'note', '2026-10-16 09:15', { accountId: CHECKING }),
    entry('bad2', 5, 'note', NaN, { accountId: CHECKING }),
    { id: 'bad3', amount: 3, accountId: CHECKING, categoryId: 'other', note: 'no ts' }
  ],
  transferPairs: [],
  chartDays: 60,
  cushion: 600
});
assert.ok(badForecast && typeof badForecast.ok === 'boolean', 'invalid ts must not throw');
assert.ok(!FC.isBankHoliday(NaN), 'NaN ts is not a bank holiday');

console.log('forecast-test: 1.6.4 owner-shaped fake fixture');
const fx = buildForecastFixture164();
const fxRun = FC.runForecast({
  nowMs: fx.nowMs,
  checkingId: fx.checkingId,
  chaseId: fx.chaseId,
  balance: fx.balance,
  balanceAsOfMs: fx.nowMs,
  entries: fx.entries,
  transferPairs: fx.transferPairs,
  chartDays: 30,
  maxLookaheadDays: 365,
  cushion: 600
});
assert.ok(fxRun.ok, 'fixture forecast ok');
assert.ok(fxRun.dailySpend < 20, 'daily spend ~small, got ' + fxRun.dailySpend);
assert.strictEqual(fxRun.noIncomeDetected, true, 'no income flag');

function schedAmt(labelRe) {
  const s = (fxRun.schedules || []).find((x) => labelRe.test(x.label));
  return s;
}
function nextOccurrence(sched) {
  return FC.expandSchedule(sched, FIXTURE_NOW, FC.addDays(FIXTURE_NOW, 120))[0];
}

const mort = schedAmt(/MORTGAGE/i);
assert.ok(mort && mort.amount === 1117, 'mortgage latest amount');
const mortNext = nextOccurrence(mort);
assert.ok(mortNext && mortNext.amount === 1117);
assert.ok(new Date(mortNext.ts).getDate() <= 3, 'mortgage near 1st with weekend shift');

assert.ok(schedAmt(/TOYOTA/i).amount === 385);
assert.ok(schedAmt(/TUITION/i).amount === 450);
assert.ok(schedAmt(/NELNET/i).amount === 220);
assert.ok(schedAmt(/STATE FARM/i).scheduleType === 'semiannual');
assert.ok(schedAmt(/VERIZON/i).amount === 166);
assert.ok(!schedAmt(/PLANET FITNESS/i), 'stale gym not projected');
assert.ok(schedAmt(/DISCOVER/i), 'discover e-payment projected');

const chase = schedAmt(/Chase card/i);
assert.ok(chase && chase.amount >= 3500);

const fxSim = FC.simulateBalanceTimeline({
  nowMs: fx.nowMs,
  startingBalance: fxRun.startingBalance,
  entries: fx.entries,
  checkingId: fx.checkingId,
  chaseId: fx.chaseId,
  transferPairs: fx.transferPairs,
  chartDays: 30,
  cushion: 600
});
assert.ok(fxSim.lowestInWindow.balance > -25000 && fxSim.lowestInWindow.balance < 5000, '30d low sane');

console.log('forecast-test: fixture with biweekly paychecks stays positive');
const fxPay = buildForecastFixture164({ withIncome: true, balance: 12000 });
const payRun = FC.runForecast({
  nowMs: fxPay.nowMs,
  checkingId: fxPay.checkingId,
  chaseId: fxPay.chaseId,
  balance: fxPay.balance,
  balanceAsOfMs: fxPay.nowMs,
  entries: fxPay.entries,
  transferPairs: fxPay.transferPairs,
  chartDays: 60,
  cushion: 600
});
assert.strictEqual(payRun.noIncomeDetected, false);
const paySim = FC.simulateBalanceTimeline({
  nowMs: fxPay.nowMs,
  startingBalance: payRun.startingBalance,
  entries: fxPay.entries,
  checkingId: fxPay.checkingId,
  chaseId: fxPay.chaseId,
  transferPairs: fxPay.transferPairs,
  chartDays: 60,
  cushion: 600
});
assert.ok(paySim.lowestInWindow.balance >= 0, 'with paychecks 60d window stays positive');

console.log('PASS');
