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

async function importFile(page, relPath, accountPickId) {
  await page.locator('#importFileInput').setInputFiles(join(FIX, relPath));
  await page.waitForSelector('#importAccountModal.show', { timeout: 5000 }).catch(() => {});
  const accountSheet = await page.locator('#importAccountModal.show').count();
  if (accountSheet) {
    await page.waitForTimeout(300);
    if (accountPickId) {
      await page.locator('[data-account-pick="' + accountPickId + '"]').click();
      await page.waitForTimeout(150);
    }
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
  results.push(['card reimport dupes', n2.spending === 5 && /duplicate|already imported|skipped|tagged/i.test(dupSummary), JSON.stringify(n2) + ' ' + t2]);

  await page.evaluate(() => {
    const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    const river = es.find((e) => (e.note || '').indexOf('RIVER CAFE') !== -1);
    if (river) river.amount = 40;
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(es));
  });
  await importFile(page, 'sample-card.csv');
  await page.waitForSelector('#importModal.show');
  const editedDupSummary = await page.locator('#importSummary').innerText();
  await confirmImport(page);
  const nEdited = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    return {
      spending: all.filter((e) => !e.isTransfer).length,
      river: all.filter((e) => (e.note || '').indexOf('RIVER CAFE') !== -1).length
    };
  });
  results.push([
    'edited import row reimport dedupes on bank values',
    nEdited.spending === 5 && nEdited.river === 1 && /duplicate/i.test(editedDupSummary),
    JSON.stringify(nEdited) + ' ' + editedDupSummary.replace(/\s+/g, ' ').slice(0, 70)
  ]);

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
  await page.locator('.import-row').filter({ hasText: 'VENMO' }).locator('.import-row-hit').click();
  await page.locator('.import-row').filter({ hasText: 'VENMO' }).locator('.import-cat-chip[data-cat="dining"]').click();
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

  // Bank deposit dedupe (checking CSV)
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' },
      { id: 'dining', name: 'Dining', emoji: '🍽️', color: '#ff922b' },
      { id: 'income', name: 'Income', emoji: '💰', color: '#20C997' },
      { id: 'other', name: 'Other', emoji: '📦', color: '#adb5bd' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify([
      { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997' },
      { id: 'acct-savings', name: 'Savings', type: 'bank', color: '#fab005' },
      { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC' }
    ]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('button[data-tab="settings"]');

  await importFile(page, 'sample-bank-checking.csv', 'acct-checking');
  await page.waitForSelector('#importModal.show');
  await confirmImport(page);
  const bankDep1 = await page.evaluate(() => {
    const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    return {
      n: es.length,
      deposits: es.filter((e) => e.isDeposit).length,
      twinMobile: es.filter((e) => (e.note || '').indexOf('MOBILE DEPOSIT') !== -1).length
    };
  });
  results.push(['bank csv twin mobile deposits', bankDep1.twinMobile === 2 && bankDep1.deposits === 3, JSON.stringify(bankDep1)]);

  await importFile(page, 'sample-bank-checking.csv', 'acct-checking');
  await page.waitForSelector('#importModal.show');
  const bankReSummary = await page.locator('#importSummary').innerText();
  await confirmImport(page);
  const bankReToast = await toastText(page);
  const bankDep2 = await page.evaluate(() => JSON.parse(localStorage.getItem('expenseLogger.entries.v1')).length);
  results.push([
    'bank deposit reimport no new rows',
    bankDep2 === bankDep1.n && /0\s*to import/i.test(bankReSummary.replace(/\s+/g, ' ')),
    'n=' + bankDep2 + ' ' + bankReToast.replace(/\s+/g, ' ').slice(0, 80)
  ]);
  results.push(['bank deposit reimport dup summary', /duplicate/i.test(bankReSummary)]);

  await importFile(page, 'sample-bank-savings-deposit.csv', 'acct-savings');
  await page.waitForSelector('#importModal.show');
  const savingsSummary = await page.locator('#importSummary').innerText();
  await confirmImport(page);
  const savingsMobile = await page.evaluate(() => {
    const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    return es.filter((e) => (e.note || '').indexOf('MOBILE DEPOSIT') !== -1 && e.accountId === 'acct-savings').length;
  });
  results.push([
    'deposit different account not deduped',
    savingsMobile === 1 && /1\s*to import/i.test(savingsSummary.replace(/\s+/g, ' ')),
    'savingsMobile=' + savingsMobile
  ]);

  // Bank transfer re-import + category preserved on duplicate
  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
    localStorage.setItem('expenseLogger.transferPairs.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('button[data-tab="settings"]');
  await importFile(page, 'sample-bank.xlsx', 'acct-checking');
  await page.waitForSelector('#importModal.show');
  await confirmImport(page);
  await page.evaluate(() => {
    const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    const payroll = es.find((e) => (e.note || '').indexOf('PAYROLL') !== -1);
    if (payroll) {
      payroll.categoryId = 'dining';
      payroll.note = 'PAYROLL DEP PPD edited';
      localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(es));
    }
  });
  const xferBefore = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    T.reloadFromStorage();
    T.autoPairTransfers();
    const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    return {
      xfer: es.filter((e) => e.isTransfer).length,
      pairs: JSON.parse(localStorage.getItem('expenseLogger.transferPairs.v1') || '[]').filter((p) => !p.unlinked).length,
      payrollCat: es.find((e) => (e.note || '').indexOf('PAYROLL') !== -1)?.categoryId
    };
  });
  await importFile(page, 'sample-bank.xlsx', 'acct-checking');
  await page.waitForSelector('#importModal.show');
  await confirmImport(page);
  const xferAfter = await page.evaluate(() => {
    const T = window.ExpenseLoggerTest;
    T.reloadFromStorage();
    T.autoPairTransfers();
    const es = JSON.parse(localStorage.getItem('expenseLogger.entries.v1'));
    return {
      n: es.length,
      xfer: es.filter((e) => e.isTransfer).length,
      pairs: JSON.parse(localStorage.getItem('expenseLogger.transferPairs.v1') || '[]').filter((p) => !p.unlinked).length,
      payrollCat: es.find((e) => (e.note || '').indexOf('PAYROLL') !== -1)?.categoryId,
      payrollNote: es.find((e) => (e.note || '').indexOf('PAYROLL') !== -1)?.note
    };
  });
  results.push(['bank reimport transfers stable', xferAfter.xfer === xferBefore.xfer && xferAfter.pairs === xferBefore.pairs, xferAfter]);
  results.push([
    'bank reimport keeps edited deposit',
    xferAfter.payrollCat === 'dining' && xferAfter.payrollNote === 'PAYROLL DEP PPD edited',
    xferAfter
  ]);

  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('button[data-tab="settings"]');
  await importFile(page, 'sample-card.csv');
  await page.waitForSelector('#importModal.show');
  await page.locator('.import-row-hit').first().click();
  await page.locator('.import-cat-chip[data-cat="groceries"]').first().click();
  await page.locator('#importModal').click({ position: { x: 20, y: 20 } });
  await page.waitForSelector('#importReviewDiscardScrim.show');
  const discardTitle = await page.locator('#importDiscardTitle').innerText();
  results.push(['import review discard prompt', /discard changes/i.test(discardTitle)]);
  await page.click('#importDiscardKeepBtn');
  await page.waitForTimeout(300);
  const reviewStillOpen = await page.locator('#importModal.show').count();
  results.push(['import review backdrop keep editing', reviewStillOpen === 1]);
  await page.locator('#importModal').click({ position: { x: 20, y: 20 } });
  await page.waitForSelector('#importReviewDiscardScrim.show');
  await page.click('#importDiscardConfirmBtn');
  await page.waitForTimeout(300);
  const reviewClosed = await page.locator('#importModal.show').count();
  results.push(['import review backdrop discard closes', reviewClosed === 0]);

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
