/**
 * QA screenshots for Release 1.5.0 accounts + transfers (428x926, fake data only).
 * Run: node scripts/accounts-qa-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8894;
const OUT = join(process.cwd(), 'qa-screenshots');
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function makeServer(root) {
  return createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = join(root, p);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
}

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

const categories = [
  { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
  { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
  { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
  { id: 'gas', name: 'Gas', icon: 'fuel', color: '#51cf66' },
  { id: 'fun', name: 'Fun', icon: 'ticket', color: '#f783ac' }
];

const accounts = [
  { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997' },
  { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
];

const entries = [
  { id: 't1', amount: 1250, categoryId: 'bills', note: 'CHASE CRD AUTOPAY', ts: ts(2026, 9, 15), isTransfer: true, accountId: 'acct-checking', importSource: 'bank' },
  { id: 't2', amount: 1250, categoryId: 'bills', note: 'Payment Thank You', ts: ts(2026, 9, 16), isTransfer: true, accountId: 'acct-chase', importSource: 'card', typeVal: 'payment' },
  { id: 'e1', amount: 18.42, categoryId: 'dining', note: 'Panera Bread \u00B7 Lunch', ts: ts(2026, 9, 16), accountId: 'acct-chase' },
  { id: 'e2', amount: 45.85, categoryId: 'groceries', note: "Trader Joe's", ts: ts(2026, 9, 16), accountId: 'acct-chase' },
  { id: 'e3', amount: 142.4, categoryId: 'bills', note: 'Duke Energy \u00B7 Autopay', ts: ts(2026, 9, 15), accountId: 'acct-checking', recurringId: 'r1' },
  { id: 'e4', amount: 40, categoryId: 'gas', note: 'Shell', ts: ts(2026, 9, 16), accountId: 'acct-chase' },
  { id: 'e5', amount: 31.5, categoryId: 'fun', note: 'AMC Theatres', ts: ts(2026, 9, 14), accountId: 'acct-chase' },
  { id: 'e6', amount: 67.2, categoryId: 'groceries', note: 'Target \u00B7 Household', ts: ts(2026, 9, 13), accountId: 'acct-chase' }
];

const transferPairs = [{ id: 'pair1', entryIds: ['t1', 't2'], auto: true, unlinked: false, createdAt: Date.now() }];

mkdirSync(OUT, { recursive: true });
const server = makeServer(process.cwd());
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 428, height: 926 } });

await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate(({ categories, entries, accounts, transferPairs }) => {
  localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(categories));
  localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(entries));
  localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify(accounts));
  localStorage.setItem('expenseLogger.transferPairs.v1', JSON.stringify(transferPairs));
  localStorage.setItem('expenseLogger.transferUnlink.v1', '[]');
  localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({
    tab: 'history',
    activityRange: 'this-month',
    activityAccountId: ''
  }));
}, { categories, entries, accounts, transferPairs });
await page.reload({ waitUntil: 'networkidle' });

await page.click('[data-tab="settings"]');
await page.locator('#importFileInput').setInputFiles(join(process.cwd(), 'test/fixtures/sample-card-period-b.csv'));
await page.waitForSelector('#importAccountModal.show');
await page.screenshot({ path: join(OUT, '15-import-account-sheet.png') });
await page.click('#importAccountContinueBtn');
await page.waitForSelector('#importModal.show');
await page.screenshot({ path: join(OUT, '15-import-summary-reimport.png') });
await page.click('#importCancelBtn');

await page.click('[data-tab="history"]');
await page.waitForSelector('.activity-account-segment');
await page.waitForTimeout(350);
await page.screenshot({ path: join(OUT, '15-activity-all-accounts-dark.png') });

await page.click('.activity-account-segment[data-account-id="acct-chase"]');
await page.waitForTimeout(350);
await page.screenshot({ path: join(OUT, '15-activity-chase-filter-dark.png') });

await page.click('.activity-row.is-transfer-row');
await page.waitForSelector('#transferDetailView:not([hidden])');
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, '15-transfer-detail.png') });
await page.click('#transferDetailBackBtn');

await page.emulateMedia({ colorScheme: 'light' });
await page.click('.activity-account-segment[data-account-id=""]');
await page.waitForTimeout(350);
await page.screenshot({ path: join(OUT, '15-activity-all-accounts-light.png') });

console.log('Wrote QA screenshots to', OUT);
await browser.close();
server.close();
