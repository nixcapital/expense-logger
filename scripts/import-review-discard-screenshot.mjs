/**
 * Capture import review "Discard changes?" prompt at 428×926.
 * Run: node scripts/import-review-discard-screenshot.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8892;
const ROOT = '/workspace';
const OUT = '/opt/cursor/artifacts/screenshots/import-review-discard-prompt-428x926.png';

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

async function run() {
  mkdirSync('/opt/cursor/artifacts/screenshots', { recursive: true });
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 428, height: 926 } });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' },
      { id: 'dining', name: 'Dining', emoji: '🍽️', color: '#ff922b' },
      { id: 'other', name: 'Other', emoji: '📦', color: '#adb5bd' }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.importRules.v1', '[]');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('button[data-tab="settings"]');
  await page.locator('#importFileInput').setInputFiles(join(ROOT, 'test/fixtures/sample-card.csv'));
  await page.waitForSelector('#importAccountModal.show', { timeout: 8000 }).catch(() => {});
  if (await page.locator('#importAccountModal.show').count()) {
    await page.click('#importAccountContinueBtn');
  }
  await page.waitForSelector('#importModal.show', { timeout: 8000 });
  await page.locator('.import-row').first().locator('.import-cat-select').selectOption('groceries');
  await page.locator('#importModal').click({ position: { x: 20, y: 20 } });
  await page.waitForSelector('#importDiscardModal.show');
  await page.screenshot({ path: OUT, fullPage: true });
  await browser.close();
  server.close();
  console.log('Saved', OUT);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
