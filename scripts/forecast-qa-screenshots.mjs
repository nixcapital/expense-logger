/**
 * QA screenshots for 1.6.0 forecast (428x926). Fake data only.
 * Run: node scripts/forecast-qa-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8895;
const ROOT = '/workspace';
const OUT = '/opt/cursor/artifacts';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};
const MODAL_MS = 400;

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
      currentBalance: 2378.42, balanceAsOf: '2026-10-16',
      balanceHistory: { amount: 1904.1, asOf: '2026-10-02' }
    },
    { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
  ];
  const entries = [
    { id: 'e-duke', amount: 142.4, categoryId: 'bills', note: 'Duke Energy', ts: ts(2026, 8, 22), accountId: 'acct-checking' },
    { id: 'e-duke2', amount: 142.4, categoryId: 'bills', note: 'Duke Energy', ts: ts(2026, 9, 22), accountId: 'acct-checking' },
    { id: 'e-pay', amount: 2140, categoryId: 'other', note: 'Acme Corp payroll', ts: ts(2026, 9, 30), accountId: 'acct-checking', isDeposit: true },
    { id: 'e-pay2', amount: 2140, categoryId: 'other', note: 'Acme Corp payroll', ts: ts(2026, 8, 30), accountId: 'acct-checking', isDeposit: true },
    { id: 'e-pay3', amount: 2140, categoryId: 'other', note: 'Acme Corp payroll', ts: ts(2026, 7, 30), accountId: 'acct-checking', isDeposit: true },
    { id: 'e-xfer', amount: 200, categoryId: 'other', note: 'Transfer to savings', ts: ts(2026, 9, 30), accountId: 'acct-checking', isTransfer: true, transferKind: 'other', bankText: 'ONLINE TRANSFER TO SAV ...4821' },
    { id: 'e-rent', amount: 1650, categoryId: 'bills', note: 'Maple Court Apts', ts: ts(2026, 10, 1), accountId: 'acct-checking' },
    { id: 'e-rent2', amount: 1650, categoryId: 'bills', note: 'Maple Court Apts', ts: ts(2026, 9, 1), accountId: 'acct-checking' },
    { id: 'e-chase-b', amount: 1566.75, categoryId: 'bills', note: 'Chase card payment', ts: ts(2026, 10, 8), accountId: 'acct-checking', isTransfer: true },
    { id: 'e-chase-c', amount: 1566.75, categoryId: 'other', note: 'Payment Thank You', ts: ts(2026, 10, 7), accountId: 'acct-chase', isTransfer: true },
    { id: 'e-coffee', amount: 6.45, categoryId: 'dining', note: 'Starbucks', ts: ts(2026, 10, 15), accountId: 'acct-checking' },
    { id: 'e-xfer-y', amount: 200, categoryId: 'other', note: 'Transfer to savings', ts: ts(2026, 10, 15), accountId: 'acct-checking', isTransfer: true, transferKind: 'other', bankText: 'ONLINE TRANSFER TO SAV ...4821' }
  ];
  const transferPairs = [{ id: 'tp1', entryIds: ['e-chase-b', 'e-chase-c'], auto: true, unlinked: false, createdAt: Date.now() }];
  const transferPatterns = [{ id: 'pat1', pattern: 'online transfer to sav', createdAt: Date.now() }];
  const categories = [
    { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
    { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
    { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }
  ];
  return { accounts, entries, transferPairs, transferPatterns, categories };
}

async function run() {
  mkdirSync(OUT, { recursive: true });
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
    localStorage.setItem('expenseLogger.transferPairs.v1', JSON.stringify(d.transferPairs));
    localStorage.setItem('expenseLogger.transferPatterns.v1', JSON.stringify(d.transferPatterns));
    localStorage.setItem('expenseLogger.meta.v1', JSON.stringify({ forecastCushion: 600 }));
    localStorage.setItem('expenseLogger.budgets.v1', '{}');
    localStorage.setItem('expenseLogger.recurring.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'summary' }));
  }, data);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  await page.screenshot({ path: join(OUT, 'home-forecast-card-light.png'), fullPage: true });

  await page.click('#homeForecastCard');
  await page.waitForSelector('#tab-forecast:not([hidden])');
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, 'forecast-light.png'), fullPage: true });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, 'forecast-dark.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });

  await page.click('#forecastUpdateBtn');
  await page.waitForSelector('#balanceSheet.show');
  await page.waitForTimeout(MODAL_MS);
  await page.screenshot({ path: join(OUT, 'set-balance-sheet.png'), fullPage: true });
  await page.click('#balanceSheetClose');
  await page.waitForTimeout(MODAL_MS);

  await page.click('#forecastBackBtn');
  await page.waitForTimeout(200);
  await page.click('button[data-tab="history"]');
  await page.waitForTimeout(300);
  await page.click('[data-activity-range="all"]');
  await page.waitForTimeout(150);
  await page.click('.activity-account-segment[data-account-id="acct-checking"]');
  await page.waitForTimeout(200);
  const opened = await page.evaluate(() => {
    const row = document.querySelector('.activity-row[data-id="e-xfer-y"]');
    if (row) { row.click(); return true; }
    return false;
  });
  if (!opened) throw new Error('transfer row not found');
  await page.waitForSelector('#otherTransferSheet.show');
  await page.waitForTimeout(MODAL_MS);
  await page.screenshot({ path: join(OUT, 'transfer-other-account-detail.png'), fullPage: true });
  await page.evaluate(() => {
    const s = document.getElementById('otherTransferSheet');
    if (s) s.classList.remove('show');
  });
  await page.waitForTimeout(MODAL_MS);

  await page.click('button[data-tab="settings"]');
  await page.waitForTimeout(200);
  const fileInput = await page.$('#importFileInput');
  const sampleBank = join(ROOT, 'test/fixtures/sample-bank.xlsx');
  if (fileInput && existsSync(sampleBank)) {
    await fileInput.setInputFiles(sampleBank);
    await page.waitForSelector('#importAccountModal.show', { timeout: 8000 });
    await page.waitForTimeout(MODAL_MS);
    await page.click('#importAccountContinueBtn');
    await page.waitForSelector('#importModal.show');
    await page.waitForTimeout(MODAL_MS);
    await page.screenshot({ path: join(OUT, 'import-review-auto-transfer.png'), fullPage: true });
  }

  console.log('Screenshots saved to', OUT);
  await browser.close();
  srv.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
