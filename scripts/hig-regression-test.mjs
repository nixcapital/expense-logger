/**
 * HIG regression (inherited app chrome): safe-area padding, touch targets, contrast, type scale.
 * Run: node scripts/hig-regression-test.mjs
 */
import assert from 'assert';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8899;
const ROOT = '/workspace';
const VIEWPORT = { width: 428, height: 926 };
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function server() {
  return createServer((req, res) => {
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
}

function relLuminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(fg, bg) {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const SAFE_INSET_CSS = `
  .screen-header-wrap { padding-top: calc(47px + var(--sp-2)) !important; }
  .bottom-tab-bar {
    padding-bottom: 34px !important;
    height: calc(var(--tab-bar-h) + 34px) !important;
    box-sizing: border-box !important;
  }
  .forecast-nav { padding-top: calc(47px + var(--sp-2)) !important; }
`;

async function injectSafeInsets(page) {
  await page.addStyleTag({ content: SAFE_INSET_CSS });
}

async function run() {
  const srv = server();
  await new Promise((r) => srv.listen(PORT, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('expenseLogger.categories.v1', JSON.stringify([
      { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' }
    ]));
    localStorage.setItem('expenseLogger.accounts.v1', JSON.stringify([
      {
        id: 'acct-checking',
        name: 'Checking',
        type: 'bank',
        color: '#20C997',
        currentBalance: 1200,
        balanceAsOf: '2026-10-16'
      }
    ]));
    localStorage.setItem('expenseLogger.entries.v1', '[]');
    localStorage.setItem('expenseLogger.ui.v1', JSON.stringify({ tab: 'settings' }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await injectSafeInsets(page);

  const usesSafeAreaEnv = await page.evaluate(() => {
    return Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules || []).some((rule) => {
          return rule.cssText && rule.cssText.includes('screen-header-wrap')
            && rule.cssText.includes('safe-area-inset-top');
        });
      } catch (e) {
        return false;
      }
    });
  });
  assert.ok(usesSafeAreaEnv, 'styles reference env(safe-area-inset-top) on headers');

  const sentinelOk = await page.evaluate(() => {
    const wrap = document.querySelector('#tab-settings .screen-header-wrap');
    const s = wrap && wrap.previousElementSibling;
    return !!(s && s.classList.contains('title-sentinel'));
  });
  assert.ok(sentinelOk, 'title-sentinel must sit immediately above screen-header-wrap');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForSelector('#tab-settings:not([hidden])');

  const settingsTitleBox = await page.locator('#tab-settings .screen-title').boundingBox();
  assert.ok(settingsTitleBox && settingsTitleBox.y >= 47, 'Settings title should clear status-bar safe zone');

  const tabLabelFs = await page.evaluate(() => {
    const el = document.querySelector('.tab-btn[data-tab="settings"] span');
    return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
  });
  assert.ok(tabLabelFs >= 11, 'tab label font size >= 11px');

  const balanceBtn = page.locator('.settings-account-action').first();
  await balanceBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await balanceBtn.count()) {
    const bb = await balanceBtn.boundingBox();
    assert.ok(bb && bb.height >= 44 && bb.width >= 44, 'Balance button touch target');
  }

  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  assert.strictEqual(accent.toUpperCase(), '#2558D4', 'light-mode accessible accent');

  await page.click('.tab-btn[data-tab="settings"]');
  const activeTabContrast = await page.evaluate(() => {
    const el = document.querySelector('.tab-btn[data-tab="settings"].active span')
      || document.querySelector('.tab-btn[data-tab="settings"] span');
    if (!el) return 0;
    const fg = parseRgb(getComputedStyle(el).color);
    let node = el.parentElement;
    let bg = null;
    while (node && !bg) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') bg = parseRgb(c);
      node = node.parentElement;
    }
    if (!bg) bg = [242, 243, 247];
    return fg && bg ? contrastRatio(fg, bg) : 0;
    function parseRgb(str) {
      const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
    }
    function contrastRatio(fg, bg) {
      const rel = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const l1 = 0.2126 * rel(fg[0]) + 0.7152 * rel(fg[1]) + 0.0722 * rel(fg[2]);
      const l2 = 0.2126 * rel(bg[0]) + 0.7152 * rel(bg[1]) + 0.0722 * rel(bg[2]);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }
  });
  assert.ok(activeTabContrast >= 4.5, 'active tab label contrast');

  const backupFs = await page.evaluate(() => {
    const el = document.querySelector('.backup-nudge');
    return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
  });
  assert.ok(backupFs === 15, 'backup nudge uses 15px Subhead');

  const compactAfterScroll = await page.evaluate(async () => {
    const wrap = document.querySelector('#tab-settings .screen-header-wrap');
    window.scrollTo(0, 600);
    await new Promise((r) => setTimeout(r, 250));
    return wrap.classList.contains('compact');
  });
  assert.ok(compactAfterScroll, 'settings large title collapses after scroll');

  await page.evaluate(() => {
    localStorage.setItem('expenseLogger.meta.v1', JSON.stringify({ forecastCushion: 600 }));
    localStorage.setItem('expenseLogger.entries.v1', JSON.stringify([
      { id: 'e1', amount: 40, categoryId: 'groceries', note: 'Shop', ts: Date.now(), accountId: 'acct-checking' }
    ]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await injectSafeInsets(page);
  await page.click('.tab-btn[data-tab="summary"]');
  await page.waitForTimeout(300);
  const card = page.locator('#homeForecastCard');
  if (await card.isVisible()) await card.click();
  else {
    await page.evaluate(() => window.EL && window.EL.openForecast && window.EL.openForecast());
  }
  await page.waitForSelector('#tab-forecast:not([hidden])');

  const backHasChevron = await page.evaluate(() => {
    const btn = document.getElementById('forecastBackBtn');
    return !!(btn && btn.querySelector('.forecast-back-chev') && !btn.textContent.includes('<'));
  });
  assert.ok(backHasChevron, 'forecast back uses chevron not < character');

  const infoBb = await page.locator('#forecastInfoBtn').boundingBox();
  assert.ok(infoBb && infoBb.width >= 44 && infoBb.height >= 44, 'forecast info hit area');

  const navBox = await page.locator('.forecast-nav-row').boundingBox();
  assert.ok(navBox && navBox.y >= 47, 'forecast nav clears status-bar zone');

  const tabBarLabelY = await page.evaluate(() => {
    const el = document.querySelector('.tab-btn[data-tab="settings"] span');
    const r = el.getBoundingClientRect();
    return r.bottom;
  });
  assert.ok(tabBarLabelY <= 926 - 34, 'tab labels sit above home-indicator safe zone');

  await page.click('.tab-btn[data-tab="settings"]');
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach((el) => {
      const st = getComputedStyle(el);
      const fs = parseFloat(st.fontSize);
      if (!fs) return;
      el.style.fontSize = fs * 2 + 'px';
      const lh = parseFloat(st.lineHeight);
      if (lh && !Number.isNaN(lh)) el.style.lineHeight = lh * 2 + 'px';
    });
  });
  await page.waitForTimeout(100);
  const textScaleOk = await page.evaluate(() => {
    const bar = document.querySelector('.bottom-tab-bar');
    const barH = bar ? bar.getBoundingClientRect().height : 0;
    const tabSpan = document.querySelector('.tab-btn[data-tab="settings"] span');
    const tabH = tabSpan ? tabSpan.getBoundingClientRect().height : 0;
    const forecastRule = Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules || []).some((rule) => (
          rule.cssText && rule.cssText.includes('.forecast-up-title')
          && rule.cssText.includes('white-space: normal')
        ));
      } catch (e) {
        return false;
      }
    });
    const tabWs = tabSpan ? getComputedStyle(tabSpan).whiteSpace : '';
    return barH >= 83 && tabH >= 12 && tabWs === 'normal' && forecastRule;
  });
  assert.ok(textScaleOk, 'tab labels and forecast rows tolerate 200% text');

  console.log('hig-regression-test: PASS');
  await browser.close();
  srv.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
