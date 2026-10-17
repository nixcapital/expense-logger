/**
 * Closed sheet modals must not be visible or intercept taps.
 * Run: node scripts/sheet-closed-visibility-test.mjs
 */
import assert from 'assert';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8926;
const ROOT = '/workspace';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png'
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

function assertAllSheetsClosed(page, label) {
  return page.evaluate((where) => {
    const problems = [];
    document.querySelectorAll('.modal-overlay.sheet').forEach((el) => {
      const id = el.id || el.className;
      if (el.classList.contains('show')) {
        problems.push(where + ': ' + id + ' has .show while closed');
        return;
      }
      const ov = getComputedStyle(el);
      if (ov.visibility !== 'hidden') {
        problems.push(where + ': ' + id + ' overlay visibility=' + ov.visibility);
      }
      if (ov.pointerEvents !== 'none') {
        problems.push(where + ': ' + id + ' overlay pointer-events=' + ov.pointerEvents);
      }
      const modal = el.querySelector('.modal');
      if (!modal) return;
      const ms = getComputedStyle(modal);
      const rect = modal.getBoundingClientRect();
      const inViewport = rect.bottom > 0 && rect.top < window.innerHeight && rect.height > 40;
      if (inViewport && ms.opacity !== '0' && ms.visibility !== 'hidden') {
        const ty = ms.transform;
        const slidOff = ty && ty !== 'none' && ty.includes('matrix(1, 0, 0, 1, 0,');
        if (!slidOff || parseFloat(ty.split(',')[5]) >= -20) {
          problems.push(where + ': ' + id + ' modal visible in viewport (opacity=' + ms.opacity + ', transform=' + ty + ')');
        }
      }
    });
    return problems;
  }, label);
}

async function run() {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
      { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
      { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([
      { id: 'e1', amount: 12, categoryId: 'dining', note: 'Test', ts: Date.now(), accountId: 'acct-chase' }
    ]));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify([
      { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997', currentBalance: 2000, balanceAsOf: '2026-10-01' },
      { id: 'acct-chase', name: 'Chase card', type: 'credit_card', color: '#748FFC', currentBalance: 500, balanceAsOf: '2026-10-01' }
    ]));
  });
  await page.reload({ waitUntil: 'networkidle' });

  const steps = [
    async () => { await page.click('button[data-tab="summary"]'); },
    async () => { await page.click('button[data-tab="history"]'); },
    async () => { await page.evaluate(() => window.ExpenseLoggerTest.openForecastScreen()); },
    async () => { await page.click('button[data-tab="settings"]'); }
  ];
  const names = ['Home', 'Activity', 'Forecast', 'Settings'];
  const allProblems = [];
  for (let i = 0; i < steps.length; i++) {
    await steps[i]();
    await page.waitForTimeout(400);
    const probs = await assertAllSheetsClosed(page, names[i]);
    allProblems.push(...probs);
  }

  await browser.close();
  server.close();

  if (allProblems.length) {
    console.error('FAIL sheet-closed-visibility-test');
    allProblems.forEach((p) => console.error(' ', p));
    process.exit(1);
  }
  console.log('PASS sheet-closed-visibility-test');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
