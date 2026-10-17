/**
 * Fake data for Chase balance owed screenshots & tests (story: Oct 16 2026).
 */
export const CHECKING = 'acct-checking';
export const CHASE = 'acct-chase';
export const FIXTURE_NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();

export function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

export function buildChaseBalanceFixture() {
  const entries = [];
  const transferPairs = [];
  const push = (e) => entries.push(e);

  push({
    id: 'pay-b',
    amount: 2410.55,
    categoryId: 'bills',
    note: 'CHASE CREDIT CRD AUTOPAY',
    ts: ts(2026, 9, 3),
    isTransfer: true,
    accountId: CHECKING
  });
  push({
    id: 'pay-c',
    amount: 2410.55,
    categoryId: 'bills',
    note: 'Payment Thank You',
    ts: ts(2026, 9, 3),
    isTransfer: true,
    accountId: CHASE,
    isDeposit: true
  });
  transferPairs.push({
    id: 'tp-oct',
    entryIds: ['pay-b', 'pay-c'],
    auto: true,
    unlinked: false,
    createdAt: FIXTURE_NOW
  });

  [[2026, 5, 3], [2026, 6, 3], [2026, 7, 3], [2026, 8, 3]].forEach(([y, m, d], i) => {
    const amt = 1905.2 - i * 120;
    const bId = 'hist-b' + i;
    const cId = 'hist-c' + i;
    push({
      id: bId,
      amount: amt,
      categoryId: 'bills',
      note: 'CHASE CREDIT CRD AUTOPAY',
      ts: ts(y, m, d),
      isTransfer: true,
      accountId: CHECKING
    });
    push({
      id: cId,
      amount: amt,
      categoryId: 'bills',
      note: 'Payment Thank You',
      ts: ts(y, m, d - 1),
      isTransfer: true,
      accountId: CHASE,
      isDeposit: true
    });
    transferPairs.push({
      id: 'tp-h' + i,
      entryIds: [bId, cId],
      auto: true,
      unlinked: false,
      createdAt: FIXTURE_NOW
    });
  });

  const namedPurchases = [
    [7.75, 'Blue Bottle Coffee', 16, 'dining'],
    [84.12, "Trader Joe's", 15, 'groceries'],
    [41.85, 'Shell', 13, 'gas']
  ];
  namedPurchases.forEach(([amt, note, day, cat], i) => {
    push({
      id: 'p' + i,
      amount: amt,
      categoryId: cat,
      note,
      ts: ts(2026, 9, day),
      accountId: CHASE
    });
  });
  const targetPurchases = 1312.42;
  let purchaseSum = namedPurchases.reduce((s, x) => s + x[0], 0);
  const remainder = Math.round((targetPurchases - purchaseSum) * 100) / 100;
  const extraCount = 11;
  let allocated = 0;
  for (let i = 0; i < extraCount; i++) {
    const isLast = i === extraCount - 1;
    const amt = isLast
      ? Math.round((remainder - allocated) * 100) / 100
      : Math.round((remainder / extraCount) * 100) / 100;
    allocated += amt;
    push({
      id: 'px' + i,
      amount: amt,
      categoryId: 'dining',
      note: 'Card purchase ' + (i + 1),
      ts: ts(2026, 9, 4 + (i % 12)),
      accountId: CHASE
    });
    purchaseSum += amt;
  }

  push({
    id: 'ref',
    amount: -28.25,
    categoryId: 'other',
    note: 'Amazon refund',
    ts: ts(2026, 9, 14),
    accountId: CHASE
  });

  push({
    id: 'disc',
    amount: 412.5,
    categoryId: 'bills',
    note: 'DISCOVER E-PAYMENT',
    ts: ts(2026, 9, 18),
    isTransfer: true,
    accountId: CHECKING
  });

  const accounts = [
    {
      id: CHECKING,
      name: 'Checking',
      type: 'bank',
      color: '#20C997',
      currentBalance: 3560,
      balanceAsOf: '2026-10-16'
    },
    {
      id: CHASE,
      name: 'Chase card',
      type: 'credit_card',
      color: '#748FFC',
      currentBalance: 2410.55,
      balanceAsOf: '2026-10-01'
    }
  ];

  return {
    accounts,
    entries,
    transferPairs,
    purchaseSum
  };
}

export function fixtureStoragePayload() {
  const fx = buildChaseBalanceFixture();
  return {
    mockNow: FIXTURE_NOW,
    accounts: JSON.stringify(fx.accounts),
    entries: JSON.stringify(fx.entries),
    pairs: JSON.stringify(fx.transferPairs)
  };
}
