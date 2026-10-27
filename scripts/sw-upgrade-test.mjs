/**
 * Simulates 1.9.5 → 1.9.8 deploy on the same origin (port).
 * Run: node scripts/sw-upgrade-test.mjs [--baseline]
 * --baseline uses main-branch sw.js/app (reproduces mixed-cache issues).
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const PORT = 8877;
const ROOT_OLD = '/tmp/el-upgrade-old';
const ROOT_NEW = '/workspace';
/** Pinned 1.9.5 release (before 1.9.8). */
const UPGRADE_FROM_REF = 'da57ab0';

function prepareOldTree() {
  execSync(`rm -rf ${ROOT_OLD} && mkdir -p ${ROOT_OLD}`);
  execSync(`git archive ${UPGRADE_FROM_REF} | tar -x -C ${ROOT_OLD}`);
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png'
};

function makeServer(getRoot) {
  return createServer((req, res) => {
    const root = getRoot();
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    const file = join(root, p);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const body = readFileSync(file);
    const ext = extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=600'
    });
    res.end(body);
  });
}

async function run(useBaseline) {
  prepareOldTree();
  let currentRoot = ROOT_OLD;
  const server = makeServer(() => currentRoot);
  await new Promise((r) => server.listen(PORT, r));

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const url = `http://127.0.0.1:${PORT}/index.html`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.register('sw.js'));
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([
      { id: 't1', amount: 12.5, categoryId: 'groceries', note: 'test', ts: Date.now() }
    ]));
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' }
    ]));
  });

  let v1 = await page.evaluate(() => {
    const el = document.getElementById('versionLine');
    return el ? el.textContent : '';
  });
  console.log('After install:', v1);
  if (!v1.includes('1.9.5')) {
    console.error('Expected 1.9.5 before upgrade, got:', v1);
  }

  if (useBaseline) {
    const { writeFileSync, mkdirSync, cpSync } = await import('fs');
    const mix = '/tmp/el-upgrade-mixed';
    execSync(`rm -rf ${mix} && cp -a ${ROOT_NEW} ${mix}`);
    writeFileSync(join(mix, 'sw.js'), readFileSync(join(ROOT_OLD, 'sw.js')));
    writeFileSync(join(mix, 'app.js'), readFileSync(join(ROOT_OLD, 'app.js')));
    currentRoot = mix;
    console.log('Switching to mixed deploy (new index/charts HTML + old sw/app.js)');
  } else {
    const deployNew = '/tmp/el-upgrade-new';
    execSync(`rm -rf ${deployNew} && cp -a ${ROOT_NEW} ${deployNew}`);
    currentRoot = deployNew;
    console.log('Switching server files to full 1.9.8');
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  let v2 = await page.evaluate(() => document.getElementById('versionLine')?.textContent || '');
  let entries = await page.evaluate(() => localStorage.getItem('expenseLogger.entries.v1'));
  let caches = await page.evaluate(async () => caches.keys());
  console.log('After deploy reload:', v2, 'caches:', caches, 'entries preserved:', !!entries);

  let reloads = 0;
  while (!v2.includes('1.9.8') && reloads < 2) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    v2 = await page.evaluate(() => document.getElementById('versionLine')?.textContent || '');
    caches = await page.evaluate(async () => caches.keys());
    reloads += 1;
    console.log('Extra reload', reloads + ':', v2, 'caches:', caches);
  }

  const ok = v1.includes('1.9.5') && v2.includes('1.9.8') && entries && entries.includes('12.5') && errors.length === 0;
  console.log('page errors:', errors);
  console.log(ok ? 'PASS' : 'FAIL');

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
}

const baseline = process.argv.includes('--baseline');
run(baseline).catch((e) => {
  console.error(e);
  process.exit(1);
});
