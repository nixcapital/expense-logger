/**
 * Activity time-range math, summary totals, transfer exclusion (mirrors app.js).
 * Run: node scripts/activity-range-test.mjs
 */
import assert from 'assert';

const MS_DAY = 86400000;
const ACTIVITY_RANGE_IDS = ['this-month', 'last-month', '3-months', 'year', 'all'];

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function normalizeActivityRangeId(id) {
  if (ACTIVITY_RANGE_IDS.indexOf(id) !== -1) return id;
  return 'this-month';
}

function endOfLocalDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

function getActivityRangeBounds(rangeId, now) {
  now = now || new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const m = today.getMonth();
  const id = normalizeActivityRangeId(rangeId);

  if (id === 'all') {
    return {
      id,
      startMs: null,
      endMs: endOfLocalDay(today.getTime()),
      multiMonth: true,
      label: 'All time'
    };
  }
  if (id === 'this-month') {
    return {
      id,
      startMs: new Date(y, m, 1).getTime(),
      endMs: endOfLocalDay(today.getTime()),
      multiMonth: false,
      label: null
    };
  }
  if (id === 'last-month') {
    let lm = m - 1;
    let ly = y;
    if (lm < 0) { lm = 11; ly -= 1; }
    const lastDay = daysInMonth(ly, lm);
    return {
      id,
      startMs: new Date(ly, lm, 1).getTime(),
      endMs: endOfLocalDay(new Date(ly, lm, lastDay).getTime()),
      multiMonth: false,
      label: null
    };
  }
  if (id === '3-months') {
    let sm = m - 2;
    let sy = y;
    while (sm < 0) { sm += 12; sy -= 1; }
    return {
      id,
      startMs: new Date(sy, sm, 1).getTime(),
      endMs: endOfLocalDay(today.getTime()),
      multiMonth: true,
      label: null
    };
  }
  if (id === 'year') {
    return {
      id,
      startMs: new Date(y, 0, 1).getTime(),
      endMs: endOfLocalDay(today.getTime()),
      multiMonth: true,
      label: null
    };
  }
  return getActivityRangeBounds('this-month', now);
}

function entryInActivityRange(ts, bounds) {
  if (!bounds || bounds.id === 'all' || bounds.startMs == null) return true;
  return ts >= bounds.startMs && ts <= bounds.endMs;
}

function formatActivityRangePart(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatActivityRangeLabel(bounds) {
  if (!bounds) return '';
  if (bounds.label) return bounds.label;
  const start = new Date(bounds.startMs);
  const end = new Date(bounds.endMs);
  let startStr = formatActivityRangePart(start);
  const endStr = formatActivityRangePart(end);
  if (start.getFullYear() !== end.getFullYear()) {
    startStr += ', ' + start.getFullYear();
  }
  return startStr + ' \u2013 ' + endStr + ', ' + end.getFullYear();
}

function entryCountsAsSpending(e) {
  if (!e || typeof e.amount !== 'number') return false;
  if (e.isTransfer) return false;
  if (e.excluded) return false;
  if (e.countAsSpending === false) return false;
  return true;
}

function entrySpendingAmount(e) {
  return entryCountsAsSpending(e) ? e.amount : 0;
}

function inclusiveRangeDayCount(bounds, entriesForSpan) {
  if (!bounds) return 1;
  const end = new Date(bounds.endMs);
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  let startDay;
  if (bounds.startMs == null) {
    let minTs = null;
    (entriesForSpan || []).forEach((e) => {
      if (minTs === null || e.ts < minTs) minTs = e.ts;
    });
    if (minTs == null) startDay = endDay;
    else {
      const md = new Date(minTs);
      startDay = new Date(md.getFullYear(), md.getMonth(), md.getDate()).getTime();
    }
  } else {
    const sd = new Date(bounds.startMs);
    startDay = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate()).getTime();
  }
  return Math.max(1, Math.round((endDay - startDay) / MS_DAY) + 1);
}

function sumSpending(list) {
  return list.reduce((s, e) => s + entrySpendingAmount(e), 0);
}

function computeActivitySummary(displayItems, bounds) {
  let total = 0;
  let expenseCount = 0;
  let transferCount = 0;
  displayItems.forEach((it) => {
    if (it.kind === 'paired-transfer') {
      transferCount++;
      return;
    }
    if (it.entry && it.entry.isTransfer) transferCount++;
    else if (it.entry) {
      if (it.entry.excluded || it.entry.countAsSpending === false) return;
      expenseCount++;
      total += it.entry.amount;
    } else if (it.amount && !it.isTransfer) {
      expenseCount++;
      total += it.amount;
    }
  });
  const days = inclusiveRangeDayCount(bounds, displayItems.map((it) => (it.kind === 'entry' ? it.entry : { ts: it.ts, amount: it.amount })));
  return {
    total,
    expenseCount,
    transferCount,
    count: expenseCount + transferCount,
    avgPerDay: total / days,
    rangeLabel: formatActivityRangeLabel(bounds)
  };
}

function dayStart(y, m, d) {
  return new Date(y, m, d, 0, 0, 0, 0).getTime();
}

function tsLocal(y, m, d, h = 12) {
  return new Date(y, m, d, h, 0, 0, 0).getTime();
}

const nowOct16 = new Date(2026, 9, 16, 15, 0, 0, 0);

// --- Range boundaries ---
const thisMo = getActivityRangeBounds('this-month', nowOct16);
assert.strictEqual(thisMo.startMs, dayStart(2026, 9, 1));
assert.strictEqual(new Date(thisMo.endMs).getFullYear(), 2026);
assert.strictEqual(new Date(thisMo.endMs).getMonth(), 9);
assert.strictEqual(new Date(thisMo.endMs).getDate(), 16);
assert.strictEqual(new Date(thisMo.endMs).getHours(), 23);
assert.strictEqual(thisMo.multiMonth, false);

const lastJan = getActivityRangeBounds('last-month', new Date(2026, 0, 10));
assert.strictEqual(lastJan.startMs, dayStart(2025, 11, 1));
assert.strictEqual(new Date(lastJan.endMs).getMonth(), 11);
assert.strictEqual(new Date(lastJan.endMs).getDate(), 31);

const threeMo = getActivityRangeBounds('3-months', nowOct16);
assert.strictEqual(threeMo.startMs, dayStart(2026, 7, 1));
assert.strictEqual(threeMo.multiMonth, true);
assert.ok(formatActivityRangeLabel(threeMo).includes('Aug 1'));

const threeMoJan = getActivityRangeBounds('3-months', new Date(2026, 0, 16));
assert.strictEqual(threeMoJan.startMs, dayStart(2025, 10, 1));

const yr = getActivityRangeBounds('year', nowOct16);
assert.strictEqual(yr.startMs, dayStart(2026, 0, 1));
assert.strictEqual(yr.multiMonth, true);

const all = getActivityRangeBounds('all', nowOct16);
assert.strictEqual(all.startMs, null);
assert.strictEqual(all.label, 'All time');

// --- In-range filtering ---
const bounds = thisMo;
const inRange = [
  { ts: tsLocal(2026, 9, 1), amount: 10 },
  { ts: tsLocal(2026, 9, 16), amount: 5 },
  { ts: tsLocal(2026, 7, 31), amount: 99 }
].filter((e) => entryInActivityRange(e.ts, bounds));
assert.strictEqual(inRange.length, 2);

// --- Summary + transfer exclusion ---
const list = [
  { kind: 'entry', entry: { amount: 100, isTransfer: false }, ts: tsLocal(2026, 9, 1) },
  { kind: 'entry', entry: { amount: 50, isTransfer: true }, ts: tsLocal(2026, 9, 2) },
  { kind: 'entry', entry: { amount: 25, excluded: true }, ts: tsLocal(2026, 9, 3) },
  { kind: 'entry', entry: { amount: 10, countAsSpending: false }, ts: tsLocal(2026, 9, 4) }
];
const summary = computeActivitySummary(list, thisMo);
assert.strictEqual(summary.total, 100);
assert.strictEqual(summary.expenseCount, 1);
assert.strictEqual(summary.transferCount, 1);
assert.strictEqual(summary.count, 2);
assert.ok(Math.abs(summary.avgPerDay - 100 / 16) < 0.001);

const allEntries = [
  { kind: 'entry', entry: { ts: tsLocal(2026, 9, 1), amount: 30 }, ts: tsLocal(2026, 9, 1) },
  { kind: 'entry', entry: { ts: tsLocal(2026, 6, 15), amount: 20 }, ts: tsLocal(2026, 6, 15) }
];
const allBounds = getActivityRangeBounds('all', nowOct16);
const allSummary = computeActivitySummary(allEntries, allBounds);
assert.strictEqual(allSummary.total, 50);
assert.strictEqual(
  inclusiveRangeDayCount(allBounds, allEntries.map((it) => it.entry)),
  Math.round((dayStart(2026, 9, 16) - dayStart(2026, 6, 15)) / MS_DAY) + 1
);

console.log('activity-range-test: PASS');
