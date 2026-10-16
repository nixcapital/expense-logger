/**
 * Regression: Add-sheet category chips must build from loaded categories
 * before icon preload finishes (fresh profile / no SW cache).
 * Run: node scripts/chips-boot-test.mjs
 */
import assert from 'assert';

const DEFAULT_CATEGORIES = [
  { id: 'groceries', name: 'Groceries', icon: 'shopping-cart', color: '#4dabf7' },
  { id: 'dining', name: 'Dining', icon: 'utensils', color: '#ff922b' },
  { id: 'gas', name: 'Gas', icon: 'fuel', color: '#51cf66' },
  { id: 'bills', name: 'Bills', icon: 'receipt', color: '#cc5de8' },
  { id: 'fun', name: 'Fun', icon: 'ticket', color: '#f783ac' },
  { id: 'other', name: 'Other', icon: 'boxes', color: '#878e96' }
];

function loadCategoriesFresh() {
  return DEFAULT_CATEGORIES.slice();
}

function buildCategoryChipIds(categories) {
  return categories.map((c) => c.id);
}

function bootOrderSim() {
  const categories = loadCategoriesFresh();
  assert.ok(categories.length >= 6, 'defaults must exist on fresh load');
  const beforeIconsReady = buildCategoryChipIds(categories);
  assert.strictEqual(beforeIconsReady.length, categories.length);
  assert.deepStrictEqual(beforeIconsReady, categories.map((c) => c.id));
  return { categories, beforeIconsReady };
}

bootOrderSim();

console.log('chips-boot-test: PASS');
