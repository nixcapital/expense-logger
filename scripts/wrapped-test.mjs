/**
 * Spending Wrapped stats tests (wrapped.js).
 * Run: node scripts/wrapped-test.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import vm from 'vm';

const forecastCode = readFileSync(new URL('../forecast.js', import.meta.url), 'utf8');
const wrappedCode = readFileSync(new URL('../wrapped.js', import.meta.url), 'utf8');
const sandbox = { window: {}, globalThis: {}, module: { exports: {} } };
sandbox.globalThis = sandbox;
vm.runInNewContext(forecastCode, sandbox);
vm.runInNewContext(wrappedCode, sandbox);
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
assert.strictEqual(EW.canonicalMerchantKey('Blue Bottle Coffee'), EW.canonicalMerchantKey('Blue Bottle'));
assert.strictEqual(EW.normalizeMerchantName('Blue Bottle Coffee'), 'Blue Bottle');

const transfer = { id: 't1', amount: 100, categoryId: 'bills', note: 'Payment', ts: ts(2026, 8, 1), isTransfer: true };
const incomeLike = { id: 'x', amount: 50, categoryId: 'other', note: 'Refund', ts: ts(2026, 8, 2), countAsSpending: false };
assert.strictEqual(EW.entryCountsAsSpending(transfer), false);
assert.strictEqual(EW.entryCountsAsSpending(incomeLike), false);

const paycheckDeposit = {
  id: 'pay',
  amount: 3200,
  categoryId: 'income',
  note: 'Paycheck',
  ts: ts(2026, 9, 1),
  isDeposit: true
};
const groceriesSpend = {
  id: 'groc',
  amount: 42.1,
  categoryId: 'groceries',
  note: 'Groceries',
  ts: ts(2026, 9, 5)
};
const xfer = {
  id: 'xfer',
  amount: 500,
  categoryId: 'bills',
  note: 'Transfer',
  ts: ts(2026, 9, 10),
  isTransfer: true
};
const zeroDeposit = {
  id: 'zdep',
  amount: 0,
  categoryId: 'income',
  note: 'Zero',
  ts: ts(2026, 9, 2),
  isDeposit: true
};
assert.strictEqual(EW.entryCountsAsSpending(paycheckDeposit), false);
assert.strictEqual(EW.entryCountsAsSpending(xfer), false);
assert.strictEqual(EW.entryCountsAsSpending(groceriesSpend), true);
assert.strictEqual(EW.entryCountsAsSpending(zeroDeposit), false);
const depositMonthTotal = EW.monthTotal(
  [paycheckDeposit, groceriesSpend, xfer, zeroDeposit],
  2026,
  9
);
assert.strictEqual(depositMonthTotal, 42.1);

const entries = [
  { id: '1', amount: 5.61, categoryId: 'dining', note: 'STARBUCKS #4412', ts: ts(2026, 8, 2), accountId: 'acct-chase' },
  { id: '2', amount: 5.61, categoryId: 'dining', note: 'Starbucks Store 12', ts: ts(2026, 8, 5), accountId: 'acct-chase' },
  { id: '3', amount: 5.61, categoryId: 'dining', note: 'STARBUCKS', ts: ts(2026, 8, 8), accountId: 'acct-chase' },
  { id: '4', amount: 12.99, categoryId: 'fun', note: 'Spotify', ts: ts(2026, 8, 4), recurringId: 'r-spotify' },
  { id: '5', amount: 11.99, categoryId: 'fun', note: 'Spotify', ts: ts(2026, 7, 4), recurringId: 'r-spotify' },
  { id: '6', amount: 16.99, categoryId: 'fun', note: 'Max', ts: ts(2026, 8, 4), accountId: 'acct-chase', recurringId: 'r-max' },
  { id: '7', amount: 45, categoryId: 'groceries', note: 'Trader Joe\'s', ts: ts(2026, 8, 10), accountId: 'acct-checking' },
  { id: '8', amount: 30, categoryId: 'dining', note: 'Sweetgreen', ts: ts(2026, 8, 11), accountId: 'acct-chase' },
  { id: '8b', amount: 4.5, categoryId: 'dining', note: 'Blue Bottle Coffee', ts: ts(2026, 8, 12), accountId: 'acct-chase' },
  { id: '8c', amount: 4.75, categoryId: 'dining', note: 'Blue Bottle', ts: ts(2026, 8, 18), accountId: 'acct-chase' },
  { id: '9', amount: 20, categoryId: 'gas', note: 'Shell', ts: ts(2026, 7, 15), accountId: 'acct-chase' },
  { id: '10', amount: 40, categoryId: 'gas', note: 'Shell', ts: ts(2026, 8, 15), accountId: 'acct-chase' },
  { id: '11', amount: 100, categoryId: 'groceries', note: 'Costco', ts: ts(2026, 6, 13), accountId: 'acct-chase' },
  { id: '12', amount: 80, categoryId: 'groceries', note: 'Costco', ts: ts(2026, 7, 13), accountId: 'acct-chase' },
  { id: '13', amount: 90, categoryId: 'groceries', note: 'Costco', ts: ts(2026, 8, 13), accountId: 'acct-chase' }
];

const budgets = { groceries: 200, gas: 100, dining: 50 };
const recurringItems = [
  { id: 'r-spotify', amount: 12.99, categoryId: 'fun', dayOfMonth: 4, name: 'Spotify' },
  { id: 'r-max', amount: 16.99, categoryId: 'fun', dayOfMonth: 4, name: 'Max' }
];
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
assert.ok(!reg.newPlaces.some((n) => /starbucks/i.test(n)));
assert.strictEqual(reg.newPlaces.filter((n) => /blue bottle/i.test(n)).length, 1);
assert.ok(sep.parts.recurring);
const newCharge = sep.parts.recurring.worthLook.find((w) => w.type === 'new');
assert.ok(newCharge && newCharge.item.name === 'Max');
const priceUp = sep.parts.recurring.worthLook.find((w) => w.type === 'priceUp');
assert.ok(priceUp && priceUp.item.name === 'Spotify');

const schedules = EW.detectWrappedRecurringSchedules(entries, recurringItems);
assert.ok(!schedules.some((s) => /starbucks/i.test(s.name || s.key)));
assert.ok(schedules.length <= 8);

const coffeeOnly = [
  { id: 'c1', amount: 6.06, categoryId: 'dining', note: 'STARBUCKS #1', ts: ts(2026, 5, 3) },
  { id: 'c2', amount: 6.06, categoryId: 'dining', note: 'STARBUCKS #2', ts: ts(2026, 6, 5) },
  { id: 'c3', amount: 6.06, categoryId: 'dining', note: 'STARBUCKS #3', ts: ts(2026, 7, 7) },
  { id: 'c4', amount: 6.06, categoryId: 'dining', note: 'STARBUCKS #4', ts: ts(2026, 8, 2) },
  { id: 'c5', amount: 6.06, categoryId: 'dining', note: 'STARBUCKS #5', ts: ts(2026, 8, 9) },
  { id: 'c6', amount: 6.06, categoryId: 'dining', note: 'STARBUCKS #6', ts: ts(2026, 8, 16) }
];
assert.strictEqual(EW.detectWrappedRecurringSchedules(coffeeOnly, []).length, 0);
const coffeeRecur = EW.computeRecurringSlide(coffeeOnly, categories, [], 2026, 7);
assert.strictEqual(coffeeRecur, null);

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
