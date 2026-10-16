/**
 * Import flow tests with fake fixtures.
 * Run: node scripts/import-test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, writeFileSync } from 'fs';
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
  await page.waitForSelector('#importAccountModal.show', { timeout: 5000 }).catch(() => {});
  const accountSheet = await page.locator('#importAccountModal.show').count();
  if (accountSheet) {
    await page.waitForTimeout(300);
    await page.click('#importAccountContinueBtn');
    await page.waitForFunction(() => {
      const acct = document.getElementById('importAccountModal');
      const review = document.getElementById('importModal');
      return acct && !acct.classList.contains('show') && review && review.classList.contains('show');
    }, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  } else {
    await page.waitForTimeout(400);
  }
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
      { id: 'bills', name: 'Bills', emoji: '📄', color: '#cc5de8' },
      { id: 'other', name: 'Other', emoji: '📦', color: '#adb5bd' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });

  const results = [];

  await page.click('button[data-tab="settings"]');
  await importFile(page, 'sample-card.csv');
  await page.waitForSelector('#importModal.show');
  await confirmImport(page);
  let n1 = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    return { all: all.length, spending: all.filter((e) => !e.isTransfer).length, xfer: all.filter((e) => e.isTransfer).length };
  });
  results.push(['card first import', n1.spending === 5 && n1.xfer === 1, JSON.stringify(n1)]);

  await importFile(page, 'sample-card.csv');
  await page.waitForSelector('#importModal.show');
  const dupSummary = await page.locator('#importSummary').innerText();
  await confirmImport(page);
  let t2 = await toastText(page);
  let n2 = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    return { spending: all.filter((e) => !e.isTransfer).length, all: all.length };
  });
  results.push(['card reimport dupes', n2.spending === 5 && /duplicate|skipped|tagged/i.test(dupSummary), JSON.stringify(n2) + ' ' + t2]);

  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('button[data-tab="settings"]');
  await importFile(page, 'sample-card.csv');
  await page.waitForSelector('#importModal.show');
  await confirmImport(page);
  await importFile(page, 'sample-bank.xlsx');
  await page.waitForSelector('#importModal.show');
  const bankReview = await page.locator('#importSummary').innerText();
  const bankBuckets = await page.evaluate(() => {
    const t = document.getElementById('importSummary').innerText;
    const grab = (label) => {
      const m = t.match(new RegExp('(\\d+)\\s*' + label));
      return m ? parseInt(m[1], 10) : 0;
    };
    return {
      import: grab('to import'),
      duplicate: grab('duplicates'),
      transfer: grab('transfers'),
      credit: grab('credits'),
      pending: grab('pending'),
      unreadable: grab('unreadable')
    };
  });
  const bucketSum = bankBuckets.import + bankBuckets.duplicate + bankBuckets.transfer +
    bankBuckets.credit + bankBuckets.pending + bankBuckets.unreadable;
  results.push(['bank first-import no false dupes', bankBuckets.duplicate === 0, JSON.stringify(bankBuckets)]);
  results.push(['bank review buckets partition file', bucketSum === 8, 'sum=' + bucketSum, bankReview.replace(/\s+/g, ' ').slice(0, 70)]);
  results.push(['bank two card payments transfer', bankBuckets.transfer === 2, 'transfers=' + bankBuckets.transfer]);
  const rulesAfterBank = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.importRules.v1') || '[]').length);
  results.push(['no auto rules on import', rulesAfterBank === 0, 'rules=' + rulesAfterBank]);
  await page.locator('.import-row').filter({ hasText: 'VENMO' }).locator('.import-cat-select').selectOption('dining');
  await confirmImport(page);
  const rulesListText = await page.locator('#importRulesList').innerText();
  results.push(['import rules list refreshes', !/No import rules yet/i.test(rulesListText)]);
  let entries = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')));
  const venmo = entries.some((e) => (e.note || '').toUpperCase().indexOf('VENMO') !== -1);
  const autopayXfer = entries.some((e) => (e.note || '').indexOf('CRDAUTOPAY') !== -1 && e.isTransfer);
  const studentLoan = entries.some((e) => (e.note || '').indexOf('STUDENT LOAN') !== -1);
  results.push(['bank venmo spending', venmo]);
  results.push(['bank crdautopay transfer', autopayXfer]);
  results.push(['bank student loan spending', studentLoan]);

  // Overlapping card exports
  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('button[data-tab="settings"]');
  await importFile(page, 'sample-card-period-a.csv');
  await page.waitForSelector('#importModal.show');
  await confirmImport(page);
  const na = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  await importFile(page, 'sample-card-period-b.csv');
  await page.waitForSelector('#importModal.show');
  const overlapText = await page.locator('#importSummary').innerText();
  await confirmImport(page);
  const nb = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  const twinCoffee = await page.evaluate(() => {
    const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    const day = (ts) => {
      const d = new Date(ts);
      return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    };
    return es.filter((e) => (e.note || '').indexOf('COFFEE CORNER') !== -1 && e.amount === 5 && day(e.ts) === '2025-3-3').length;
  });
  results.push(['overlap period A count', na === 5, 'n=' + na]);
  results.push(['overlap only new in B', nb === 6, 'n=' + nb]);
  results.push(['overlap dupes in summary', /duplicate/i.test(overlapText) && /4/.test(overlapText), overlapText.replace(/\s+/g, ' ').slice(0, 60)]);
  results.push(['twin same-day coffees kept', twinCoffee === 2, 'coffee5=' + twinCoffee]);

  // App export round-trip from full log
  const exportPath = join(FIX, 'generated-roundtrip.csv');
  const csvText = await page.evaluate(() => {
    const entries = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    const cats = JSON.parse(localStorage.getItem('expenseLogger.categories.v1'));
    const catName = (id) => (cats.find((c) => c.id === id) || { name: id }).name;
    const pad = (n) => (n < 10 ? '0' : '') + n;
    const lines = [['Date', 'Time', 'Category', 'Amount', 'Note', 'Recurring', 'Receipt'].join(',')];
    entries.forEach((e) => {
      const d = new Date(e.ts);
      lines.push([
        d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
        pad(d.getHours()) + ':' + pad(d.getMinutes()),
        catName(e.categoryId),
        e.amount.toFixed(2),
        e.note || '',
        'No',
        'No'
      ].join(','));
    });
    return lines.join('\r\n');
  });
  writeFileSync(exportPath, csvText, 'utf8');
  const countBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  await importFile(page, 'generated-roundtrip.csv');
  await page.waitForSelector('#importModal.show');
  const rtSummary = await page.locator('#importSummary').innerText();
  await confirmImport(page);
  const rtToast = await toastText(page);
  const countAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  const rtOk = countAfter === countBefore && (/0 new/.test(rtToast) || /duplicate/i.test(rtToast))
    && /0\s*to import/i.test(rtSummary.replace(/\s+/g, ' '));
  results.push(['app export round-trip', rtOk, rtToast, rtSummary.replace(/\s+/g, ' ').slice(0, 50)]);

  await importFile(page, 'sample-app-export.csv');
  await page.waitForSelector('#importModal.show');
  await confirmImport(page);
  let hasNote = await page.evaluate(() => {
    return JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).some((e) => e.note === 'Test import note');
  });
  results.push(['app csv sample note', hasNote]);

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
