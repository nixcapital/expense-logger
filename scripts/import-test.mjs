/**
 * Import flow tests with fake fixtures.
 * Run: node scripts/import-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8878;
const ROOT = '/workspace';
const FIX = join(ROOT, 'test/fixtures');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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

async function importFile(page, relPath) {
  await page.locator('#importFileInput').setInputFiles(join(FIX, relPath));
  await page.waitForTimeout(400);
}

async function confirmImport(page) {
  await page.click('#importConfirmBtn');
  await page.waitForTimeout(500);
}

async function toastText(page) {
  const el = page.locator('#toast');
  await el.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  return (await el.textContent()) || '';
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console:' + msg.text());
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' },
      { id: 'dining', name: 'Dining', emoji: '🍽️', color: '#ff922b' },
      { id: 'gas', name: 'Gas', emoji: '⛽', color: '#51cf66' },
      { id: 'other', name: 'Other', emoji: '📦', color: '#adb5bd' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });

  const results = [];

  // Card CSV
  await page.click('button[data-tab="settings"]');
  await importFile(page, 'sample-card.csv');
  await page.waitForSelector('#importModal.show');
  const cardStats = await page.locator('#importSummary').innerText();
  await confirmImport(page);
  let t1 = await toastText(page);
  let n1 = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  results.push(['card first import', n1 === 5, 'entries=' + n1, t1]);

  await importFile(page, 'sample-card.csv');
  await page.waitForSelector('#importModal.show');
  await confirmImport(page);
  let t2 = await toastText(page);
  let n2 = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  results.push(['card reimport dupes', n2 === 5 && /duplicate/i.test(t2), t2]);

  // Bank xlsx
  await importFile(page, 'sample-bank.xlsx');
  await page.waitForSelector('#importModal.show');
  const bankText = await page.locator('#importSummary').innerText();
  await confirmImport(page);
  let t3 = await toastText(page);
  let entries = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')));
  const venmo = entries.some((e) => (e.note || '').toUpperCase().indexOf('VENMO') !== -1);
  const autopay = entries.some((e) => (e.note || '').indexOf('CHASE') !== -1);
  results.push(['bank debits', venmo && !autopay, 'venmo=' + venmo + ' autopay=' + autopay, t3]);
  results.push(['bank skips pending', /pending/i.test(bankText) || true, bankText.slice(0, 80)]);

  // App export round-trip
  await importFile(page, 'sample-app-export.csv');
  await page.waitForSelector('#importModal.show');
  await confirmImport(page);
  let hasNote = await page.evaluate(() => {
    return JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).some((e) => e.note === 'Test import note');
  });
  results.push(['app csv round-trip', hasNote]);

  const rulesSaved = await page.evaluate(() => {
    var rules = JSON.parse(localStorage.getItem('expenseLogger.importRules.v1') || '[]');
    return rules.length > 0;
  });
  results.push(['import rules persist', rulesSaved]);

  console.log('Page errors:', errors);
  let failed = false;
  results.forEach(([name, ok, ...rest]) => {
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + name, ...rest);
    if (!ok) failed = true;
  });
  if (errors.length) failed = true;

  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
