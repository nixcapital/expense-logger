/**
 * DST + owner-shaped forecast regression (TZ=America/New_York).
 * Run: TZ=America/New_York node scripts/forecast-dst-owner-test.mjs
 */
import { createRequire } from 'module';
import assert from 'assert';
import { performance } from 'perf_hooks';
import { ownerShapeDataset } from './owner-shape-dataset.mjs';

const require = createRequire(import.meta.url);
const FC = require('../forecast.js');
const CHECKING = 'acct-checking';

if (!/New_York|America/.test(process.env.TZ || '')) {
  console.warn('forecast-dst-owner-test: warning — run with TZ=America/New_York');
}

function localNoon(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

function assertConsecutiveFuturePoints(sim, nowMs, maxDays) {
  const future = sim.points.filter((p) => p.ts > nowMs).sort((a, b) => a.ts - b.ts);
  const keys = future.map((p) => FC.dayKey(p.ts));
  const uniq = new Set(keys);
  assert.strictEqual(uniq.size, keys.length, 'future day keys must be unique');
  for (let i = 1; i < future.length; i++) {
    const prev = future[i - 1].ts;
    const cur = future[i].ts;
    const step = FC.addDays(prev, 1);
    assert.strictEqual(cur, step, 'days must be consecutive calendar steps at ' + FC.dayKey(cur));
    if (i > maxDays) break;
  }
}

const data = ownerShapeDataset();
assert.strictEqual(data.stats.total, 1745);
assert.strictEqual(data.stats.checking, 245);
assert.strictEqual(data.stats.chase, 1499);
assert.strictEqual(data.stats.noAccount, 1);
assert.strictEqual(data.stats.incomeRows, 0);

const anchorDates = [
  { label: 'oct-16-2026', nowMs: localNoon(2026, 9, 16) },
  { label: 'oct-31-2026', nowMs: localNoon(2026, 9, 31) },
  { label: 'nov-1-2026', nowMs: localNoon(2026, 10, 1) },
  { label: 'mar-8-2027-spring', nowMs: localNoon(2027, 2, 8) }
];

for (const anchor of anchorDates) {
  const payload = {
    nowMs: anchor.nowMs,
    checkingId: CHECKING,
    chaseId: 'acct-chase',
    balance: data.balance.currentBalance,
    balanceAsOfMs: anchor.nowMs,
    entries: data.entries,
    transferPairs: data.transferPairs,
    recurringItems: [],
    overrides: {},
    chartDays: 60,
    maxLookaheadDays: 365,
    cushion: 600
  };
  const t0 = performance.now();
  const result = FC.runForecast(payload);
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, anchor.label + ' runForecast must finish <1s, took ' + ms);
  assert.ok(result && result.ok, anchor.label + ' forecast ok');
  const sim = FC.simulateBalanceTimeline({
    nowMs: anchor.nowMs,
    startingBalance: result.startingBalance,
    entries: data.entries,
    checkingId: CHECKING,
    chaseId: 'acct-chase',
    transferPairs: data.transferPairs,
    chartDays: 60,
    maxLookaheadDays: 365,
    cushion: 600
  });
  assert.ok(sim.ok, anchor.label + ' sim ok');
  assert.strictEqual(sim.partialTimeline, false, anchor.label + ' must not be partial');
  assertConsecutiveFuturePoints(sim, FC.startOfDay(anchor.nowMs), 90);
  console.log('forecast-dst-owner-test:', anchor.label, 'ms=' + Math.round(ms));
}

console.log('forecast-dst-owner-test: PASS');
