/**
 * QA viewport screenshots for Expense Logger 1.9.0 QoL flows.
 * Run: node scripts/qol-190-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';

const PORT = 8925;
const ROOT = '/workspace';
const FIX = join(ROOT, 'test/fixtures');
const OUT = '/opt/cursor/artifacts/qol-190';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.csv': 'text/csv'
};

const server = createServer((req, res) => {
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

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

const CATS = [
  { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
  { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
  { id: 'gas', name: 'Gas', icon: 'fuel', color: '#51cf66' },
  { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
  { id: 'fun', name: 'Fun', icon: 'ticket', color: '#f783ac' },
  { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' },
  { id: 'income', name: 'Income', icon: 'circle-dot', color: '#34C77B' }
];

const SEED_ENTRIES = [
  { id: 'sb1', amount: 6.75, categoryId: 'dining', note: 'STARBUCKS STORE 1188', ts: ts(2026, 9, 15), accountId: 'acct-chase' },
  { id: 'sb2', amount: 5.95, categoryId: 'other', note: 'STARBUCKS STORE 1188', ts: ts(2026, 9, 13), accountId: 'acct-chase' },
  { id: 'sb3', amount: 6.45, categoryId: 'other', note: 'STARBUCKS STORE 3390', ts: ts(2026, 9, 14), accountId: 'acct-chase' },
  { id: 'sb4', amount: 12.8, categoryId: 'other', note: 'STARBUCKS STORE 0457', ts: ts(2026, 9, 9), accountId: 'acct-chase' },
  { id: 'sb5', amount: 7.1, categoryId: 'other', note: 'STARBUCKS STORE 1188', ts: ts(2026, 9, 6), accountId: 'acct-chase' },
  { id: 'sb6', amount: 6.45, categoryId: 'other', note: 'STARBUCKS STORE 2231', ts: ts(2026, 9, 8), accountId: 'acct-chase' },
  { id: 'sb7', amount: 5.5, categoryId: 'other', note: 'STARBUCKS STORE 1188', ts: ts(2026, 9, 4), accountId: 'acct-chase' },
  { id: 'sb8', amount: 6.2, categoryId: 'other', note: 'STARBUCKS STORE 1188', ts: ts(2026, 9, 2), accountId: 'acct-chase' },
  { id: 'xfer', amount: 500, categoryId: 'other', note: 'ONLINE TRANSFER TO SAV 4471', ts: ts(2026, 9, 13), accountId: 'acct-checking', bankText: 'ONLINE TRANSFER TO SAV 4471' },
  { id: 'pay', amount: 2100, categoryId: 'income', note: 'ACME CORP PAYROLL', ts: ts(2026, 9, 16), isDeposit: true, accountId: 'acct-checking' },
  { id: 'tuition', amount: 450, categoryId: 'bills', note: 'STATE UNIV TUITION', ts: ts(2026, 9, 15), accountId: 'acct-checking' }
];

async function seedPage(page) {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(({ cats, entries }) => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(cats));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(entries));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify([
      { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997', currentBalance: 3980, balanceAsOf: '2026-10-01' },
      { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC', currentBalance: 1200, balanceAsOf: '2026-10-01' }
    ]));
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.budgets.v1', '{}');
    localStorage.setItem('expenseLogger.forecastOverrides.v1', '{}');
  }, { cats: CATS, entries: SEED_ENTRIES });
  await page.reload({ waitUntil: 'networkidle' });
}

async function shot(browser, name, scheme, fn) {
  const context = await browser.newContext({
    viewport: { width: 428, height: 926 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'Cache-Control': 'no-store' }
  });
  await context.addInitScript(() => {
    document.documentElement.style.setProperty('--safe-top', '47px');
    document.documentElement.style.setProperty('--safe-bottom', '34px');
  });
  const page = await context.newPage();
  await seedPage(page);
  await fn(page);
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: false });
  await context.close();
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
  return { path, hash };
}

async function importFile(page, rel, acct) {
  await page.locator('#importFileInput').setInputFiles(join(FIX, rel));
  await page.waitForSelector('#importAccountModal.show', { timeout: 8000 });
  await page.locator('[data-account-pick="' + acct + '"]').click();
  await page.click('#importAccountContinueBtn');
  await page.waitForSelector('#importModal.show');
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const hashes = [];

  hashes.push(await shot(browser, '1-recategorize-edit-chips-light.png', 'light', async (page) => {
    await page.click('button[data-tab="history"]');
    await page.locator('.activity-row[data-id="sb1"]').click();
    await page.waitForSelector('#receiptModal.show');
  }));

  hashes.push(await shot(browser, '1-recategorize-prompt-light.png', 'light', async (page) => {
    await page.click('button[data-tab="history"]');
    await page.evaluate(() => {
      window.ExpenseLoggerTest.setPendingBulkRecategorize({
        anchorEntryId: 'sb1',
        merchantKey: 'starbucks store #',
        categoryId: 'dining',
        count: 7,
        merchantLabel: 'STARBUCKS'
      });
      window.ExpenseLoggerTest.renderEntries();
    });
    await page.waitForTimeout(200);
  }));

  hashes.push(await shot(browser, '2-import-filters-light.png', 'light', async (page) => {
    await page.click('button[data-tab="settings"]');
    await importFile(page, 'fake-chase-oct-messy.csv', 'acct-chase');
  }));

  hashes.push(await shot(browser, '2-import-apply-light.png', 'light', async (page) => {
    await page.click('button[data-tab="settings"]');
    await importFile(page, 'fake-chase-oct-messy.csv', 'acct-chase');
    await page.locator('.import-row-hit').first().click();
    await page.locator('.import-cat-chip[data-cat="dining"]').first().click();
  }));

  hashes.push(await shot(browser, '3-forecast-edit-light.png', 'light', async (page) => {
    await page.evaluate(() => {
      const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
      for (let i = 0; i < 6; i++) {
        es.push({ id: 'v' + i, amount: 166, categoryId: 'bills', note: 'VERIZON WIRELESS', ts: Date.UTC(2026, 7 + (i % 3), 5 + i), accountId: 'acct-checking' });
      }
      localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(es));
      localStorage.setItem('expenseLogger.forecastOverrides.v1', JSON.stringify({
        verizon: { amount: 166, nextTs: new Date(2026, 10, 7).getTime(), applyFromTs: new Date(2026, 10, 5).getTime(), scope: 'once', label: 'VERIZON WIRELESS', kind: 'outflow' }
      }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => window.ExpenseLoggerTest.openForecastScreen());
    await page.waitForSelector('#forecastMain:not([hidden])');
    await page.locator('[data-forecast-item]').first().click();
    await page.waitForSelector('#forecastItemEditModal.show');
  }));

  hashes.push(await shot(browser, '4-transfer-edit-light.png', 'light', async (page) => {
    await page.click('button[data-tab="history"]');
    await page.locator('.activity-row[data-id="xfer"]').click();
    await page.waitForSelector('#receiptModal.show');
    await page.locator('#editTypeSeg .seg-btn[data-edit-type="transfer"]').click();
    const remember = page.locator('#editRememberImports');
    await remember.check();
  }));

  hashes.push(await shot(browser, '5-balance-offer-light.png', 'light', async (page) => {
    await page.click('button[data-tab="settings"]');
    await importFile(page, 'fake-checking-oct.csv', 'acct-checking');
  }));

  hashes.push(await shot(browser, '5-balance-offer-dark.png', 'dark', async (page) => {
    await page.click('button[data-tab="settings"]');
    await importFile(page, 'fake-checking-oct.csv', 'acct-checking');
  }));

  hashes.push(await shot(browser, '2-import-filters-dark.png', 'dark', async (page) => {
    await page.click('button[data-tab="settings"]');
    await importFile(page, 'fake-chase-oct-messy.csv', 'acct-chase');
  }));

  hashes.push(await shot(browser, '1-recategorize-edit-chips-dark.png', 'dark', async (page) => {
    await page.click('button[data-tab="history"]');
    await page.locator('.activity-row[data-id="sb1"]').click();
    await page.waitForSelector('#receiptModal.show');
  }));

  hashes.push(await shot(browser, '4-transfer-edit-dark.png', 'dark', async (page) => {
    await page.click('button[data-tab="history"]');
    await page.locator('.activity-row[data-id="xfer"]').click();
    await page.locator('#editTypeSeg .seg-btn[data-edit-type="transfer"]').click();
  }));

  const uniq = new Set(hashes.map((h) => h.hash));
  console.log('Saved', hashes.length, 'shots to', OUT);
  hashes.forEach((h) => console.log(h.path, h.hash));
  if (uniq.size !== hashes.length) {
    console.error('Duplicate screenshot bytes detected');
    process.exit(1);
  }
  await browser.close();
  server.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
