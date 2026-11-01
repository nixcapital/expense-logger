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

export function publicAccounts(accounts, accountMap) {
  return accounts.filter(function (a) { return !!accountMap[a.account_id]; }).map(function (a) {
    var b = a.balances || {};
    return {
      account_id: a.account_id,
      appAccountId: accountMap[a.account_id],
      mask: a.mask || null,
      type: a.type || null,
      current: typeof b.current === 'number' ? b.current : null,
      available: typeof b.available === 'number' ? b.available : null
    };
  });
}
