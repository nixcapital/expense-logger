/**
 * Fake checking fixture for forecast 1.6.4 regression (patterns from owner diagnosis).
 */
export const CHECKING = 'acct-checking';
export const CHASE = 'acct-chase';

export function ts(y, m, d) {
  return new Date(y, m, d, 12, 0, 0).getTime();
}

export const FIXTURE_NOW = ts(2026, 9, 16);

function entry(id, amount, note, dayTs, extra) {
  return Object.assign({
    id: id,
    amount: amount,
    note: note,
    ts: dayTs,
    accountId: CHECKING,
    categoryId: 'bills',
    isTransfer: false
  }, extra || {});
}

export function buildForecastFixture164(opts) {
  opts = opts || {};
  const withIncome = !!opts.withIncome;
  const entries = [];
  const transferPairs = [];
  let n = 0;
  const id = () => 'fx164-' + (++n);

  function monthlies(note, dom, amounts, startY, startM, count, cat) {
    for (let i = 0; i < count; i++) {
      const m = startM + i;
      const y = startY + Math.floor(m / 12);
      const mo = m % 12;
      const amt = amounts[Math.min(i, amounts.length - 1)];
      entries.push(entry(id(), amt, note, ts(y, mo, dom), { categoryId: cat || 'bills' }));
    }
  }

  // Mortgage: $930 through Jun 2026, then $1117 (1st)
  const mortMonths = [
    [2026, 0, 930], [2026, 1, 930], [2026, 2, 930], [2026, 3, 930], [2026, 4, 930], [2026, 5, 930],
    [2026, 6, 1117], [2026, 7, 1117], [2026, 8, 1117], [2026, 9, 1117]
  ];
  mortMonths.forEach(([y, mo, amt]) => {
    entries.push(entry(id(), amt, 'WF HOME MORTGAGE', ts(y, mo, 1)));
  });

  // Car loan 12th + extra principal
  for (let i = 0; i < 10; i++) {
    const mo = (3 + i) % 12;
    const yr = 2026 + Math.floor((3 + i) / 12);
    entries.push(entry(id(), 385, 'TOYOTA FIN SERVICES', ts(yr, mo, 12)));
  }
  entries.push(entry(id(), 500, 'TOYOTA FIN SERVICES', ts(2026, 5, 20)));
  entries.push(entry(id(), 600, 'TOYOTA FIN SERVICES', ts(2026, 7, 18)));

  // Tuition 15th + odd small payments
  monthlies('STATE UNIV TUITION', 15, [450], 2026, 3, 7);
  entries.push(entry(id(), 25, 'STATE UNIV TUITION', ts(2026, 6, 22)));
  entries.push(entry(id(), 40, 'STATE UNIV TUITION', ts(2026, 8, 3)));

  // Student loan with one double payment
  monthlies('NELNET STUDENT LN', 8, [220], 2026, 3, 7);
  entries.push(entry(id(), 440, 'NELNET STUDENT LN', ts(2026, 6, 8)));

  // Semiannual insurance (Apr & Oct)
  [[2025, 3, 1], [2025, 9, 1], [2026, 3, 1], [2026, 9, 1]].forEach(([y, mo, d]) => {
    entries.push(entry(id(), 640, 'STATE FARM INSURANCE', ts(y, mo, d)));
  });

  // Phone bill rising $160 -> $166
  monthlies('VERIZON WIRELESS', 5, [160, 160, 160, 166, 166, 166, 166], 2026, 3, 7);

  // Stale gym — last payment ~4 months ago
  entries.push(entry(id(), 48, 'PLANET FITNESS', ts(2026, 4, 2)));
  entries.push(entry(id(), 48, 'PLANET FITNESS', ts(2026, 5, 2)));

  // One-off
  entries.push(entry(id(), 2300, 'HOME DEPOT #1234', ts(2026, 8, 9)));

  // Other-account transfer (already flagged)
  entries.push(entry(id(), 715, 'Trsf to Checking', ts(2026, 7, 1), {
    isTransfer: true,
    transferKind: 'other',
    categoryId: 'transfer'
  }));

  // Discover e-payment (unpaired transfer out)
  for (let i = 0; i < 8; i++) {
    const mo = (2 + i) % 12;
    const yr = 2026 + Math.floor((2 + i) / 12);
    entries.push(entry(id(), 412.5, 'DISCOVER E-PAYMENT', ts(yr, mo, 18), {
      isTransfer: true,
      categoryId: 'transfer'
    }));
  }

  // Chase card autopay ~$3500 on 14th (paired)
  for (let i = 0; i < 8; i++) {
    const mo = (2 + i) % 12;
    const yr = 2026 + Math.floor((2 + i) / 12);
    const amt = 3488 + i * 12;
    const bId = id();
    const cId = id();
    const bts = ts(yr, mo, 14);
    entries.push(entry(bId, amt, 'CHASE CREDIT CRD AUTOPAY', bts, { isTransfer: true, categoryId: 'transfer' }));
    entries.push({
      id: cId,
      amount: amt,
      note: 'Payment Thank You',
      ts: ts(yr, mo, 13),
      accountId: CHASE,
      categoryId: 'transfer',
      isTransfer: true,
      isDeposit: true
    });
    transferPairs.push({ id: 'tp-' + i, entryIds: [bId, cId], unlinked: false });
  }

  // Everyday debits
  const venmoDays = [4, 11, 19, 27, 35, 42, 50, 58, 66, 72];
  venmoDays.forEach((off, i) => {
    entries.push(entry(id(), 8 + (i % 5) * 3, 'VENMO PAYMENT', ts(2026, 7, 1) + off * 86400000, { categoryId: 'dining' }));
  });
  entries.push(entry(id(), 14.2, 'SQ *COFFEE', ts(2026, 9, 10), { categoryId: 'dining' }));
  entries.push(entry(id(), 22.5, 'TARGET DEBIT', ts(2026, 9, 5), { categoryId: 'groceries' }));

  if (withIncome) {
    const pay = [ts(2026, 8, 5), ts(2026, 8, 19), ts(2026, 9, 2), ts(2026, 9, 16), ts(2026, 9, 30)];
    pay.forEach((t, i) => {
      entries.push(entry(id(), 2100, 'ACME CORP PAYROLL', t, { isDeposit: true, categoryId: 'income' }));
    });
  }

  return {
    nowMs: FIXTURE_NOW,
    balance: opts.balance != null ? opts.balance : 3500,
    entries,
    transferPairs,
    checkingId: CHECKING,
    chaseId: CHASE
  };
}
