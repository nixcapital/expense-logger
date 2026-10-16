/**
 * Reports chart aggregation + recurring grouping (mirrors app.js).
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

function getReportMonthSeries(entries, endY, endM, count) {
  const list = [];
  let y = endY;
  let m = endM;
  for (let i = 0; i < count; i++) {
    const data = getSummaryData(entries, y, m);
    list.unshift({
      y,
      m,
      key: reportMonthKey(y, m),
      total: data.total,
      byCat: data.byCat,
      entries: data.entries
    });
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return list;
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

const sep = new Date(2026, 8, 5).getTime();
const aug = new Date(2026, 7, 12).getTime();
const entries = [
  { id: '1', amount: 50, categoryId: 'groceries', ts: sep, note: 'TARGET.COM *' },
  { id: '2', amount: 30, categoryId: 'other', ts: sep + 86400000, note: 'target.com *' },
  { id: '3', amount: 100, categoryId: 'dining', ts: sep + 172800000, note: 'Cafe' },
  { id: '4', amount: 20, categoryId: 'groceries', ts: aug, note: 'TARGET.COM *' }
];

const series = getReportMonthSeries(entries, 2026, 8, 3);
assert.strictEqual(series.length, 3);
assert.strictEqual(series[2].key, '2026-09');
assert.strictEqual(series[2].total, 180);
assert.strictEqual(series[2].byCat.groceries, 50);
assert.strictEqual(series[2].byCat.other, 30);
assert.strictEqual(series[1].total, 20);
assert.strictEqual(series[0].total, 0);

const groups = groupRecurringEntries(getSummaryData(entries, 2026, 8, 1).entries);
assert.strictEqual(groups.length, 2, 'target merged + cafe');
assert.strictEqual(groups[0].count, 2, 'target appears twice');
assert.strictEqual(groups[0].total, 80);
assert.ok(groups[0].label.toLowerCase().includes('target'));

const solo = groupRecurringEntries([{ id: 'x', amount: 5, ts: sep, note: '' }]);
assert.strictEqual(solo.length, 1);
assert.strictEqual(solo[0].count, 1);

console.log('report-test: PASS');
