/**
 * Generates fake bank/card import fixtures (no real data).
 * Run: node scripts/make-fixtures.mjs
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { deflateRawSync } from 'zlib';

const OUT = join(process.cwd(), 'test/fixtures');
mkdirSync(OUT, { recursive: true });

// --- Credit card CSV ---
const cardCsv = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '03/15/2025,03/16/2025,RIVER CAFE,Food & Drink,Sale,-42.18,',
  '03/14/2025,03/15/2025,SAFEWAY #882,Groceries,Sale,-67.33,',
  '03/12/2025,03/13/2025,SHELL OIL 57441,Gas,Sale,-38.50,',
  '03/10/2025,03/11/2025,AMAZON MKTPLACE,Shopping,Sale,-29.99,',
  '03/08/2025,03/09/2025,Online Payment,Payment,Payment,250.00,',
  '03/05/2025,03/06/2025,TARGET STORE,Shopping,Return,15.00,',
  '03/04/2025,03/05/2025,STARBUCKS STORE 44521,Food & Drink,Sale,-6.75,',
].join('\r\n');
writeFileSync(join(OUT, 'sample-card.csv'), cardCsv, 'utf8');

// Overlapping card exports (same account, different download)
const cardPeriodA = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '04/01/2025,04/02/2025,COFFEE CORNER,Food & Drink,Sale,-5.00,',
  '04/02/2025,04/03/2025,MARKET BASKET,Groceries,Sale,-22.10,',
  '04/03/2025,04/04/2025,COFFEE CORNER,Food & Drink,Sale,-5.00,',
  '04/03/2025,04/04/2025,COFFEE CORNER,Food & Drink,Sale,-5.00,',
  '04/04/2025,04/05/2025,PHARMACY PLUS,Shopping,Sale,-18.75,',
].join('\r\n');
const cardPeriodB = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  '04/01/2025,04/02/2025,COFFEE CORNER,Food & Drink,Sale,-5.00,',
  '04/02/2025,04/03/2025,MARKET BASKET,Groceries,Sale,-22.10,',
  '04/03/2025,04/04/2025,COFFEE CORNER,Food & Drink,Sale,-5.00,',
  '04/03/2025,04/04/2025,COFFEE CORNER,Food & Drink,Sale,-5.00,',
  '04/05/2025,04/06/2025,NEW CAFE EAST,Food & Drink,Sale,-9.25,',
].join('\r\n');
writeFileSync(join(OUT, 'sample-card-period-a.csv'), cardPeriodA, 'utf8');
writeFileSync(join(OUT, 'sample-card-period-b.csv'), cardPeriodB, 'utf8');

// --- App export round-trip sample ---
const appCsv = [
  'Date,Time,Category,Amount,Note,Recurring,Receipt',
  '2025-03-01,12:00,Groceries,25.50,Test import note,No,No',
].join('\r\n');
writeFileSync(join(OUT, 'sample-app-export.csv'), appCsv, 'utf8');

function excelSerial(y, m, d) {
  const utc = Date.UTC(y, m - 1, d);
  const epoch = Date.UTC(1899, 11, 30);
  return (utc - epoch) / 86400000;
}

const bankRows = [
  ['Account Number', 'Post Date', 'Check', 'Description', 'Debit', 'Credit', 'Status', 'Balance'],
  ['', excelSerial(2025, 3, 15), '', 'VENMO           PAYMENT   WEB 1052548066311', 45, '', 'Posted', 1234.56],
  ['****1234', excelSerial(2025, 3, 14), '', 'PAYROLL DEP PPD', '', 2100, 'Posted', 1279.56],
  ['', excelSerial(2025, 3, 13), '', 'XXXXX CREDIT CRDAUTOPAY   PPD', 250, '', 'Posted', 1029.56],
  ['', excelSerial(2025, 3, 12), '', 'STUDENT LOAN PAYMENT', 180, '', 'Posted', 1279.56],
  ['', excelSerial(2025, 3, 11), '', 'Service Charge', 12, '', 'Posted', 1279.56],
  ['', excelSerial(2025, 3, 10), '', 'COFFEE SHOP DOWNTOWN', 5.25, '', 'Pending', 1291.56],
  ['', excelSerial(2025, 3, 9), '', 'WHOLE FOODS MARKET', 38.42, '', 'Posted', 1296.81],
];

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sheetXml(rows) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  xml += '<sheetData>';
  rows.forEach((row, ri) => {
    const r = ri + 1;
    xml += `<row r="${r}">`;
    row.forEach((cell, ci) => {
      const ref = String.fromCharCode(65 + ci) + r;
      if (typeof cell === 'number') {
        xml += `<c r="${ref}"><v>${cell}</v></c>`;
      } else if (cell === '') {
        xml += `<c r="${ref}"/>`;
      } else {
        xml += `<c r="${ref}" t="inlineStr"><is><t>${esc(cell)}</t></is></c>`;
      }
    });
    xml += '</row>';
  });
  // trailing empty rows (simulate bank export)
  for (let i = 0; i < 50; i++) {
    const r = rows.length + 1 + i;
    xml += `<row r="${r}"></row>`;
  }
  xml += '</sheetData></worksheet>';
  return xml;
}

const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const relsRoot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const relsWorkbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const files = {
  '[Content_Types].xml': contentTypes,
  '_rels/.rels': relsRoot,
  'xl/workbook.xml': workbookXml,
  'xl/_rels/workbook.xml.rels': relsWorkbook,
  'xl/worksheets/sheet1.xml': sheetXml(bankRows),
};

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30 + nameBuf.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    compressed.copy(local, 30 + nameBuf.length);
    parts.push(local);
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc32(data), 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt32LE(0, 34);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);
    central.push(cd);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, end]);
}

const zipEntries = Object.entries(files).map(([name, content]) => [
  name,
  Buffer.from(content, 'utf8'),
]);
writeFileSync(join(OUT, 'sample-bank.xlsx'), buildZip(zipEntries));
console.log('Wrote fixtures to', OUT);
