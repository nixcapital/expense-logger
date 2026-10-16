/**
 * Forecast 1.6.5 v2 QA screenshots (428×926) with fake fixtures.
 * Run: node scripts/forecast-165-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { buildForecastFixture164 } from './forecast-fixture-164.mjs';
import { buildForecastFixture165Income } from './forecast-fixture-165-income.mjs';

const PORT = 8897;
const ROOT = '/workspace';
const OUT_DIRS = ['/opt/cursor/artifacts/forecast-v2', '/cursor/stores/self/artifacts/forecast-v2'];
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};
const VIEWPORT = { width: 428, height: 926 };

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

function seedStorage(opts) {
  opts = opts || {};
  const fx = opts.income90 ? buildForecastFixture165Income() : buildForecastFixture164({ withIncome: false, balance: 3560 });
  const accounts = [
    {
      id: fx.checkingId, name: 'Checking', type: 'bank', color: '#20C997',
      currentBalance: fx.balance, balanceAsOf: '2026-10-16'
    },
    { id: fx.chaseId, name: 'Chase card', type: 'credit_card', color: '#748FFC' }
  ];
  const categories = [
    { id: 'income', name: 'Income', icon: 'circle-dot', color: '#34C77B' },
    { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
    { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
    { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
    { id: 'transfer', name: 'Transfer', icon: 'boxes', color: '#878e96' },
    { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }
  ];
  return {
    'expenseLogger.accounts.v1': JSON.stringify(accounts),
    'expenseLogger.categories.v1': JSON.stringify(categories),
    'expenseLogger.entries.v1': JSON.stringify(fx.entries),
    'expenseLogger.transferPairs.v1': JSON.stringify(fx.transferPairs),
    'expenseLogger.meta.v1': JSON.stringify({ forecastCushion: 600, onboarded: true }),
    'expenseLogger.ui.v1': JSON.stringify({ currentTab: 'summary' }),
    'expenseLogger.forecastCountedOneOffs.v1': JSON.stringify({})
  };
}

async function openForecast(page) {
  await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const splash = document.getElementById('splashScreen');
    if (splash) splash.classList.add('is-dismissed');
    const EL = window.ExpenseLoggerTest;
    if (EL && EL.openForecastScreen) EL.openForecastScreen();
  });
  await page.waitForFunction(() => {
    const m = document.getElementById('forecastMain');
    return m && m.hidden === false;
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
}

async function capture(page, outDir, name, scrollY) {
  if (scrollY != null) {
    await page.evaluate((y) => {
      const el = document.getElementById('tab-forecast');
      if (el) el.scrollTop = y;
    }, scrollY);
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: join(outDir, name), fullPage: false });
}

async function run() {
  OUT_DIRS.forEach((d) => mkdirSync(d, { recursive: true }));
  const srv = server();
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await chromium.launch();

  const baseCtx = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: 'light',
    isMobile: true,
    hasTouch: true
  });
  const page = await baseCtx.newPage();
  await page.addInitScript((data) => {
    Object.keys(data).forEach((k) => localStorage.setItem(k, data[k]));
    localStorage.setItem('expenseLogger.lock.v1', JSON.stringify({ enabled: false }));
    Date.now = function () { return new Date(2026, 9, 16, 12, 0, 0).getTime(); };
  }, seedStorage({}));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await openForecast(page);
  for (const outDir of OUT_DIRS) {
    await capture(page, outDir, '1-top-light.png', 0);
    await capture(page, outDir, '3-upcoming.png', 1100);
    await page.click('[data-forecast-detail="bills"]');
    await page.waitForSelector('#forecastDetailSheet.show');
    await page.waitForTimeout(300);
    await capture(page, outDir, '4-bills-sheet.png', 0);
    await page.click('#forecastDetailDoneBtn');
    await page.waitForTimeout(200);
  }
  await baseCtx.close();

  const incomeCtx = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: 'light',
    isMobile: true,
    hasTouch: true
  });
  const incomePage = await incomeCtx.newPage();
  await incomePage.addInitScript((data) => {
    Object.keys(data).forEach((k) => localStorage.setItem(k, data[k]));
    localStorage.setItem('expenseLogger.lock.v1', JSON.stringify({ enabled: false }));
    Date.now = function () { return new Date(2026, 9, 16, 12, 0, 0).getTime(); };
  }, seedStorage({ income90: true }));
  await incomePage.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await openForecast(incomePage);
  await incomePage.click('.forecast-range-btn[data-forecast-days="90"]');
  await incomePage.waitForFunction(() => {
    const rows = document.querySelectorAll('.forecast-bd-row');
    for (let i = 0; i < rows.length; i++) {
      if (/paycheck/i.test(rows[i].textContent)) return true;
    }
    return false;
  }, { timeout: 15000 });
  await incomePage.waitForTimeout(300);
  for (const outDir of OUT_DIRS) {
    await capture(incomePage, outDir, '5-with-income.png', 0);
  }
  await incomeCtx.close();

  await browser.close();
  srv.close();
  console.log('Wrote forecast v2 screenshots to', OUT_DIRS.join(', '));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
