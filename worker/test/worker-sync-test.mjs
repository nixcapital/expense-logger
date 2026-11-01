// node worker/test/worker-sync-test.mjs  (Node 22+). Fake Plaid pages only.
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { b64encode, sha256Hex } from '../src/crypto.js';
import { mergePayload, emptyPayload } from '../src/sync.js';
import { makeDb } from './helpers.mjs';

var ORIGIN = 'https://nixcapital.github.io';
var SETUP = 'fake-setup-code-1234';
var ACCESS = 'access-sandbox-FAKE-0001';
var KEY = b64encode(new Uint8Array(32).fill(9));

function tx(id, acct, amount, extra) {
  return Object.assign({
    transaction_id: id, account_id: acct, amount: amount, iso_currency_code: 'USD',
    date: '2026-10-15', authorized_date: '2026-10-14', name: 'FAKE ' + id, merchant_name: 'Fake Merchant',
    original_description: 'FAKE ORIGINAL ' + id, pending: false, pending_transaction_id: null,
    personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE', confidence_level: 'HIGH', version: 'v1' }
  }, extra || {});
}

var env = {
  DB: makeDb(), ALLOWED_ORIGIN: ORIGIN, REDIRECT_URI: ORIGIN + '/x', PLAID_ENV: 'sandbox',
  PLAID_CLIENT_ID: 'fake', PLAID_SECRET: 'fake', TOKEN_ENC_KEY: KEY, SETUP_CODE: SETUP
};

// scripted Plaid: a queue of responses per call; records requests
var script = [];
var calls = [];
function fakeFetch(url, init) {
  var body = JSON.parse(init.body);
  calls.push({ url: url, body: body });
  var next = script.shift();
  if (url.endsWith('/item/public_token/exchange')) next = { status: 200, body: { access_token: ACCESS, item_id: 'item-1' } };
  if (!next) throw new Error('unexpected Plaid call ' + url);
  return Promise.resolve({ ok: next.status === 200, status: next.status, json: function () { return Promise.resolve(next.body); } });
}
var deps = { fetch: fakeFetch, now: function () { return 5000; } };

function req(method, p, opts) {
  opts = opts || {};
  return new Request('https://w.example' + p, {
    method: method,
    headers: Object.assign({ 'Content-Type': 'application/json', Origin: ORIGIN }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
}
var ok = function (body) { return { status: 200, body: body }; };

// pair + link one Item with two accounts
var r = await handle(req('POST', '/pair', { body: { setupCode: SETUP } }), env, deps);
var token = (await r.json()).deviceToken;
var auth = { Authorization: 'Bearer ' + token };
r = await handle(req('POST', '/link/exchange', { headers: { Authorization: 'Setup ' + SETUP }, body: {
  public_token: 'public-FAKE', accountMap: { chk: 'acct-checking', crd: 'acct-chase' } } }), env, deps);
assert.equal(r.status, 200);

// pull/ack need the device token
assert.equal((await handle(req('GET', '/pull'), env, deps)).status, 401);
assert.equal((await handle(req('POST', '/ack', { body: { batchId: 'x' } }), env, deps)).status, 401);

// 1) multi-page sync: pages are merged, pending dropped, unmapped accounts ignored, only slim fields returned
script = [
  ok({ added: [tx('a1', 'chk', 12.34), tx('p1', 'crd', 5, { pending: true })], modified: [], removed: [], next_cursor: 'c1', has_more: true,
       accounts: [] }),
  ok({ added: [tx('a2', 'crd', 25), tx('x1', 'other', 99)], modified: [], removed: [], next_cursor: 'c2', has_more: false,
       accounts: [{ account_id: 'chk', mask: '0001', type: 'depository', balances: { current: 2000, available: 1990 } },
                  { account_id: 'crd', mask: '0002', type: 'credit', balances: { current: 100.5, available: 900 } },
                  { account_id: 'other', balances: { current: 1 } }] }),
  // pending charges for the card balance (card only; unmapped accounts ignored)
  ok({ transactions: [tx('q1', 'crd', 40, { pending: true }), tx('q2', 'crd', 9.5), tx('q3', 'crd', 2.25, { pending: true }), tx('q4', 'other', 7, { pending: true })], total_transactions: 4 })
];
r = await handle(req('GET', '/pull', { headers: auth }), env, deps);
assert.equal(r.status, 200);
var p1 = await r.json();
assert.deepEqual(p1.added.map(function (t) { return t.transaction_id; }), ['a1', 'a2']);
assert.equal(p1.added[0].amount, 12.34);
assert.equal(p1.added[0].original_description, 'FAKE ORIGINAL a1');
assert.equal(p1.added[0].personal_finance_category.confidence_level, undefined);
assert.ok(typeof p1.batchId === 'string' && p1.batchId.length > 10);
assert.equal(p1.accounts.length, 2);
assert.equal(p1.accounts.filter(function (a) { return a.appAccountId === 'acct-chase'; })[0].current, 100.5);
var card = p1.accounts.filter(function (a) { return a.appAccountId === 'acct-chase'; })[0];
assert.equal(card.pendingTotal, 42.25, 'pending charges summed for the card');
assert.equal(p1.accounts.filter(function (a) { return a.appAccountId === 'acct-checking'; })[0].pendingTotal, null, 'checking has no pending total');
var pc = calls.filter(function (c) { return c.url.endsWith('/transactions/get'); });
assert.equal(pc.length, 1);
assert.equal(pc[0].body.access_token, ACCESS);
// request shape: first call has no cursor, second uses c1; original description requested; count 500
assert.equal(calls[1].body.cursor, undefined);
assert.equal(calls[1].body.options.include_original_description, true);
assert.equal(calls[1].body.count, 500);
assert.equal(calls[2].body.cursor, 'c1');
assert.equal(env.DB.raw.prepare('SELECT cursor FROM items').get().cursor, 'c2');
// the plaintext access token only ever left the Worker toward Plaid
assert.equal(calls[1].body.access_token, ACCESS);
assert.equal(JSON.stringify(env.DB.raw.prepare('SELECT * FROM items').get()).includes(ACCESS), false);

// 2) unacked batch is re-served with the same id and no duplicate rows
script = [ok({ added: [], modified: [], removed: [], next_cursor: 'c2', has_more: false, accounts: [] })];
r = await handle(req('GET', '/pull', { headers: auth }), env, deps);
var p2 = await r.json();
assert.equal(p2.batchId, p1.batchId);
assert.equal(p2.added.length, 2);

// 3) new rows while unacked fold in with a new batch id; remove of a never-seen row cancels it
script = [ok({ added: [tx('a3', 'chk', 7.01)], modified: [tx('a2', 'crd', 26)], removed: [{ transaction_id: 'a1', account_id: 'chk' }],
               next_cursor: 'c3', has_more: false, accounts: [] })];
r = await handle(req('GET', '/pull', { headers: auth }), env, deps);
var p3 = await r.json();
assert.notEqual(p3.batchId, p1.batchId);
assert.deepEqual(p3.added.map(function (t) { return t.transaction_id; }).sort(), ['a2', 'a3']);
assert.equal(p3.added.filter(function (t) { return t.transaction_id === 'a2'; })[0].amount, 26);
assert.equal(p3.removed.length, 0);
assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM batches').get().n, 1);

// 4) a stale ack is refused and deletes nothing; the right ack empties the queue
r = await handle(req('POST', '/ack', { headers: auth, body: { batchId: p1.batchId } }), env, deps);
assert.equal(r.status, 409);
assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM batches').get().n, 1);
r = await handle(req('POST', '/ack', { headers: auth, body: { batchId: p3.batchId } }), env, deps);
assert.equal(r.status, 200);
assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM batches').get().n, 0);
r = await handle(req('POST', '/ack', { headers: auth, body: { batchId: p3.batchId } }), env, deps);
assert.equal(r.status, 200); // idempotent
assert.equal((await r.json()).deleted, false);

// 5) after ack, a later removal of a delivered row is reported
script = [ok({ added: [], modified: [], removed: [{ transaction_id: 'a2', account_id: 'crd' }], next_cursor: 'c4', has_more: false, accounts: [] })];
var p5 = await (await handle(req('GET', '/pull', { headers: auth }), env, deps)).json();
assert.deepEqual(p5.removed.map(function (t) { return t.transaction_id; }), ['a2']);
await handle(req('POST', '/ack', { headers: auth, body: { batchId: p5.batchId } }), env, deps);

// 6) mutation during pagination restarts from the first cursor and keeps a clean result
script = [
  ok({ added: [tx('m1', 'chk', 1)], modified: [], removed: [], next_cursor: 'm-c1', has_more: true, accounts: [] }),
  { status: 400, body: { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' } },
  ok({ added: [tx('m1', 'chk', 1), tx('m2', 'chk', 2)], modified: [], removed: [], next_cursor: 'm-c9', has_more: false, accounts: [] })
];
calls = [];
var p6 = await (await handle(req('GET', '/pull', { headers: auth }), env, deps)).json();
assert.deepEqual(p6.added.map(function (t) { return t.transaction_id; }), ['m1', 'm2']);
assert.equal(calls[2].body.cursor, 'c4'); // restarted from the Item's stored cursor, not 'm-c1'
assert.equal(env.DB.raw.prepare('SELECT cursor FROM items').get().cursor, 'm-c9');
await handle(req('POST', '/ack', { headers: auth, body: { batchId: p6.batchId } }), env, deps);

// 7) a failed Plaid call keeps the cursor and the stored batch untouched, and reports a short code
script = [{ status: 500, body: { error_code: 'INTERNAL_SERVER_ERROR', leak: 'no-secrets-here' } }];
var raw = await (await handle(req('GET', '/pull', { headers: auth }), env, deps)).text();
assert.equal(raw.includes('no-secrets-here'), false);
var p7 = JSON.parse(raw);
assert.equal(p7.errors[0].code, 'INTERNAL_SERVER_ERROR');
assert.equal(env.DB.raw.prepare('SELECT cursor FROM items').get().cursor, 'm-c9');

// 8) login required is flagged and sticks until a good sync
script = [{ status: 400, body: { error_code: 'ITEM_LOGIN_REQUIRED' } }];
var p8 = await (await handle(req('GET', '/pull', { headers: auth }), env, deps)).json();
assert.deepEqual(p8.needsReconnect, ['item-1']);
script = [{ status: 400, body: { error_code: 'ITEM_LOGIN_REQUIRED' } }];
assert.deepEqual((await (await handle(req('GET', '/pull', { headers: auth }), env, deps)).json()).needsReconnect, ['item-1']);
script = [ok({ added: [tx('n1', 'chk', 3)], modified: [], removed: [], next_cursor: 'n-c1', has_more: false, accounts: [] })];
var p8b = await (await handle(req('GET', '/pull', { headers: auth }), env, deps)).json();
assert.deepEqual(p8b.needsReconnect, []);
await handle(req('POST', '/ack', { headers: auth, body: { batchId: p8b.batchId } }), env, deps);

// 9) first sync not ready yet: empty cursor is not saved over the real one
env.DB.raw.prepare("UPDATE items SET cursor = ''").run();
script = [ok({ added: [], modified: [], removed: [], next_cursor: '', has_more: false, accounts: [] })];
var p9 = await (await handle(req('GET', '/pull', { headers: auth }), env, deps)).json();
assert.equal(p9.batchId, null);
assert.equal(p9.added.length, 0);

// 10) after every ack the server holds no transaction rows
assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM batches').get().n, 0);

// pure merge cases
var m = mergePayload({ added: [], modified: [tx('z', 'chk', 1)], removed: [] }, { added: [], modified: [], removed: [{ transaction_id: 'z', account_id: 'chk' }] });
assert.equal(m.modified.length, 0);
assert.deepEqual(m.removed.map(function (t) { return t.transaction_id; }), ['z']);
m = mergePayload(emptyPayload(), { added: [], modified: [tx('y', 'chk', 4)], removed: [] });
assert.equal(m.modified.length, 1);

console.log('worker-sync-test: ok');
