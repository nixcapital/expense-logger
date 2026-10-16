/**
 * Browser check: forecast Y-axis cushion label does not collide with ticks (light/dark, 30/60/90d).
 * Run: node scripts/forecast-chart-axis-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

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

async function run() {
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

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  const data = seed();
  await page.evaluate((d) => {
    localStorage.clear();
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(d.categories));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(d.entries));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify(d.accounts));
    localStorage.setItem('expenseLogger.transferPairs.v1', '[]');
    localStorage.setItem('expenseLogger.transferPatterns.v1', '[]');
    localStorage.setItem('expenseLogger.meta.v1', JSON.stringify({ forecastCushion: 600 }));
    localStorage.setItem('expenseLogger.forecastOverrides.v1', '{}');
  }, data);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#homeForecastCard');
  await page.waitForSelector('#tab-forecast:not([hidden])');
  await page.waitForTimeout(400);

  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    for (const days of [30, 60, 90]) {
      await page.click('.forecast-range-btn[data-forecast-days="' + days + '"]');
      await page.waitForTimeout(350);
      const dbg = await page.evaluate(() => window.__forecastChartAxisDebug);
      if (!dbg) throw new Error('missing axis debug for ' + scheme + ' ' + days + 'd');
      if (dbg.collides) {
        throw new Error('Y-axis collision ' + scheme + ' ' + days + 'd: ' + JSON.stringify(dbg.plan));
      }
      if (dbg.cushionNear && dbg.plan.labels.some((l) => l.bal === 500)) {
        throw new Error('500 tick should be hidden when cushion is 600 (' + scheme + ' ' + days + 'd)');
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
