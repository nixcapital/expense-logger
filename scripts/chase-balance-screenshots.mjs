/**
 * Chase balance owed release screenshots — 428×926 viewport, DPR 2, SW blocked.
 * Run: node scripts/chase-balance-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { fixtureStoragePayload, FIXTURE_NOW } from './chase-balance-fixture.mjs';

const PORT = 8920;
const ROOT = '/workspace';
const OUT = '/opt/cursor/artifacts/chase-balance-180';
const VIEWPORT = { width: 428, height: 926 };

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

function installFixtureInitScript(context, payload) {
  return context.addInitScript((data) => {
    const RealDate = Date;
    function MockDate(...args) {
      if (args.length === 0) return new RealDate(data.mockNow);
      return new RealDate(...args);
    }
    MockDate.now = () => data.mockNow;
    MockDate.parse = RealDate.parse;
    MockDate.UTC = RealDate.UTC;
    window.Date = MockDate;
    localStorage.setItem('expenseLogger.accounts.v1', data.accounts);
    localStorage.setItem('expenseLogger.entries.v1', data.entries);
    localStorage.setItem('expenseLogger.transferPairs.v1', data.pairs);
  }, payload);
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name), fullPage: false });
}

async function openSettings(page) {
  await page.click('.tab-btn[data-tab="settings"]');
  await page.waitForTimeout(300);
}

async function waitBoot(page) {
  await page.waitForFunction(() => {
    const T = window.ExpenseLoggerTest;
    if (!T) return false;
    const snap = T.getCardBalanceSnapshot(Date.now());
    return snap && snap.ok && Math.abs(snap.owed - 1284.17) < 0.02;
  }, { timeout: 15000 });
}

async function openSetBalanceForScreenshot(page, amount) {
  await page.evaluate((amt) => {
    window.ExpenseLoggerTest.openChaseBalanceSheet();
    const inp = document.getElementById('chaseBalanceAmountInput');
    if (inp) {
      inp.value = amt;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const scrim = document.getElementById('chaseBalanceDiscardScrim');
    if (scrim) scrim.classList.remove('show');
  }, amount);
  await page.waitForSelector('#chaseBalanceSheet.show');
  await page.waitForTimeout(400);
}

mkdirSync(OUT, { recursive: true });
const payload = fixtureStoragePayload();
const srv = server();
await new Promise((r) => srv.listen(PORT, r));

for (const scheme of ['light', 'dark']) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: scheme,
    serviceWorkers: 'block'
  });
  await installFixtureInitScript(context, payload);
  const page = await context.newPage();

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await waitBoot(page);

  await openSettings(page);
  await shot(page, `1-settings-${scheme}.png`);

  await page.evaluate(() => window.ExpenseLoggerTest.openChaseCardSheet());
  await page.waitForSelector('#chaseCardSheet.show');
  await page.waitForTimeout(400);
  await shot(page, `2-card-sheet-${scheme}.png`);
  await page.evaluate(() => window.ExpenseLoggerTest.closeChaseCardSheet());

  await openSetBalanceForScreenshot(page, '1,309.42');
  await shot(page, `3-set-balance-${scheme}.png`);
  await page.evaluate(() => window.ExpenseLoggerTest.closeChaseBalanceSheet());

  await page.evaluate(() => window.ExpenseLoggerTest.openForecastScreen());
  await page.waitForSelector('#tab-forecast:not([hidden])');
  await page.waitForFunction(() => {
    const el = document.getElementById('forecastBreakdownTotal');
    return el && /1,284/.test(el.textContent || '');
  }, { timeout: 15000 });
  await page.evaluate(() => {
    const scrollEl = document.getElementById('tab-forecast');
    const titles = Array.from(document.querySelectorAll('#forecastUpcomingList .forecast-up-title'));
    const chase = titles.find((t) => /chase card payment/i.test(t.textContent || ''));
    if (!chase || !scrollEl) return;
    const row = chase.closest('.forecast-up-row');
    if (!row) return;
    const rowTop = row.getBoundingClientRect().top + scrollEl.scrollTop;
    scrollEl.scrollTop = Math.max(0, rowTop - 100);
  });
  await page.waitForTimeout(500);
  await shot(page, `4-forecast-${scheme}.png`);

  await browser.close();
}

const browserDiscard = await chromium.launch();
const ctxDiscard = await browserDiscard.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  colorScheme: 'light',
  serviceWorkers: 'block'
});
await installFixtureInitScript(ctxDiscard, payload);
const pageDiscard = await ctxDiscard.newPage();
await pageDiscard.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await waitBoot(pageDiscard);
await openSetBalanceForScreenshot(pageDiscard, '1,309.42');
await pageDiscard.evaluate(() => {
  const scrim = document.getElementById('chaseBalanceDiscardScrim');
  if (scrim) {
    scrim.classList.add('show');
    scrim.setAttribute('aria-hidden', 'false');
  }
});
await pageDiscard.waitForTimeout(300);
await shot(pageDiscard, '3-set-balance-discard-prompt-light.png');
await browserDiscard.close();

const browserSafe = await chromium.launch();
const ctxSafe = await browserSafe.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  colorScheme: 'light',
  serviceWorkers: 'block'
});
await installFixtureInitScript(ctxSafe, payload);
const pageSafe = await ctxSafe.newPage();
await pageSafe.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await waitBoot(pageSafe);
await openSettings(pageSafe);
await pageSafe.evaluate(() => window.ExpenseLoggerTest.openChaseCardSheet());
await pageSafe.waitForSelector('#chaseCardSheet.show');
await pageSafe.evaluate(() => {
  const sheet = document.getElementById('chaseCardSheet');
  if (sheet) {
    sheet.style.boxSizing = 'border-box';
    sheet.style.paddingTop = '47px';
    sheet.style.paddingBottom = '34px';
  }
  const topInset = document.createElement('div');
  topInset.setAttribute('data-qa', 'safe-area-top');
  topInset.style.cssText =
    'position:fixed;top:0;left:0;right:0;height:47px;background:rgba(0,0,0,0.08);z-index:10000;pointer-events:none;';
  const homeBar = document.createElement('div');
  homeBar.setAttribute('data-qa', 'safe-area-home');
  homeBar.style.cssText =
    'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);width:134px;height:5px;border-radius:3px;background:rgba(0,0,0,0.35);z-index:10000;pointer-events:none;';
  document.body.appendChild(topInset);
  document.body.appendChild(homeBar);
});
await pageSafe.waitForTimeout(400);
await shot(pageSafe, '2-card-sheet-safe-area-light.png');
await browserSafe.close();

srv.close();
console.log('chase-balance-screenshots: wrote to', OUT);
