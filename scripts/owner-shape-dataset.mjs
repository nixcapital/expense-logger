/**
 * Synthetic backup-shaped dataset (counts match owner; fake amounts/notes only).
 */
const CHECKING = 'acct-checking';
const CHASE = 'acct-chase';

function localNoon(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

function spreadTimestamps(count, startY, startM, startD, endY, endM, endD) {
  const start = localNoon(startY, startM, startD);
  const end = localNoon(endY, endM, endD);
  const span = Math.max(1, end - start);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = start + Math.floor((i * span) / Math.max(1, count - 1));
    const d = new Date(t);
    out.push(localNoon(d.getFullYear(), d.getMonth(), d.getDate()));
  }
  return out;
}

export function ownerShapeDataset() {
  const entries = [];
  const transferPairs = [];
  let id = 0;
  const nextId = () => 'own-' + (++id);

  entries.push({
    id: nextId(),
    amount: 4.25,
    note: 'ORPHAN ROW NO ACCOUNT',
    ts: localNoon(2026, 8, 3),
    categoryId: 'other'
  });

  for (let p = 0; p < 18; p++) {
    const m = (5 + p) % 12;
    const y = 2025 + Math.floor((5 + p) / 12);
    const ts = localNoon(y, m, Math.min(8 + (p % 5), 28));
    const amt = Math.round((380 + p * 13.7) * 100) / 100;
    const chkId = nextId();
    const cardId = nextId();
    entries.push({
      id: chkId,
      amount: amt,
      note: 'CHASE CREDIT CRD AUTOPAY',
      ts,
      accountId: CHECKING,
      categoryId: 'transfer',
      isTransfer: true,
      isDeposit: false
    });
    entries.push({
      id: cardId,
      amount: amt,
      note: 'Payment Thank You',
      ts,
      accountId: CHASE,
      categoryId: 'transfer',
      isTransfer: true,
      isDeposit: true
    });
    transferPairs.push({ id: 'tp-' + p, entryIds: [chkId, cardId], unlinked: false });
  }

  let transferCount = entries.filter((e) => e.isTransfer).length;
  let ti = 0;
  while (transferCount < 76) {
    const ts = localNoon(2025, 6 + (ti % 15), 2 + (ti % 20));
    const amt = 40 + ti * 2.5;
    const onChecking = ti % 2 === 0;
    entries.push({
      id: nextId(),
      amount: amt,
      note: onChecking ? 'TRANSFER TO SAVINGS' : 'CHASE ADJ TRANSFER',
      ts,
      accountId: onChecking ? CHECKING : CHASE,
      categoryId: 'transfer',
      isTransfer: true,
      transferKind: onChecking ? 'other' : undefined,
      isDeposit: onChecking && ti % 4 === 1
    });
    transferCount++;
    ti++;
  }

  spreadTimestamps(207, 2025, 5, 1, 2026, 9, 16).forEach((ts, i) => {
    entries.push({
      id: nextId(),
      amount: Math.round((6 + (i % 90) + (i % 13) * 0.41) * 100) / 100,
      note: 'CHECKING SPEND ' + (i % 52),
      ts,
      accountId: CHECKING,
      categoryId: 'other',
      isTransfer: false,
      isDeposit: false
    });
  });

  spreadTimestamps(1461, 2025, 5, 1, 2026, 9, 16).forEach((ts, i) => {
    entries.push({
      id: nextId(),
      amount: Math.round((4 + (i % 110) + (i % 9) * 0.23) * 100) / 100,
      note: 'CHASE MERCHANT ' + (i % 95),
      ts,
      accountId: CHASE,
      categoryId: 'other',
      isTransfer: false,
      isDeposit: false
    });
  });

  return {
    entries,
    transferPairs,
    accounts: [
      { id: CHECKING, name: 'Checking', type: 'bank', color: '#20C997' },
      { id: CHASE, name: 'Chase card', type: 'credit_card', color: '#748FFC' }
    ],
    stats: {
      total: entries.length,
      checking: entries.filter((e) => e.accountId === CHECKING).length,
      chase: entries.filter((e) => e.accountId === CHASE).length,
      noAccount: entries.filter((e) => !e.accountId).length,
      transfers: entries.filter((e) => e.isTransfer).length,
      incomeRows: entries.filter((e) => e.isDeposit && !e.isTransfer).length
    },
    balance: { currentBalance: 1234.56, balanceAsOf: '2026-10-16' }
  };
}
