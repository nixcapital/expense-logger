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
  other: 'circle-dot'
};

const LETTER_ID = 'letter';

function resolveIconId(cat) {
  if (!cat) return 'circle-dot';
  if (cat.icon === LETTER_ID) return LETTER_ID;
  const known = new Set([
    ...Object.values(DEFAULT_ICON_BY_CAT),
    'car', 'bag', 'coffee', 'home', 'heart', 'plane', 'gift', 'phone',
    'wrench', 'gamepad', 'book', 'ui-note', 'ui-calendar'
  ]);
  if (cat.icon && known.has(cat.icon)) return cat.icon;
  if (DEFAULT_ICON_BY_CAT[cat.id]) return DEFAULT_ICON_BY_CAT[cat.id];
  return LETTER_ID;
}

assert.strictEqual(resolveIconId({ id: 'groceries', name: 'Groceries' }), 'shopping-cart');
assert.strictEqual(resolveIconId({ id: 'dining', name: 'Dining', icon: 'coffee' }), 'coffee');
assert.strictEqual(resolveIconId({ id: 'custom-cat', name: 'Pets' }), LETTER_ID);
assert.strictEqual(resolveIconId({ id: 'custom-cat', name: 'Pets', icon: LETTER_ID }), LETTER_ID);
assert.strictEqual(resolveIconId({ id: 'other', name: 'Other' }), 'circle-dot');

const manifest = JSON.parse(readFileSync(join(root, 'icons/icons.json'), 'utf8'));
assert.ok(Array.isArray(manifest) && manifest.length >= 20);
for (const id of manifest) {
  const svg = join(root, 'icons', id + '.svg');
  assert.ok(readFileSync(svg, 'utf8').includes('PLACEHOLDER'), `expected placeholder marker in ${id}.svg`);
}

console.log('icon-test.mjs: OK (' + manifest.length + ' icons in manifest)');
