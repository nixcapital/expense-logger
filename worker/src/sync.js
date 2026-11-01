// Plaid /transactions/sync handling and the merge of unacknowledged updates.
import { plaidCall } from './plaid.js';

export function slimTxn(t) {
  var pfc = t.personal_finance_category || null;
  return {
    transaction_id: t.transaction_id,
    account_id: t.account_id,
    amount: t.amount,
    iso_currency_code: t.iso_currency_code || null,
    date: t.date,
    authorized_date: t.authorized_date || null,
    name: t.name || '',
    merchant_name: t.merchant_name || null,
    original_description: t.original_description || null,
    pending: !!t.pending,
    pending_transaction_id: t.pending_transaction_id || null,
    personal_finance_category: pfc ? { primary: pfc.primary || null, detailed: pfc.detailed || null } : null
  };
}

export function emptyPayload() {
  return { added: [], modified: [], removed: [] };
}

function indexOfId(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].transaction_id === id) return i;
  return -1;
}

// Fold a fresh delta into the unacknowledged payload, in Plaid's order.
export function mergePayload(state, delta) {
  var out = { added: state.added.slice(), modified: state.modified.slice(), removed: state.removed.slice() };
  delta.added.forEach(function (t) {
    var ri = indexOfId(out.removed, t.transaction_id);
    if (ri >= 0) out.removed.splice(ri, 1);
    var i = indexOfId(out.added, t.transaction_id);
    if (i >= 0) out.added[i] = t; else out.added.push(t);
  });
  delta.modified.forEach(function (t) {
    var ia = indexOfId(out.added, t.transaction_id);
    if (ia >= 0) { out.added[ia] = t; return; }
    var im = indexOfId(out.modified, t.transaction_id);
    if (im >= 0) out.modified[im] = t; else out.modified.push(t);
  });
  delta.removed.forEach(function (r) {
    var id = r.transaction_id;
    var ia = indexOfId(out.added, id);
    if (ia >= 0) { out.added.splice(ia, 1); return; } // phone never saw it
    var im = indexOfId(out.modified, id);
    if (im >= 0) out.modified.splice(im, 1);
    if (indexOfId(out.removed, id) < 0) out.removed.push({ transaction_id: id, account_id: r.account_id });
  });
  return out;
}

export function payloadIsEmpty(p) {
  return !p.added.length && !p.modified.length && !p.removed.length;
}

// One full pagination loop for one Item. Restarts from the first cursor if Plaid
// reports data changed mid-pagination. Throws the Plaid error otherwise.
export async function syncItem(env, fetchFn, accessToken, startCursor, accountMap) {
  var attempts = 0;
  for (;;) {
    attempts++;
    var cursor = startCursor;
    var delta = emptyPayload();
    var accounts = [];
    var notReady = false;
    try {
      for (;;) {
        var body = { access_token: accessToken, count: 500, options: { include_original_description: true } };
        if (cursor) body.cursor = cursor;
        var res = await plaidCall(env, fetchFn, '/transactions/sync', body);
        var keep = function (t) { return !!accountMap[t.account_id]; };
        (res.added || []).filter(keep).forEach(function (t) { if (!t.pending) delta.added.push(slimTxn(t)); });
        (res.modified || []).filter(keep).forEach(function (t) { if (!t.pending) delta.modified.push(slimTxn(t)); });
        (res.removed || []).filter(keep).forEach(function (r) {
          delta.removed.push({ transaction_id: r.transaction_id, account_id: r.account_id });
        });
        if (Array.isArray(res.accounts)) accounts = res.accounts;
        if (res.next_cursor) cursor = res.next_cursor; else notReady = true;
        if (!res.has_more) break;
      }
      return { delta: delta, cursor: cursor, accounts: accounts, notReady: notReady };
    } catch (e) {
      if (e && e.plaidCode === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempts < 3) continue;
      throw e;
    }
  }
}

// Total of pending charges per account (Plaid's `current` balance leaves them out, so the app
// adds them to a card balance it is about to anchor). Returns {account_id: total} or null if
// Plaid cannot say. Only called for cards.
export async function pendingTotals(env, fetchFn, accessToken, accountMap, nowMs) {
  try {
    var end = new Date(nowMs);
    var start = new Date(nowMs - 45 * 86400000);
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    var totals = {};
    var offset = 0;
    for (var page = 0; page < 5; page++) {
      var res = await plaidCall(env, fetchFn, '/transactions/get', {
        access_token: accessToken, start_date: iso(start), end_date: iso(end), options: { count: 500, offset: offset }
      });
      var list = res.transactions || [];
      list.forEach(function (t) {
        if (t.pending && accountMap[t.account_id]) totals[t.account_id] = (totals[t.account_id] || 0) + Number(t.amount);
      });
      offset += list.length;
      if (!list.length || offset >= (res.total_transactions || 0)) break;
    }
    Object.keys(totals).forEach(function (k) { totals[k] = Math.round(totals[k] * 100) / 100; });
    return totals;
  } catch (e) {
    return null;
  }
}

export function publicAccounts(accounts, accountMap, pending) {
  return accounts.filter(function (a) { return !!accountMap[a.account_id]; }).map(function (a) {
    var b = a.balances || {};
    return {
      account_id: a.account_id,
      appAccountId: accountMap[a.account_id],
      mask: a.mask || null,
      type: a.type || null,
      current: typeof b.current === 'number' ? b.current : null,
      available: typeof b.available === 'number' ? b.available : null,
      // credit cards only: sum of pending charges (0 if none), or null when unknown
      pendingTotal: a.type === 'credit' && pending ? (pending[a.account_id] || 0) : null
    };
  });
}
