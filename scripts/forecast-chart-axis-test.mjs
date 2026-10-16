/**
 * Forecast Y-axis label spacing (light/dark, 30/60/90d, large negative ranges).
 * Run: node scripts/forecast-chart-axis-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { createRequire } from 'module';
import { buildForecastFixture164 } from './forecast-fixture-164.mjs';

const require = createRequire(import.meta.url);
const FC = require('../forecast.js');

const PORT = 8896;
const ROOT = '/workspace';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

function server() {
  return createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p);
    if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
}

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

function assertAxisPlan(dataMin, dataMax, label) {
  const scale = FC.computeForecastChartYScale(dataMin, dataMax, { cushion: 600 });
  const plan = FC.planForecastChartYAxisLabels({
    minBal: scale.minBal,
    maxBal: scale.maxBal,
    step: scale.step,
    cushion: 600,
    cushionNear: scale.cushionNear,
    crossesZero: scale.crossesZero,
    padT: 12,
    innerH: 162,
    baselineNudge: 4
  });
  if (plan.labels.length > 6) {
    throw new Error(label + ': too many labels ' + plan.labels.length);
  }
  if (FC.yAxisLabelsCollide(plan)) {
    throw new Error(label + ': labels collide ' + JSON.stringify(plan.labels));
  }
  if (dataMin < 0 && dataMax > 0 && !plan.labels.some((l) => l.bal === 0)) {
    throw new Error(label + ': missing zero tick');
  }
}

function seed() {
  const accounts = [
    {
      id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997',
      currentBalance: 2382.42, balanceAsOf: '2026-10-16'
    },
    { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
  ];
  const categories = [
    { id: 'income', name: 'Income', emoji: '💵', icon: 'circle-dot', color: '#34C77B' },
    { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
    { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' }
  ];
  const entries = [];
  const push = (e) => entries.push(e);
  [ts(2026, 5, 6), ts(2026, 6, 3), ts(2026, 7, 14), ts(2026, 8, 11), ts(2026, 9, 9)].forEach((t, i) => {
    push({ id: 'p' + i, amount: 2140, categoryId: 'income', note: 'Acme Corp payroll', ts: t, accountId: 'acct-checking', isDeposit: true });
  });
  [[2026, 6, 1], [2026, 7, 1], [2026, 8, 1], [2026, 9, 1]].forEach(([y, m, d], i) => {
    push({ id: 'r' + i, amount: 1650, categoryId: 'bills', note: 'Maple Court Apts', ts: ts(y, m, d), accountId: 'acct-checking' });
  });
  [ts(2026, 5, 22), ts(2026, 6, 22), ts(2026, 7, 22), ts(2026, 8, 22)].forEach((t, i) => {
    push({ id: 'd' + i, amount: 142.4, categoryId: 'bills', note: 'Duke Energy', ts: t, accountId: 'acct-checking' });
  });
  for (let i = 0; i < 14; i++) {
    push({ id: 'c' + i, amount: 8 + i, categoryId: 'dining', note: 'Starbucks', ts: ts(2026, 9, 15) - i * 86400000, accountId: 'acct-checking' });
  }
  return { accounts, entries, transferPairs: [], transferPatterns: [], categories };
}

function seedLargeRange() {
  const fx = buildForecastFixture164();
  const accounts = [
    {
      id: fx.checkingId, name: 'Checking', type: 'bank', color: '#20C997',
      currentBalance: fx.balance, balanceAsOf: '2026-10-16'
    },
    { id: fx.chaseId, name: 'Chase card', type: 'credit_card', color: '#748FFC' }
  ];
  const categories = [
    { id: 'income', name: 'Income', icon: 'circle-dot', color: '#34C77B' },
    { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
    { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
    { id: 'transfer', name: 'Transfer', icon: 'boxes', color: '#878e96' }
  ];
  return {
    accounts,
    entries: fx.entries,
    transferPairs: fx.transferPairs,
    transferPatterns: [],
    categories,
    meta: { forecastCushion: 600, onboarded: true }
  };
}

async function assertBrowserAxis(page, label) {
  const dbg = await page.evaluate(() => window.__forecastChartAxisDebug);
  if (!dbg) throw new Error('missing axis debug for ' + label);
  if (dbg.collides) {
    throw new Error('Y-axis collision ' + label + ': ' + JSON.stringify(dbg.plan.labels));
  }
  if (dbg.plan.labels.length > 6) {
    throw new Error('too many labels ' + label + ': ' + dbg.plan.labels.length);
  }
}

async function run() {
  console.log('forecast-chart-axis-test: pure large ranges');
  assertAxisPlan(-10000, 9000, '9k-to--10k');
  assertAxisPlan(-34000, 3500, '3.5k-to--34k');

  const srv = server();
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });

  await page.addInitScript(() => {
    const t = new Date(2026, 9, 16, 14, 0, 0);
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(t.getTime());
        else super(...args);
      }
      static now() { return t.getTime(); }
    }
    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    window.Date = MockDate;
  });

  async function bootWithData(data) {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate((d) => {
      localStorage.clear();
      localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(d.categories));
      localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(d.entries));
      localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify(d.accounts));
      localStorage.setItem('expenseLogger.transferPairs.v1', JSON.stringify(d.transferPairs || []));
      localStorage.setItem('expenseLogger.transferPatterns.v1', JSON.stringify(d.transferPatterns || []));
      localStorage.setItem('expenseLogger.meta.v1', JSON.stringify(d.meta || { forecastCushion: 600 }));
      localStorage.setItem('expenseLogger.forecastOverrides.v1', '{}');
    }, data);
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('#homeForecastCard');
    await page.waitForSelector('#tab-forecast:not([hidden])');
    await page.waitForTimeout(400);
  }

  for (const [name, seedFn] of [['standard', seed], ['large-range', seedLargeRange]]) {
    await bootWithData(seedFn());
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(150);
      for (const days of [30, 60, 90]) {
        await page.click('.forecast-range-btn[data-forecast-days="' + days + '"]');
        await page.waitForTimeout(350);
        await assertBrowserAxis(page, name + ' ' + scheme + ' ' + days + 'd');
      }
    }
  }

  console.log('forecast-chart-axis-test: PASS');
  await browser.close();
  srv.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
