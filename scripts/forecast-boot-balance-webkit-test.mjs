/**
 * WebKit: balance seeded before boot; splash clears; save balance persists.
 * Run: node scripts/forecast-boot-balance-webkit-test.mjs
 */
import assert from 'assert';
import { webkit, devices } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { ownerShapeDataset } from './owner-shape-dataset.mjs';

const PORT = 8912;
const ROOT = '/workspace';
const VIEWPORT = { width: 428, height: 926 };
const OUT = '/cursor/stores/self/artifacts/hotfix-163';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

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

async function run() {
  mkdirSync(OUT, { recursive: true });
  const data = ownerShapeDataset();
  const seedBalance = 500;
  const seedAsOf = '2026-10-16';
  const accounts = data.accounts.map((a) => ({
    ...a,
    currentBalance: a.type === 'bank' ? seedBalance : a.currentBalance,
    balanceAsOf: a.type === 'bank' ? seedAsOf : a.balanceAsOf
  }));

  const srv = server();
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await webkit.launch();
  const context = await browser.newContext({
    ...devices['iPhone 13 Pro Max'],
    viewport: VIEWPORT,
    hasTouch: true,
    isMobile: true,
    timezoneId: 'America/New_York'
  });

  await context.addInitScript((seed) => {
    localStorage.clear();
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' },
      { id: 'transfer', name: 'Transfer', icon: 'boxes', color: '#878e96' }
    ]));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify(seed.accounts));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(seed.entries));
    localStorage.setItem('expenseLogger.transferPairs.v1', JSON.stringify(seed.transferPairs));
    localStorage.setItem('expenseLogger.budgets.v1', '{}');
    localStorage.setItem('expenseLogger.recurring.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.forecastOverrides.v1', '{}');
    localStorage.setItem('expenseLogger.meta.v1', JSON.stringify({ forecastCushion: 600 }));
    localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'summary' }));
  }, { accounts, entries: data.entries, transferPairs: data.transferPairs });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

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
  await page.waitForFunction(() => window.__elBootCompleted === true, { timeout: 20000 });

  const splashHidden = await page.evaluate(() => {
    const s = document.getElementById('splashScreen');
    return s && (s.classList.contains('hide') || s.style.display === 'none');
  });
  assert.ok(splashHidden, 'splash should be hidden after boot');

  await page.evaluate(() => {
    const lock = document.getElementById('lockScreen');
    const app = document.getElementById('app');
    if (lock) lock.hidden = true;
    if (app) app.hidden = false;
  });

  await page.waitForSelector('#homeForecastCard:not([hidden])', { timeout: 15000 });

  const beforeHome = await page.evaluate(() => ({
    balance: document.getElementById('homeForecastBalanceVal')?.textContent || '',
    date: document.getElementById('homeForecastDate')?.textContent || ''
  }));
  assert.ok(beforeHome.balance.includes('500.00'), 'home card should reflect seeded balance before save: ' + beforeHome.balance);

  await page.click('[data-tab="settings"]');
  await page.click('[data-balance-acct="acct-checking"]');
  await page.waitForSelector('#balanceSheet.show');
  await page.locator('#balanceAmountInput').tap();
  await page.fill('#balanceAmountInput', '1234.56');
  await page.locator('#balanceSaveBtn').tap();
  await page.waitForTimeout(800);

  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem('expenseLogger.accounts.v1');
    const parsed = JSON.parse(raw);
    const row = parsed.find((a) => a.id === 'acct-checking');
    return {
      balance: row && row.currentBalance,
      toast: document.getElementById('toast').textContent,
      sheetOpen: document.getElementById('balanceSheet').classList.contains('show')
    };
  });
  assert.strictEqual(saved.balance, 1234.56);
  assert.ok(saved.toast.includes('Balance saved'));
  assert.strictEqual(saved.sheetOpen, false);

  await page.click('[data-tab="summary"]');
  await page.waitForSelector('#homeForecastCard:not([hidden])');

  const afterHome = await page.evaluate(() => ({
    balance: document.getElementById('homeForecastBalanceVal')?.textContent || '',
    date: document.getElementById('homeForecastDate')?.textContent || ''
  }));
  assert.ok(afterHome.balance.includes('1,234.56'), 'home card must show saved balance: ' + afterHome.balance);
  assert.notStrictEqual(afterHome.date, beforeHome.date, 'money-lasts date must update after balance save');
  assert.notStrictEqual(afterHome.balance, beforeHome.balance, 'home balance must change after save');

  await page.screenshot({ path: join(OUT, 'home-forecast-after-balance-save.png') });

  assert.strictEqual(errors.length, 0, errors.join('; '));
  console.log('forecast-boot-balance-webkit-test: PASS');

  await browser.close();
  srv.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
