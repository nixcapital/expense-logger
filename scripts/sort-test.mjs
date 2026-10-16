/**
 * Activity sort order tests (mirrors app.js sortEntriesList + day grouping).
 * Run: node scripts/sort-test.mjs
 */
import assert from 'assert';

function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function sortEntriesList(list, sort) {
  const out = list.slice();
  if (sort === 'newest') out.sort((a, b) => b.ts - a.ts);
  else if (sort === 'oldest') out.sort((a, b) => a.ts - b.ts);
  else if (sort === 'highest') {
    out.sort((a, b) => (b.amount !== a.amount ? b.amount - a.amount : b.ts - a.ts));
  } else if (sort === 'lowest') {
    out.sort((a, b) => (a.amount !== b.amount ? a.amount - b.amount : b.ts - a.ts));
  }
  return out;
}

function groupByDay(list) {
  const groups = {};
  const order = [];
  list.forEach((e) => {
    const k = startOfDay(e.ts);
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(e);
  });
  return { order, groups };
}

const day1 = new Date(2026, 9, 15, 10).getTime();
const day1b = new Date(2026, 9, 15, 18).getTime();
const day2 = new Date(2026, 9, 14, 12).getTime();
const entries = [
  { id: 'a', amount: 10, ts: day2 },
  { id: 'b', amount: 50, ts: day1 },
  { id: 'c', amount: 5, ts: day1b },
  { id: 'd', amount: 100, ts: day1b - 3600000 }
];

const newest = sortEntriesList(entries, 'newest');
assert.strictEqual(newest[0].id, 'c', 'newest overall');
assert.strictEqual(newest[1].id, 'd', 'newest same-day second');
const ng = groupByDay(newest);
assert.ok(ng.order[0] === startOfDay(day1), 'newest day first');
assert.deepStrictEqual(ng.groups[ng.order[0]].map((e) => e.id), ['c', 'd', 'b'], 'newest within day preserved');

const oldest = sortEntriesList(entries, 'oldest');
assert.strictEqual(oldest[0].id, 'a');
const og = groupByDay(oldest);
assert.ok(og.order[0] === startOfDay(day2), 'oldest day first');
assert.deepStrictEqual(og.groups[og.order[1]].map((e) => e.id), ['b', 'd', 'c'], 'oldest within day');

const highest = sortEntriesList(entries, 'highest');
assert.strictEqual(highest[0].amount, 100);
assert.strictEqual(highest[1].amount, 50);
assert.strictEqual(highest[2].amount, 10);

const lowest = sortEntriesList(entries, 'lowest');
assert.strictEqual(lowest[0].amount, 5);
assert.strictEqual(lowest[lowest.length - 1].amount, 100);

console.log('sort-test: PASS');
