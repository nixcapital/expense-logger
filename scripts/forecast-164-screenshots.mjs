/**
 * Forecast 1.6.4 screenshots (428×926) with fake fixture data.
 * Run: node scripts/forecast-164-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { buildForecastFixture164 } from './forecast-fixture-164.mjs';

const PORT = 8896;
const ROOT = '/workspace';
const OUT = '/cursor/stores/self/artifacts/forecast-164';
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

function seedStorage() {
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
    'expenseLogger.ui.v1': JSON.stringify({ currentTab: 'summary' })
  };
}

async function capture(page, name, scrollY) {
  if (scrollY != null) {
    await page.evaluate((y) => {
      const el = document.getElementById('tab-forecast');
      if (el) el.scrollTop = y;
    }, scrollY);
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: join(OUT, name), fullPage: false });
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const storage = seedStorage();
  const srv = server();
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      colorScheme: scheme,
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    await page.addInitScript((data) => {
      Object.keys(data).forEach((k) => localStorage.setItem(k, data[k]));
      localStorage.setItem('expenseLogger.lock.v1', JSON.stringify({ enabled: false }));
      const fixed = new Date(2026, 9, 16, 12, 0, 0).getTime();
      Date.now = function () { return fixed; };
    }, storage);
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#app:not([hidden])', { timeout: 15000 });
    await page.click('#homeForecastCard');
    await page.waitForSelector('#tab-forecast:not([hidden])');
    await page.waitForSelector('#forecastMain:not([hidden])');
    await page.waitForTimeout(400);
    await capture(page, `forecast-top-${scheme}.png`, 0);
    await capture(page, `forecast-upcoming-${scheme}.png`, 900);
    await context.close();
  }
  await browser.close();
  srv.close();
  console.log('Wrote screenshots to', OUT);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
