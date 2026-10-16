/**
 * Spending Wrapped stats tests (wrapped.js).
 * Run: node scripts/wrapped-test.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import vm from 'vm';

const code = readFileSync(new URL('../wrapped.js', import.meta.url), 'utf8');
const sandbox = { window: {}, module: { exports: {} } };
vm.runInNewContext(code, sandbox);
const EW = sandbox.window.ExpenseWrapped;

const categories = [
  { id: 'dining', name: 'Dining', color: '#ff922b' },
  { id: 'groceries', name: 'Groceries', color: '#4dabf7' },
  { id: 'bills', name: 'Bills', color: '#cc5de8' },
  { id: 'gas', name: 'Gas', color: '#51cf66' },
  { id: 'fun', name: 'Fun', color: '#f783ac' },
  { id: 'other', name: 'Other', color: '#adb5bd' }
];

function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

assert.strictEqual(EW.normalizeMerchantName('STARBUCKS #1234'), 'Starbucks');
assert.strictEqual(EW.normalizeMerchantName('Starbucks Store 55'), 'Starbucks');
assert.strictEqual(EW.normalizeMerchantName('SQ * Sweetgreen NYC'), 'Sweetgreen');
assert.strictEqual(EW.normalizeMerchantName('TST* JOE\'S PIZZA'), 'Joe\'s Pizza');
assert.strictEqual(EW.normalizeMerchantName('PAYPAL * NETFLIX'), 'Netflix');

const transfer = { id: 't1', amount: 100, categoryId: 'bills', note: 'Payment', ts: ts(2026, 8, 1), isTransfer: true };
const incomeLike = { id: 'x', amount: 50, categoryId: 'other', note: 'Refund', ts: ts(2026, 8, 2), countAsSpending: false };
assert.strictEqual(EW.entryCountsAsSpending(transfer), false);
assert.strictEqual(EW.entryCountsAsSpending(incomeLike), false);

const entries = [
  { id: '1', amount: 5.61, categoryId: 'dining', note: 'STARBUCKS #4412', ts: ts(2026, 8, 2), accountId: 'acct-chase' },
  { id: '2', amount: 5.61, categoryId: 'dining', note: 'Starbucks Store 12', ts: ts(2026, 8, 5), accountId: 'acct-chase' },
  { id: '3', amount: 5.61, categoryId: 'dining', note: 'STARBUCKS', ts: ts(2026, 8, 8), accountId: 'acct-chase' },
  { id: '4', amount: 12.99, categoryId: 'fun', note: 'Spotify', ts: ts(2026, 8, 4), recurringId: 'r-spotify' },
  { id: '5', amount: 11.99, categoryId: 'fun', note: 'Spotify', ts: ts(2026, 7, 4), recurringId: 'r-spotify' },
  { id: '6', amount: 16.99, categoryId: 'fun', note: 'Max', ts: ts(2026, 8, 4), accountId: 'acct-chase' },
  { id: '7', amount: 45, categoryId: 'groceries', note: 'Trader Joe\'s', ts: ts(2026, 8, 10), accountId: 'acct-checking' },
  { id: '8', amount: 30, categoryId: 'dining', note: 'Sweetgreen', ts: ts(2026, 8, 11), accountId: 'acct-chase' },
  { id: '9', amount: 20, categoryId: 'gas', note: 'Shell', ts: ts(2026, 7, 15), accountId: 'acct-chase' },
  { id: '10', amount: 40, categoryId: 'gas', note: 'Shell', ts: ts(2026, 8, 15), accountId: 'acct-chase' },
  { id: '11', amount: 100, categoryId: 'groceries', note: 'Costco', ts: ts(2026, 6, 13), accountId: 'acct-chase' },
  { id: '12', amount: 80, categoryId: 'groceries', note: 'Costco', ts: ts(2026, 7, 13), accountId: 'acct-chase' },
  { id: '13', amount: 90, categoryId: 'groceries', note: 'Costco', ts: ts(2026, 8, 13), accountId: 'acct-chase' }
];

const budgets = { groceries: 200, gas: 100, dining: 50 };
const recurringItems = [{ id: 'r-spotify', amount: 12.99, categoryId: 'fun', dayOfMonth: 4 }];
const accounts = [
  { id: 'acct-checking', name: 'Checking', color: '#20C997' },
  { id: 'acct-chase', name: 'Chase card', color: '#748FFC' }
];

const aug = EW.buildWrappedData({
  entries, categories, budgets, recurringItems, accounts, y: 2026, m: 7
});
assert.ok(aug.slides.some((s) => s.id === 'total'));
assert.ok(!aug.slides.some((s) => s.id === 'budgets') || aug.parts.budgets);

const sep = EW.buildWrappedData({
  entries, categories, budgets, recurringItems, accounts, y: 2026, m: 8
});
assert.ok(sep.slides.find((s) => s.id === 'regulars'));
const reg = sep.parts.regulars;
assert.ok(reg.regular);
assert.strictEqual(reg.regular.name, 'Starbucks');
assert.ok(reg.regular.visits >= 3);
assert.ok(reg.newPlaces.includes('Sweetgreen'));
assert.ok(sep.parts.recurring);
const newCharge = sep.parts.recurring.worthLook.find((w) => w.type === 'new');
assert.ok(newCharge && newCharge.item.name === 'Max');
const priceUp = sep.parts.recurring.worthLook.find((w) => w.type === 'priceUp');
assert.ok(priceUp && priceUp.item.name === 'Spotify');

const oneMonthOnly = EW.buildWrappedData({
  entries: [{ id: 'a', amount: 10, categoryId: 'dining', note: 'Cafe', ts: ts(2026, 8, 1) }],
  categories,
  budgets: {},
  recurringItems: [],
  accounts: [],
  y: 2026,
  m: 8
});
assert.strictEqual(oneMonthOnly.parts.total.compare, false);
assert.strictEqual(oneMonthOnly.parts.total.vsLast, null);

const noBudgets = EW.buildWrappedData({
  entries, categories, budgets: {}, recurringItems, accounts, y: 2026, m: 8
});
assert.strictEqual(noBudgets.parts.budgets, null);
assert.ok(!noBudgets.slides.some((s) => s.id === 'budgets'));

const spendingOnly = EW.monthTotal(
  [transfer, { id: 's', amount: 25, categoryId: 'dining', note: 'Lunch', ts: ts(2026, 8, 3) }],
  2026,
  8
);
assert.strictEqual(spendingOnly, 25);

console.log('wrapped-test: PASS');
