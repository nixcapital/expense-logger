/**
 * Reports chart window, aggregation, recurring grouping, tap debounce (mirrors app.js).
 * Run: node scripts/report-test.mjs
 */
import assert from 'assert';

const categories = [
  { id: 'groceries', name: 'Groceries', color: '#4dabf7' },
  { id: 'dining', name: 'Dining', color: '#ff922b' },
  { id: 'other', name: 'Other', color: '#adb5bd' }
];

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function isSameMonth(ts, y, m) {
  const d = new Date(ts);
  return d.getFullYear() === y && d.getMonth() === m;
}

function normText(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanImportNote(raw) {
  let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+\d{8,}\s*$/g, '').trim();
  s = s.replace(/\s+WEB\s+\d+\s*$/i, '').trim();
  return s.slice(0, 80);
}

function descriptionMatchKey(note) {
  let s = normText(cleanImportNote(note));
  s = s.replace(/\b\d{6,}\b/g, '#');
  return s;
}

function getSummaryData(entries, y, m) {
  const monthEntries = entries.filter((e) => isSameMonth(e.ts, y, m));
  let total = 0;
  const byCat = {};
  categories.forEach((c) => { byCat[c.id] = 0; });
  monthEntries.forEach((e) => {
    total += e.amount;
    byCat[e.categoryId] = (byCat[e.categoryId] || 0) + e.amount;
  });
  return { entries: monthEntries, total, byCat };
}

function reportMonthKey(y, m) {
  return y + '-' + pad2(m + 1);
}

function ymToIndex(y, m) {
  return y * 12 + m;
}

function indexToYm(idx) {
  let y = Math.floor(idx / 12);
  let m = idx - y * 12;
  if (m < 0) { m += 12; y -= 1; }
  return { y, m };
}

function compareYM(y1, m1, y2, m2) {
  return ymToIndex(y1, m1) - ymToIndex(y2, m2);
}

function earliestMonthWithData(entries) {
  let minIdx = null;
  entries.forEach((e) => {
    const d = new Date(e.ts);
    const idx = ymToIndex(d.getFullYear(), d.getMonth());
    if (minIdx === null || idx < minIdx) minIdx = idx;
  });
  return minIdx === null ? null : indexToYm(minIdx);
}

function computeReportChartWindow(selY, selM, count, now, entries) {
  const curY = now.getFullYear();
  const curM = now.getMonth();
  if (compareYM(selY, selM, curY, curM) > 0) {
    selY = curY;
    selM = curM;
  }
  const before = count === 6 ? 3 : 6;
  const after = count === 6 ? 2 : 5;
  const selIdx = ymToIndex(selY, selM);
  const curIdx = ymToIndex(curY, curM);
  const monthsAfterSel = curIdx - selIdx;
  let startIdx;
  let endIdx;

  if (monthsAfterSel <= after) {
    endIdx = curIdx;
    startIdx = endIdx - (count - 1);
  } else {
    startIdx = selIdx - before;
    endIdx = selIdx + after;
    if (endIdx > curIdx) {
      endIdx = curIdx;
      startIdx = endIdx - (count - 1);
    }
  }

  const earliest = earliestMonthWithData(entries);
  if (earliest) {
    const minStart = ymToIndex(earliest.y, earliest.m) - 2;
    if (startIdx < minStart) startIdx = minStart;
    endIdx = startIdx + (count - 1);
    if (endIdx > curIdx) {
      endIdx = curIdx;
      startIdx = endIdx - (count - 1);
    }
  }

  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push(indexToYm(startIdx + i));
  }
  return slots;
}

function buildReportMonthSeries(entries, selY, selM, count, now) {
  return computeReportChartWindow(selY, selM, count, now, entries).map((slot) => {
    const data = getSummaryData(entries, slot.y, slot.m);
    return {
      y: slot.y,
      m: slot.m,
      key: reportMonthKey(slot.y, slot.m),
      total: data.total,
      byCat: data.byCat,
      entries: data.entries
    };
  });
}

function applyReportChartMonthPick(state, monthKey, currentValue, now) {
  if (now < state.lockUntil) return { applied: false, state, value: currentValue };
  if (monthKey === state.lastKey && now - state.lastAt < 450) {
    return { applied: false, state, value: currentValue };
  }
  if (monthKey === currentValue) return { applied: false, state, value: currentValue };
  return {
    applied: true,
    value: monthKey,
    state: {
      lockUntil: now + 450,
      lastKey: monthKey,
      lastAt: now,
      picks: (state.picks || 0) + 1
    }
  };
}

function recurringGroupLabel(g) {
  let best = null;
  Object.keys(g.labels).forEach((k) => {
    if (!best || g.labels[k] > best.count) best = { text: k, count: g.labels[k] };
  });
  if (best) return best.text;
  return g.entries.length ? (g.entries[0].note || '').trim() : 'Purchase';
}

function groupRecurringEntries(list) {
  const groups = {};
  const order = [];
  list.forEach((e) => {
    let key = descriptionMatchKey(e.note || '');
    if (!key) key = '__solo:' + (e.id || e.ts);
    if (!groups[key]) {
      groups[key] = { key, labels: {}, entries: [], total: 0 };
      order.push(key);
    }
    const raw = (e.note || '').trim();
    if (raw) groups[key].labels[raw] = (groups[key].labels[raw] || 0) + 1;
    groups[key].entries.push(e);
    groups[key].total += e.amount;
  });
  return order.map((k) => {
    const g = groups[k];
    g.count = g.entries.length;
    g.label = recurringGroupLabel(g);
    return g;
  }).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.total - a.total;
  });
}

function splitRecurringGroups(groups) {
  const multi = groups.filter((g) => g.count >= 2);
  const oneTime = groups.filter((g) => g.count < 2);
  return { multi, oneTime };
}

function keys(slots) {
  return slots.map((s) => reportMonthKey(s.y, s.m));
}

const nowOct2026 = new Date(2026, 9, 15);

const sep = new Date(2026, 8, 5).getTime();
const aug = new Date(2026, 7, 12).getTime();
const entries = [
  { id: '1', amount: 50, categoryId: 'groceries', ts: sep, note: 'TARGET.COM *' },
  { id: '2', amount: 30, categoryId: 'other', ts: sep + 86400000, note: 'target.com *' },
  { id: '3', amount: 100, categoryId: 'dining', ts: sep + 172800000, note: 'Cafe' },
  { id: '4', amount: 20, categoryId: 'groceries', ts: aug, note: 'TARGET.COM *' }
];

const series3 = buildReportMonthSeries(entries, 2026, 8, 3, new Date(2026, 9, 1));
assert.strictEqual(series3.length, 3);
assert.deepStrictEqual(keys(series3), ['2026-08', '2026-09', '2026-10']);
assert.strictEqual(series3[1].total, 180);

const octSix = buildReportMonthSeries(entries, 2026, 9, 6, nowOct2026);
assert.deepStrictEqual(keys(octSix), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
assert.strictEqual(octSix[octSix.length - 1].key, '2026-10');

const entriesWithHistory = entries.concat([
  { id: '5', amount: 1, categoryId: 'other', ts: new Date(2026, 1, 10).getTime(), note: 'early' }
]);
const maySix = buildReportMonthSeries(entriesWithHistory, 2026, 4, 6, nowOct2026);
assert.deepStrictEqual(keys(maySix), ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
assert.strictEqual(maySix[3].key, '2026-05');

const entriesDeep = entriesWithHistory.concat([
  { id: '6', amount: 1, categoryId: 'other', ts: new Date(2025, 0, 3).getTime(), note: 'jan25' }
]);
const mayTwelve = buildReportMonthSeries(entriesDeep, 2026, 4, 12, nowOct2026);
assert.strictEqual(mayTwelve.length, 12);
assert.strictEqual(mayTwelve[mayTwelve.length - 1].key, '2026-10');
assert.strictEqual(mayTwelve[6].key, '2026-05');

const recentOnly = [
  { id: 'a', amount: 10, categoryId: 'other', ts: new Date(2026, 8, 2).getTime(), note: 'x' },
  { id: 'b', amount: 12, categoryId: 'other', ts: new Date(2026, 9, 2).getTime(), note: 'y' }
];
const recentOct = buildReportMonthSeries(recentOnly, 2026, 9, 6, nowOct2026);
assert.strictEqual(recentOct[recentOct.length - 1].key, '2026-10');
assert.ok(recentOct[0].total === 0 || recentOct[0].key >= '2026-07');

let pickState = { lockUntil: 0, lastKey: '', lastAt: 0, picks: 0 };
let monthVal = '2026-10';
const p1 = applyReportChartMonthPick(pickState, '2026-05', monthVal, 1000);
assert.strictEqual(p1.applied, true);
monthVal = p1.value;
pickState = p1.state;
const p2 = applyReportChartMonthPick(pickState, '2026-05', monthVal, 1100);
assert.strictEqual(p2.applied, false);
const p3 = applyReportChartMonthPick(pickState, '2026-12', monthVal, 2000);
assert.strictEqual(p3.applied, true);
assert.strictEqual(p3.value, '2026-12');

const groups = groupRecurringEntries(getSummaryData(entries, 2026, 8, 1).entries);
assert.strictEqual(groups.length, 2);
const split = splitRecurringGroups(groups);
assert.strictEqual(split.multi.length, 1);
assert.strictEqual(split.oneTime.length, 1);

console.log('report-test: PASS');
