/**
 * Icon resolution tests (mirrors icon-system.js).
 * Run: node scripts/icon-test.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const DEFAULT_ICON_BY_CAT = {
  groceries: 'shopping-cart',
  dining: 'utensils',
  gas: 'fuel',
  bills: 'receipt',
  fun: 'ticket',
  other: 'boxes'
};

const LETTER_ID = 'letter';
const ALIASES = { 'circle-dot': 'boxes', heart: 'health' };

function canonical(id) {
  return ALIASES[id] || id;
}

function resolveIconId(cat) {
  if (!cat) return 'boxes';
  if (cat.icon === LETTER_ID) return LETTER_ID;
  const known = new Set([
    ...Object.values(DEFAULT_ICON_BY_CAT),
    'car', 'home', 'health', 'bag', 'coffee', 'gift', 'plane', 'phone', 'pets', 'education',
    'circle-dot', 'heart'
  ]);
  if (cat.icon && known.has(cat.icon)) return canonical(cat.icon);
  if (DEFAULT_ICON_BY_CAT[cat.id]) return DEFAULT_ICON_BY_CAT[cat.id];
  return LETTER_ID;
}

assert.strictEqual(resolveIconId({ id: 'groceries', name: 'Groceries' }), 'shopping-cart');
assert.strictEqual(resolveIconId({ id: 'dining', name: 'Dining', icon: 'coffee' }), 'coffee');
assert.strictEqual(resolveIconId({ id: 'custom-cat', name: 'Pets' }), LETTER_ID);
assert.strictEqual(resolveIconId({ id: 'other', name: 'Other' }), 'boxes');
assert.strictEqual(resolveIconId({ id: 'x', name: 'X', icon: 'circle-dot' }), 'boxes');

const manifest = JSON.parse(readFileSync(join(root, 'icons/icons.json'), 'utf8'));
assert.ok(Array.isArray(manifest) && manifest.length >= 20);
for (const id of ['shopping-cart', 'ticket', 'pets', 'education', 'boxes']) {
  const svg = readFileSync(join(root, 'icons', id + '.svg'), 'utf8');
  assert.ok(svg.includes('viewBox="0 0 24 24"'), id);
  assert.ok(svg.includes('data-part'), id);
  assert.ok(svg.includes('currentColor'), id);
}

console.log('icon-test.mjs: OK (' + manifest.length + ' icons in manifest)');
