/**
 * Recap math tests (mirrors app.js computeRecapData / computeFunStat).
 * Run: node scripts/recap-test.mjs
 */
import assert from 'assert';

const categories = [
  { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' },
  { id: 'coffee', name: 'Coffee', emoji: '☕', color: '#fcc419' }
];

function isSameMonth(ts, y, m) {
  const d = new Date(ts);
  return d.getFullYear() === y && d.getMonth() === m;
}

function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function getCat(id) {
  return categories.find((c) => c.id === id) || { id, name: id, emoji: '📦', color: '#adb5bd' };
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

function computeFunStat(monthEntries) {
  const byNote = {};
  const byCatCount = {};
  monthEntries.forEach((e) => {
    const n = (e.note || '').trim().toLowerCase();
    if (n) byNote[n] = (byNote[n] || 0) + 1;
    byCatCount[e.categoryId] = (byCatCount[e.categoryId] || 0) + 1;
  });
  let bestNote = null;
  Object.keys(byNote).forEach((k) => {
    if (!bestNote || byNote[k] > bestNote.count) bestNote = { label: k, count: byNote[k] };
  });
  if (bestNote && bestNote.count >= 2) {
    return { type: 'note', text: `${bestNote.count}× "${bestNote.label}"` };
  }
  let topId = null;
  let topN = 0;
  Object.keys(byCatCount).forEach((id) => {
    if (byCatCount[id] > topN) { topN = byCatCount[id]; topId = id; }
  });
  if (topId && topN >= 2) {
    const c = getCat(topId);
    const purchaseWord = topN === 1 ? 'purchase' : 'purchases';
    return { type: 'category', text: `${topN} ${purchaseWord} in ${c.name}` };
  }
  return { type: 'entries', text: `${monthEntries.length} transactions logged` };
}

function computeRecapData(entries, budgets, y, m) {
  const data = getSummaryData(entries, y, m);
  let topCat = null;
  categories.forEach((c) => {
    const amt = data.byCat[c.id] || 0;
    if (amt > 0 && (!topCat || amt > topCat.amt)) topCat = { cat: c, amt };
  });
  let biggestDay = null;
  const byDay = {};
  data.entries.forEach((e) => {
    const k = startOfDay(e.ts);
    byDay[k] = (byDay[k] || 0) + e.amount;
  });
  Object.keys(byDay).forEach((k) => {
    const amt = byDay[k];
    if (!biggestDay || amt > biggestDay.amt) biggestDay = { ts: parseInt(k, 10), amt };
  });
  const budget = Object.values(budgets).reduce((s, v) => s + (v || 0), 0);
  const budgetDelta = budget > 0 ? budget - data.total : null;
  const fun = computeFunStat(data.entries);
  return { total: data.total, entryCount: data.entries.length, topCat, biggestDay, budget, budgetDelta, fun };
}

const y = 2026;
const m = 8; // September
const base = new Date(y, m, 15, 12, 0, 0).getTime();
const entries = [
  { id: '1', amount: 12, categoryId: 'coffee', note: 'latte', ts: new Date(y, m, 1).getTime() },
  { id: '2', amount: 8, categoryId: 'coffee', note: 'latte', ts: new Date(y, m, 3).getTime() },
  { id: '3', amount: 50, categoryId: 'groceries', note: 'shop', ts: new Date(y, m, 13).getTime() },
  { id: '4', amount: 40, categoryId: 'groceries', note: 'shop', ts: new Date(y, m, 13, 18).getTime() }
];
const budgets = { groceries: 200, coffee: 30 };

const recap = computeRecapData(entries, budgets, y, m);
assert.strictEqual(recap.total, 110);
assert.strictEqual(recap.entryCount, 4);
assert.strictEqual(recap.topCat.cat.id, 'groceries');
assert.strictEqual(recap.topCat.amt, 90);
assert.strictEqual(recap.biggestDay.amt, 90);
assert.strictEqual(recap.budgetDelta, 120);
assert.ok(recap.fun.text.includes('latte'));

const groOnly = [
  { id: 'g1', amount: 10, categoryId: 'groceries', note: 'a', ts: new Date(y, m, 2).getTime() },
  { id: 'g2', amount: 10, categoryId: 'groceries', note: 'b', ts: new Date(y, m, 4).getTime() },
  { id: 'g3', amount: 10, categoryId: 'groceries', note: 'c', ts: new Date(y, m, 6).getTime() },
  { id: 'g4', amount: 10, categoryId: 'groceries', note: 'd', ts: new Date(y, m, 8).getTime() }
];
const groFun = computeFunStat(groOnly);
assert.strictEqual(groFun.text, '4 purchases in Groceries');

const empty = computeRecapData([], {}, y, m);
assert.strictEqual(empty.entryCount, 0);
assert.strictEqual(empty.total, 0);

console.log('recap-test: PASS');
