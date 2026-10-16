/**
 * Regression: splash dismisses and Home renders for legacy localStorage + SW upgrades.
 * Run: node scripts/splash-boot-test.mjs
 */
import assert from 'assert';
import { chromium, webkit, devices } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join, extname } from 'path';
import { execSync } from 'child_process';

const PORT = 8902;
const ROOT = '/workspace';
const VIEWPORT = { width: 428, height: 926 };
const ARTIFACT_DIR = '/cursor/stores/self/artifacts/hotfix-163';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const DEFAULT_CATS = [
  { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
  { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
  { id: 'gas', name: 'Gas', icon: 'fuel', color: '#51cf66' },
  { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
  { id: 'fun', name: 'Fun', icon: 'ticket', color: '#f783ac' },
  { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' },
  { id: 'income', name: 'Income', icon: 'receipt', color: '#20C997' }
];

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

function server(getRoot) {
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
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(readFileSync(file));
  });
}

function buildFixtures() {
  const pre15Entries = [];
  for (let i = 0; i < 24; i++) {
    pre15Entries.push({
      id: 'old-' + i,
      amount: 12 + (i % 7),
      categoryId: 'groceries',
      note: 'Legacy shop ' + i,
      ts: ts(2026, 7, 1 + (i % 20))
    });
  }

  const forecastEntries = [];
  for (let i = 0; i < 10; i++) {
    forecastEntries.push({
      id: 'fc-' + i,
      amount: 18 + i,
      categoryId: 'other',
      note: 'Checking spend ' + i,
      ts: ts(2026, 9, 4 + i),
      accountId: 'acct-checking'
    });
  }
  forecastEntries.push({
    id: 'pay1',
    amount: 2400,
    categoryId: 'income',
    note: 'ACME CORP PAYROLL',
    ts: ts(2026, 9, 15),
    accountId: 'acct-checking',
    isDeposit: true
  });

  const accounts161 = [
    {
      id: 'acct-checking',
      name: 'Checking',
      type: 'bank',
      color: '#20C997',
      currentBalance: 3850,
      balanceAsOf: '2026-10-16',
      balanceHistory: { amount: 3850, asOf: '2026-10-16' }
    },
    { id: 'acct-chase', name: 'Chase', type: 'credit_card', color: '#748FFC' },
    { id: 'weird-no-type', name: 'Side pot', color: '#ffffff' }
  ];

  return [
    { name: 'fresh', storage: null },
    {
      name: 'pre-1.5-no-account',
      storage: {
        'expenseLogger.categories.v1': JSON.stringify(DEFAULT_CATS),
        'expenseLogger.entries.v1': JSON.stringify(pre15Entries),
        'expenseLogger.budgets.v1': '{}',
        'expenseLogger.recurring.v1': '[]',
        'expenseLogger.ui.v1': JSON.stringify({ tab: 'summary' })
      }
    },
    {
      name: '1.5-accounts',
      storage: {
        'expenseLogger.categories.v1': JSON.stringify(DEFAULT_CATS),
        'expenseLogger.accounts.v1': JSON.stringify([
          { id: 'acct-checking', name: 'Checking', type: 'bank', color: '#20C997' },
          { id: 'acct-chase', name: 'Chase', type: 'credit_card', color: '#748FFC' }
        ]),
        'expenseLogger.entries.v1': JSON.stringify([
          { id: 'e1', amount: 42, categoryId: 'groceries', note: 'Test', ts: ts(2026, 9, 10), accountId: 'acct-checking' }
        ]),
        'expenseLogger.ui.v1': JSON.stringify({ tab: 'summary' })
      }
    },
    {
      name: '1.6-forecast-bundle',
      storage: {
        'expenseLogger.categories.v1': JSON.stringify(DEFAULT_CATS),
        'expenseLogger.accounts.v1': JSON.stringify(accounts161),
        'expenseLogger.entries.v1': JSON.stringify(forecastEntries),
        'expenseLogger.forecastOverrides.v1': JSON.stringify({
          'rent|2026-09-01': { amount: 1650, applyFromTs: ts(2026, 8, 1), label: 'Rent', kind: 'outflow' }
        }),
        'expenseLogger.meta.v1': JSON.stringify({ forecastCushion: 600 }),
        'expenseLogger.ui.v1': JSON.stringify({ tab: 'summary' })
      }
    },
    {
      name: '1.6.1-string-balance',
      storage: {
        'expenseLogger.categories.v1': JSON.stringify(DEFAULT_CATS),
        'expenseLogger.accounts.v1': JSON.stringify([
          {
            id: 'legacy-checking-001',
            name: 'Checking',
            type: 'bank',
            currentBalance: '4100.25',
            balanceAsOf: '2026-10-16',
            balanceHistory: { amount: '4100.25', asOf: '2026-10-16' }
          },
          { id: 'acct-chase', name: 'Chase', type: 'credit_card', color: '#748FFC' }
        ]),
        'expenseLogger.entries.v1': JSON.stringify(forecastEntries.map((e) => Object.assign({}, e, {
          accountId: e.accountId === 'acct-checking' ? 'legacy-checking-001' : e.accountId
        }))),
        'expenseLogger.forecastOverrides.v1': '{}',
        'expenseLogger.meta.v1': JSON.stringify({ forecastCushion: null }),
        'expenseLogger.ui.v1': JSON.stringify({ tab: 'summary' })
      }
    },
    {
      name: 'odd-edge-payload',
      storage: {
        'expenseLogger.categories.v1': JSON.stringify(DEFAULT_CATS),
        'expenseLogger.accounts.v1': JSON.stringify([
          { id: 'acct-checking', name: 'Checking', type: 'bank', currentBalance: null, balanceAsOf: '2026-10-16' },
          { id: 'acct-chase', name: 'Chase', type: 'credit_card', color: '#748FFC' }
        ]),
        'expenseLogger.entries.v1': JSON.stringify([
          { id: 'z1', amount: '12.50', categoryId: 'groceries', note: 'str amt', ts: ts(2026, 9, 1), accountId: 'acct-checking' },
          { id: 'z2', amount: 0, categoryId: 'other', note: 'zero', ts: ts(2026, 9, 2), accountId: 'acct-checking' },
          { id: 'z3', amount: 5, categoryId: 'missing-cat', note: 'no ts field', accountId: 'acct-checking' }
        ]),
        'expenseLogger.forecastOverrides.v1': '[]',
        'expenseLogger.meta.v1': JSON.stringify({ forecastCushion: '600' }),
        'expenseLogger.ui.v1': JSON.stringify({ tab: 'forecast' })
      }
    }
  ];
}

async function assertBoot(page, url, fixture, label) {
  await page.goto('about:blank');
  if (fixture.initScript) {
    await page.addInitScript(fixture.initScript);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  if (fixture.storage) {
    await page.evaluate((s) => {
      Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
    }, fixture.storage);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(1200);
  const snap = await page.evaluate(() => {
    const splash = document.getElementById('splashScreen');
    const summary = document.getElementById('tab-summary');
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('expenseLogger.') === 0) keys.push(k);
    }
    return {
      splashHidden: splash && (splash.classList.contains('hide') || splash.style.display === 'none'),
      homeVisible: summary && !summary.hidden,
      version: document.getElementById('versionLine')?.textContent || '',
      storageKeys: keys.sort()
    };
  });
  assert.ok(snap.splashHidden, label + ': splash must dismiss');
  assert.ok(snap.homeVisible, label + ': Home tab must render');
  assert.ok(snap.version.indexOf('1.7.2') !== -1, label + ': version line');
  if (fixture.storage) {
    assert.ok(snap.storageKeys.length > 0, label + ': storage preserved');
  }
  return snap;
}

function standaloneInitScript() {
  return () => {
    try {
      Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true });
    } catch (e) {}
  };
}

function assertNoModernSyntaxInShell() {
  const files = ['app.js', 'forecast.js', 'icon-system.js', 'sw.js'];
  const forbidden = [
    { re: /\bfindLast(?:Index)?\s*\(/, name: 'Array.findLast/findLastIndex' },
    { re: /\btoSorted\s*\(/, name: 'Array.toSorted' },
    { re: /\btoReversed\s*\(/, name: 'Array.toReversed' },
    { re: /\bstructuredClone\s*\(/, name: 'structuredClone' },
    { re: /\(\?<[=!]/, name: 'regex lookbehind' },
    { re: /^[\s\S]*?\bawait\s+import\s*\(/m, name: 'top-level await import' }
  ];
  files.forEach((f) => {
    const src = readFileSync(join(ROOT, f), 'utf8');
    forbidden.forEach(({ re, name }) => {
      assert.ok(!re.test(src), f + ' must not use ' + name + ' (iOS WebKit compatibility)');
    });
  });
}

async function runFixtures(browserName, launch) {
  const srv = server(() => ROOT);
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await launch();
  const context = await browser.newContext({
    ...devices['iPhone 13 Pro Max'],
    viewport: VIEWPORT,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: browserName === 'webkit' ? 'allow' : undefined
  });
  if (browserName === 'webkit') {
    await context.addInitScript(standaloneInitScript());
  }
  const page = await context.newPage();
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const fixtures = buildFixtures();
  fixtures.push({
    name: 'forecast-boot-throw',
    storage: fixtures.find((f) => f.name === '1.6-forecast-bundle').storage,
    initScript: () => { window.__elTestThrowForecastBoot = true; }
  });

  for (const fx of fixtures) {
    await assertBoot(page, url, fx, browserName + '/' + fx.name);
  }
  await browser.close();
  srv.close();
}

async function runSwUpgrade(fromTag, label, launch, standalone) {
  const ROOT_OLD = '/tmp/el-sw-' + fromTag.replace(/\W/g, '');
  execSync(`rm -rf ${ROOT_OLD} && mkdir -p ${ROOT_OLD}`);
  execSync(`git archive ${fromTag} | tar -x -C ${ROOT_OLD}`);
  let currentRoot = ROOT_OLD;
  const srv = server(() => currentRoot);
  await new Promise((r) => srv.listen(PORT + 1, r));

  const browser = await launch();
  const ctxOpts = standalone
    ? {
        ...devices['iPhone 13 Pro Max'],
        viewport: VIEWPORT,
        hasTouch: true,
        isMobile: true,
        serviceWorkers: 'allow'
      }
    : {};
  const context = standalone ? await browser.newContext(ctxOpts) : null;
  if (standalone) await context.addInitScript(standaloneInitScript());
  const page = context ? await context.newPage() : await browser.newPage();
  const url = `http://127.0.0.1:${PORT + 1}/index.html`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.register('sw.js'));
  await page.waitForTimeout(800);
  await page.evaluate((s) => {
    Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
  }, buildFixtures().find((f) => f.name === '1.6-forecast-bundle').storage);

  currentRoot = ROOT;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const snap = await page.evaluate(() => ({
    splashHidden: document.getElementById('splashScreen')?.classList.contains('hide'),
    version: document.getElementById('versionLine')?.textContent || '',
    entries: localStorage.getItem('expenseLogger.entries.v1')
  }));
  assert.ok(snap.splashHidden, label + ': splash after SW upgrade');
  assert.ok(snap.version.indexOf('1.7.2') !== -1, label + ': version after upgrade');
  assert.ok(snap.entries && snap.entries.indexOf('fc-0') !== -1, label + ': entries preserved');
  await browser.close();
  srv.close();
}

/** iOS PWA: stale SW used to respond to .js with index.html — boot must recover via failsafe. */
async function runIosJsFallbackRecovery(launch) {
  const PORT_FB = PORT + 3;
  const srv = createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/index.html';
    if (/\.(js|css)$/.test(p)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(readFileSync(join(ROOT, 'index.html')));
      return;
    }
    const file = join(ROOT, p);
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => srv.listen(PORT_FB, r));
  const browser = await launch();
  const context = await browser.newContext({
    ...devices['iPhone 13 Pro Max'],
    viewport: VIEWPORT,
    hasTouch: true,
    isMobile: true
  });
  await context.addInitScript(standaloneInitScript());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT_FB}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7200);
  const snap = await page.evaluate(() => ({
    splashHidden: document.getElementById('splashScreen')?.classList.contains('hide'),
    bootErr: document.getElementById('homeBootError') && !document.getElementById('homeBootError').hidden,
    version: document.getElementById('versionLine')?.textContent || '',
    standalone: !!navigator.standalone
  }));
  assert.ok(snap.standalone, 'ios-js-fallback: standalone profile');
  assert.ok(snap.splashHidden, 'ios-js-fallback: splash must dismiss via failsafe');
  assert.ok(!snap.version, 'ios-js-fallback: app.js must not boot when script response is HTML');
  await browser.close();
  srv.close();
}

async function captureScreenshots() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const srv = server(() => ROOT);
  await new Promise((r) => srv.listen(PORT + 2, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['iPhone 13 Pro Max'],
    viewport: VIEWPORT,
    hasTouch: true,
    isMobile: true
  });
  const page = await context.newPage();
  const url = `http://127.0.0.1:${PORT + 2}/index.html`;

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    Object.keys(s).forEach((k) => localStorage.setItem(k, s[k]));
  }, buildFixtures().find((f) => f.name === '1.6-forecast-bundle').storage);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(ARTIFACT_DIR, 'home-after-163.png') });

  await browser.close();
  srv.close();
}

async function runFreshWebKitStandalone(launch) {
  const srv = server(() => ROOT);
  await new Promise((r) => srv.listen(PORT + 4, r));
  const browser = await launch();
  const context = await browser.newContext({
    ...devices['iPhone 13 Pro Max'],
    viewport: VIEWPORT,
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'allow'
  });
  await context.addInitScript(standaloneInitScript());
  await context.clearPermissions();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT + 4}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const snap = await page.evaluate(() => ({
    splashHidden: document.getElementById('splashScreen')?.classList.contains('hide'),
    homeVisible: document.getElementById('tab-summary') && !document.getElementById('tab-summary').hidden,
    version: document.getElementById('versionLine')?.textContent || '',
    storageEmpty: localStorage.length === 0
  }));
  assert.ok(snap.splashHidden, 'fresh webkit standalone: splash must hide within 2s');
  assert.ok(snap.homeVisible, 'fresh webkit standalone: Home visible');
  assert.ok(snap.version.indexOf('1.7.2') !== -1, 'fresh webkit standalone: version');
  await browser.close();
  srv.close();
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  assertNoModernSyntaxInShell();
  await runFreshWebKitStandalone(() => webkit.launch());
  await runFixtures('chromium', () => chromium.launch());
  await runFixtures('webkit', () => webkit.launch());
  await runSwUpgrade('4a0cba0', 'sw-150-to-162', () => chromium.launch(), false);
  await runSwUpgrade('8f561db', 'sw-160-to-162', () => chromium.launch(), false);
  await runSwUpgrade('8f561db', 'sw-160-to-162-webkit-standalone', () => webkit.launch(), true);
  await runIosJsFallbackRecovery(() => webkit.launch());
  await captureScreenshots();
  console.log('splash-boot-test: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
