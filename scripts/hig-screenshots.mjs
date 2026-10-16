/**
 * HIG before/after screenshots: Settings + Forecast at 428×926 (not fullPage).
 * Run: node scripts/hig-screenshots.mjs [--tag=before|after]
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8898;
const ROOT = process.env.EL_ROOT || '/workspace';
const VIEWPORT = { width: 428, height: 926 };
const OUT_BASE = '/opt/cursor/artifacts/hig-176';
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

function server() {
  return createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = join(ROOT, p);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(readFileSync(file));
  });
}

function seed() {
  const accounts = [
    {
      id: 'acct-checking',
      name: 'Checking',
      type: 'bank',
      color: '#20C997',
      currentBalance: 2382.42,
      balanceAsOf: '2026-10-16',
      balanceHistory: { amount: 1904.1, asOf: '2026-10-02' }
    },
    { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
  ];
  const categories = [
    { id: 'income', name: 'Income', emoji: '💵', icon: 'circle-dot', color: '#34C77B' },
    { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
    { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
    { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
    { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }
  ];
  const entries = [];
  const push = (e) => entries.push(e);
  [[2026, 6, 1], [2026, 7, 1], [2026, 8, 1], [2026, 9, 1]].forEach(([y, m, d], i) => {
    push({
      id: 'rent-' + i,
      amount: 1650,
      categoryId: 'bills',
      note: 'Maple Court Apts',
      ts: ts(y, m, d),
      accountId: 'acct-checking'
    });
  });
  push({
    id: 'pay-1',
    amount: 2140,
    categoryId: 'income',
    note: 'Acme Corp payroll',
    ts: ts(2026, 9, 9),
    accountId: 'acct-checking',
    isDeposit: true
  });
  for (let i = 0; i < 12; i++) {
    push({
      id: 'sp-' + i,
      amount: 18 + i,
      categoryId: 'dining',
      note: 'Starbucks',
      ts: ts(2026, 9, 1 + i),
      accountId: 'acct-checking'
    });
  }
  return { accounts, entries, categories };
}

async function shot(page, dir, name) {
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name), fullPage: false });
}

async function run() {
  const tag = (process.argv.find((a) => a.startsWith('--tag=')) || '--tag=after').split('=')[1];
  const outDir = join(OUT_BASE, tag);
  mkdirSync(outDir, { recursive: true });

  const srv = server();
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });

  await page.addInitScript(() => {
    const t = new Date(2026, 9, 16, 14, 0, 0);
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(t.getTime());
        else super(...args);
      }
      static now() {
        return t.getTime();
      }
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
    localStorage.setItem('expenseLogger.meta.v1', JSON.stringify({ forecastCushion: 600 }));
    localStorage.setItem('expenseLogger.budgets.v1', '{}');
    localStorage.setItem('expenseLogger.recurring.v1', '[]');
    localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'settings' }));
  }, data);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    await page.click('.tab-btn[data-tab="settings"]');
    await page.waitForSelector('#tab-settings:not([hidden])');
    await page.waitForTimeout(300);
    await shot(page, outDir, `settings-${scheme}.png`);

    await page.click('.tab-btn[data-tab="summary"]');
    await page.waitForTimeout(250);
    const homeCard = page.locator('#homeForecastCard');
    if (await homeCard.isVisible()) {
      await homeCard.click();
    } else {
      await page.evaluate(() => {
        if (window.EL && window.EL.openForecast) window.EL.openForecast();
      });
    }
    await page.waitForSelector('#tab-forecast:not([hidden])');
    await page.waitForTimeout(400);
    await page.click('.forecast-range-btn[data-forecast-days="60"]');
    await page.waitForTimeout(300);
    await shot(page, outDir, `forecast-${scheme}.png`);
  }

  console.log('Saved to', outDir);
  await browser.close();
  srv.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
