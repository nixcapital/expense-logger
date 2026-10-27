/**
 * CSV export: formula guard, quoting, BOM, no TOTAL row.
 * Fake entries only. Run: node scripts/csv-export-test.mjs
 */
import assert from 'assert';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = 8907;
const ROOT = process.env.EL_ROOT || '/workspace';
const VIEWPORT = { width: 428, height: 926 };

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const CATEGORIES = [
  { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
  { id: 'cafe', name: 'Café', icon: 'coffee', color: '#fab005' },
  { id: 'formula', name: '=Hidden', icon: 'boxes', color: '#adb5bd' },
  { id: 'food', name: 'Food, drink', icon: 'utensils', color: '#ff922b' }
];

const DAY = new Date(2026, 0, 15, 8, 0, 0, 0).getTime();

function at(minute) {
  return DAY + minute * 60000;
}

/** Raw notes and the exact CSV cells export must produce. */
const CASES = [
  { id: 'formula-eq', minute: 1, categoryId: 'groceries', amount: 10, note: '=SUM(1+1)', categoryCell: 'Groceries', noteCell: "'=SUM(1+1)" },
  { id: 'formula-minus', minute: 2, categoryId: 'groceries', amount: 5, note: '-5 refund', categoryCell: 'Groceries', noteCell: "'-5 refund" },
  { id: 'formula-plus', minute: 3, categoryId: 'groceries', amount: 1, note: '+1', categoryCell: 'Groceries', noteCell: "'+1" },
  { id: 'formula-at', minute: 4, categoryId: 'groceries', amount: 2, note: '@a', categoryCell: 'Groceries', noteCell: "'@a" },
  { id: 'formula-tab', minute: 5, categoryId: 'groceries', amount: 3, note: '\tpayee', categoryCell: 'Groceries', noteCell: "'\tpayee" },
  { id: 'comma', minute: 6, categoryId: 'groceries', amount: 4.5, note: 'alpha, beta', categoryCell: 'Groceries', noteCell: '"alpha, beta"' },
  { id: 'quote', minute: 7, categoryId: 'groceries', amount: 6, note: 'say "hi"', categoryCell: 'Groceries', noteCell: '"say ""hi"""' },
  { id: 'newline', minute: 8, categoryId: 'groceries', amount: 7, note: 'line1\nline2', categoryCell: 'Groceries', noteCell: '"line1\nline2"' },
  { id: 'emoji', minute: 9, categoryId: 'cafe', amount: 8, note: 'coffee ☕', categoryCell: 'Café', noteCell: 'coffee ☕' },
  { id: 'negative-amount', minute: 10, categoryId: 'groceries', amount: -12.5, note: 'refund', categoryCell: 'Groceries', noteCell: 'refund' },
  { id: 'spaces', minute: 11, categoryId: 'groceries', amount: 9, note: '  padded  ', categoryCell: 'Groceries', noteCell: '"  padded  "' },
  { id: 'formula-category', minute: 12, categoryId: 'formula', amount: 1.25, note: 'ok', categoryCell: "'=Hidden", noteCell: 'ok' },
  { id: 'formula-cr', minute: 13, categoryId: 'groceries', amount: 1.5, note: '\rhidden', categoryCell: 'Groceries', noteCell: '"\'\rhidden"' },
  { id: 'formula-comma', minute: 14, categoryId: 'groceries', amount: 2.5, note: '=SUM(1,2)', categoryCell: 'Groceries', noteCell: '"\'=SUM(1,2)"' },
  { id: 'category-comma', minute: 15, categoryId: 'food', amount: 3.25, note: 'ok', categoryCell: '"Food, drink"', noteCell: 'ok' }
];

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function expectedCsv() {
  const header = ['Date', 'Time', 'Category', 'Amount', 'Note', 'Recurring', 'Receipt'].join(',');
  const rows = CASES.map((c) => {
    const d = new Date(at(c.minute));
    const dateStr = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    const timeStr = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return [dateStr, timeStr, c.categoryCell, c.amount.toFixed(2), c.noteCell, 'No', 'No'].join(',');
  });
  return '\uFEFF' + [header].concat(rows).join('\r\n');
}

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

async function run() {
  const httpServer = server();
  await new Promise((resolve) => httpServer.listen(PORT, resolve));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.addInitScript(() => {
    window.__elExport = { blobs: [], files: [], downloads: [], shares: [] };
    const NativeBlob = window.Blob;
    const NativeFile = window.File;
    function PatchedBlob(parts, options) {
      const blob = new NativeBlob(parts, options);
      const type = options && options.type ? String(options.type) : '';
      if (type.indexOf('csv') !== -1) window.__elExport.blobs.push(blob);
      return blob;
    }
    PatchedBlob.prototype = NativeBlob.prototype;
    window.Blob = PatchedBlob;

    function PatchedFile(parts, name, options) {
      const file = new NativeFile(parts, name, options);
      window.__elExport.files.push({ name: file.name, type: file.type });
      return file;
    }
    PatchedFile.prototype = NativeFile.prototype;
    window.File = PatchedFile;

    const nav = window.navigator;
    nav.share = function (data) {
      const files = (data && data.files) || [];
      window.__elExport.shares.push(files.map((f) => ({ name: f.name, type: f.type })));
      return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    };

    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        window.__elExport.downloads.push(this.download);
        return;
      }
      return origClick.apply(this, arguments);
    };
  });

  try {
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle' });
    const entries = CASES.map((c) => ({
      id: c.id,
      amount: c.amount,
      categoryId: c.categoryId,
      note: c.note,
      ts: at(c.minute)
    }));
    await page.evaluate(({ categories, rows }) => {
      localStorage.setItem('expenseLogger.categories.v1', JSON.stringify(categories));
      localStorage.setItem('expenseLogger.entries.v1', JSON.stringify(rows));
    }, { categories: CATEGORIES, rows: entries });
    await page.reload({ waitUntil: 'networkidle' });
    await page.click('button[data-tab="settings"]');
    await page.click('#exportBtn');
    await page.waitForFunction(() => {
      const cap = window.__elExport;
      return cap && cap.blobs.length > 0 && cap.files.length > 0 && cap.downloads.length > 0;
    });

    const captured = await page.evaluate(async () => {
      const blob = window.__elExport.blobs[0];
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return {
        text: await blob.text(),
        type: blob.type,
        bom: [bytes[0], bytes[1], bytes[2]],
        files: window.__elExport.files,
        downloads: window.__elExport.downloads,
        shares: window.__elExport.shares
      };
    });

    const expected = expectedCsv();
    if (captured.text !== expected) {
      console.error('ACTUAL ' + JSON.stringify(captured.text));
      console.error('EXPECTED ' + JSON.stringify(expected));
    }
    assert.strictEqual(captured.text, expected);
    assert.strictEqual(captured.text.charCodeAt(0), 0xFEFF);
    assert.deepStrictEqual(captured.bom, [0xEF, 0xBB, 0xBF]);
    assert.ok(!captured.text.includes('TOTAL'), 'export must not include a TOTAL row');
    assert.ok(!captured.text.includes('\r\n\r\n'), 'export must not include the blank line before TOTAL');
    assert.ok(captured.text.includes(',-12.50,'));
    assert.ok(!captured.text.includes("'-12.50"));
    assert.ok(!captured.text.includes('"-12.50"'));

    const body = captured.text.slice(1).split('\r\n');
    const neg = body.find((line) => line.includes(',-12.50,'));
    assert.ok(neg, 'negative amount row');
    assert.strictEqual(neg.split(',')[3], '-12.50');

    assert.strictEqual(captured.type, 'text/csv;charset=utf-8');
    assert.strictEqual(captured.files.length, 1);
    assert.strictEqual(captured.files[0].type, 'text/csv');
    assert.match(captured.files[0].name, /^expenses-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.deepStrictEqual(captured.downloads, [captured.files[0].name]);
    if (captured.shares.length) {
      assert.strictEqual(captured.shares[0][0].name, captured.files[0].name);
      assert.strictEqual(captured.shares[0][0].type, 'text/csv');
    }

    assert.deepStrictEqual(errors, []);
    console.log('csv-export-test: PASS');
  } finally {
    await browser.close();
    httpServer.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
