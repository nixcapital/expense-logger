/**
 * Recurring-detection QA fixtures (fake merchants only).
 * Run: node scripts/forecast-recurring-qa-test.mjs
 */
import { createRequire } from 'module';
import assert from 'assert';

const require = createRequire(import.meta.url);
const FC = require('../forecast.js');

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

function detectOut(entries, nowMs) {
  return FC.detectRecurringSchedules(entries, {
    checkingId: CHECKING,
    sinceMs: 0,
    nowMs: nowMs,
    kind: 'outflow',
    transferPairs: []
  });
}

console.log('recurring-qa: loan regular plus extra principal clusters');
(function () {
  const rows = [];
  let id = 0;
  for (let i = 0; i < 6; i++) {
    rows.push(entry('ln' + id++, 850, 'FAKE AUTO LOAN CO', ts(2026, 3 + i, 12)));
  }
  rows.push(entry('lnx1', 320, 'FAKE AUTO LOAN CO', ts(2026, 5, 20)));
  rows.push(entry('lnx2', 315, 'FAKE AUTO LOAN CO', ts(2026, 8, 18)));
  const now = ts(2026, 9, 16);
  const sched = detectOut(rows, now);
  const main = sched.find((s) => s.amount === 850);
  assert.ok(main, 'regular $850 schedule');
  assert.strictEqual(main.scheduleType, 'monthly_dom');
  assert.ok(!sched.some((s) => s.amount === 320), 'extra principal not scheduled');
})();

console.log('recurring-qa: twice-monthly card two amount clusters');
(function () {
  const rows = [];
  let id = 0;
  for (let i = 0; i < 6; i++) {
    rows.push(entry('sm' + id++, 32, 'FAKE RIVER CARD PAYMENT', ts(2026, 3 + i, 3)));
    rows.push(entry('lg' + id++, 300 + (i % 3) * 40, 'FAKE RIVER CARD PAYMENT', ts(2026, 3 + i, 18)));
  }
  const now = ts(2026, 9, 16);
  const sched = detectOut(rows, now);
  const small = sched.find((s) => s.amount <= 35);
  const large = sched.find((s) => s.amount >= 280);
  assert.ok(small && large, 'both small and large schedules');
  assert.ok(large.amount >= 320 && large.amount <= 400, 'large at recent median');
})();

console.log('recurring-qa: P2P venmo noise not scheduled');
(function () {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push(entry('v' + i, 8 + (i * 7) % 45, 'VENMO PAYMENT', ts(2026, 6, 1) + i * 3 * 86400000, { categoryId: 'dining' }));
  }
  const sched = detectOut(rows, ts(2026, 9, 16));
  assert.strictEqual(sched.length, 0, 'venmo stays daily spend');
})();

console.log('recurring-qa: bill on 15th uses day-of-month not nth weekday');
(function () {
  const rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push(entry('u' + i, 120, 'FAKE UTILITIES INC', ts(2026, 3 + i, 15)));
  }
  const sched = detectOut(rows, ts(2026, 9, 16));
  assert.ok(sched.length >= 1);
  assert.strictEqual(sched[0].scheduleType, 'monthly_dom');
  assert.strictEqual(sched[0].dayOfMonth, 15);
})();

console.log('recurring-qa: skip duplicate occurrence same cycle');
(function () {
  const now = ts(2026, 9, 16);
  const rows = [entry('t1', 120, 'FAKE UTILITIES INC', ts(2026, 9, 15))];
  for (let i = 0; i < 5; i++) {
    rows.push(entry('th' + i, 120, 'FAKE UTILITIES INC', ts(2026, 3 + i, 15)));
  }
  const sched = detectOut(rows, now);
  assert.ok(sched.length >= 1);
  const s = sched[0];
  const events = FC.expandSchedule(s, now, FC.addDays(now, 45), rows, CHECKING);
  const oct = events.filter((e) => {
    const d = new Date(e.ts);
    return d.getMonth() === 9 && d.getFullYear() === 2026;
  });
  assert.strictEqual(oct.length, 0, 'no second October bill after Oct 15 post');
})();

console.log('recurring-qa: daily spend with few rows and P2P not zeroed');
(function () {
  const rows = [
    entry('a1', 14, 'VENMO PAYMENT', ts(2026, 9, 10), { categoryId: 'dining' }),
    entry('a2', 9, 'VENMO PAYMENT', ts(2026, 9, 5), { categoryId: 'dining' }),
    entry('a3', 11, 'COFFEE SHOP', ts(2026, 9, 8), { categoryId: 'dining' })
  ];
  const daily = FC.estimateDailySpend(rows, CHECKING, [], ts(2026, 9, 16), []);
  assert.ok(daily > 0, 'daily spend with <7 rows');
})();

console.log('recurring-qa: semiannual insurance two payments wide band');
(function () {
  const rows = [
    entry('i1', 640, 'FAKE MUTUAL INSURANCE', ts(2026, 3, 1)),
    entry('i2', 668, 'FAKE MUTUAL INSURANCE', ts(2025, 9, 1))
  ];
  const now = ts(2026, 9, 16);
  const sched = detectOut(rows, now);
  assert.ok(sched.some((s) => s.scheduleType === 'semiannual'), 'semiannual detected');
  const ins = sched.find((s) => /INSURANCE/i.test(s.label));
  const next = FC.expandSchedule(ins, now, FC.addDays(now, 200), rows, CHECKING);
  assert.ok(next.length >= 1, 'projects next semiannual payment');
})();

console.log('recurring-qa: chase card median of last three');
(function () {
  const pairs = [];
  const entries = [];
  const amounts = [2800, 3100, 3600, 3400];
  amounts.forEach((amt, i) => {
    const bId = 'cb' + i;
    const cId = 'cc' + i;
    entries.push(entry(bId, amt, 'CHASE CARD PAYMENT', ts(2026, 4 + i, 14), { isTransfer: true, categoryId: 'transfer' }));
    entries.push({
      id: cId, amount: amt, note: 'Payment Thank You', ts: ts(2026, 4 + i, 13),
      accountId: CHASE, isTransfer: true, isDeposit: true, categoryId: 'transfer'
    });
    pairs.push({ id: 'p' + i, entryIds: [bId, cId], unlinked: false });
  });
  const sched = FC.detectCardPaymentSchedule(entries, pairs, CHECKING);
  assert.ok(sched);
  assert.strictEqual(sched.amount, 3400, 'median of last 3 not spike 3600 alone');
})();

console.log('forecast-recurring-qa-test: PASS');
