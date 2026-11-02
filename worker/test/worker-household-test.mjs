// node worker/test/worker-household-test.mjs  (Node 22+; fake data only)
import assert from 'node:assert/strict';
import { handle } from '../src/index.js';
import { b64encode } from '../src/crypto.js';
import { makeDb } from './helpers.mjs';

var ORIGIN = 'https://nixcapital.github.io';
var SETUP = 'fake-setup-code-1234';
var HOUSE = 'fake-household-code-5678';
var env = {
  DB: makeDb(), ALLOWED_ORIGIN: ORIGIN, REDIRECT_URI: ORIGIN + '/x', PLAID_ENV: 'sandbox',
  PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', TOKEN_ENC_KEY: b64encode(new Uint8Array(32).fill(7)),
  SETUP_CODE: SETUP, HOUSEHOLD_CODE: HOUSE
};
var now = 1000;
var deps = { fetch: function () { throw new Error('no network'); }, now: function () { return now; } };

function req(method, p, o) {
  o = o || {};
  var headers = { 'Content-Type': 'application/json' };
  if (o.token) headers['Authorization'] = 'Bearer ' + o.token;
  if (o.origin !== null && !o.noOrigin) headers['Origin'] = ORIGIN;
  return new Request('https://w.example' + p, { method: method, headers: headers, body: o.body ? JSON.stringify(o.body) : undefined });
}
async function call(method, p, o) {
  var r = await handle(req(method, p, o), env, deps);
  var text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : {}, raw: text };
}

// pair the writer phone
var dev = (await call('POST', '/pair', { body: { setupCode: SETUP } })).body.deviceToken;

// household pairing: needs HOUSEHOLD_CODE; the device setup code does not work
assert.equal((await call('POST', '/household/pair', { body: { setupCode: SETUP } })).status, 401);
var vr = await call('POST', '/household/pair', { body: { setupCode: HOUSE } });
assert.equal(vr.status, 200);
var viewer = vr.body.viewerToken;
// an unset HOUSEHOLD_CODE must never fall back to SETUP_CODE
var env2 = Object.assign({}, env, { DB: makeDb(), HOUSEHOLD_CODE: undefined });
var rr = await handle(req('POST', '/household/pair', { body: { setupCode: SETUP } }), env2, deps);
assert.equal(rr.status, 401);

// snapshots: only the writer uploads; viewer reads newest; last 5 kept
assert.equal((await call('POST', '/snapshot', { token: viewer, body: { blob: 'x' } })).status, 401);
assert.equal((await call('GET', '/snapshot', { token: viewer })).status, 404);
for (var i = 1; i <= 7; i++) {
  now += 1;
  assert.equal((await call('POST', '/snapshot', { token: dev, body: { blob: 'ciphertext-' + i } })).status, 200);
}
var list = (await call('GET', '/snapshots', { token: dev })).body.snapshots;
assert.equal(list.length, 5);
assert.equal((await call('GET', '/snapshots', { token: viewer })).status, 401);
var latest = await call('GET', '/snapshot', { token: viewer });
assert.equal(latest.body.blob, 'ciphertext-7');
assert.equal((await call('GET', '/snapshot?id=' + list[4].id, { token: viewer })).status, 403);
assert.equal((await call('GET', '/snapshot?id=' + list[4].id, { token: dev })).body.blob, 'ciphertext-3');
assert.equal((await call('POST', '/snapshot', { token: dev, body: {} })).status, 400);

// briefs: stored per level; forbidden fields and level mismatches rejected
var l0 = { schema: 1, level: 'L0', balances: { checking: 3100, chaseOwed: 1200 } };
var l1 = { schema: 1, level: 'L1', balances: { checking: 3100, chaseOwed: 1200 }, upcomingBills: [{ name: 'Rent', amount: 1800, dueDate: '2026-12-01' }] };
assert.equal((await call('POST', '/brief', { token: viewer, body: { briefs: { L0: l0 } } })).status, 401);
assert.equal((await call('POST', '/brief', { token: dev, body: { briefs: { L0: Object.assign({ bankText: 'x' }, l0) } } })).status, 400);
assert.equal((await call('POST', '/brief', { token: dev, body: { briefs: { L0: { schema: 1, level: 'L0', nested: [{ account_id: 'a' }] } } } })).status, 400);
assert.equal((await call('POST', '/brief', { token: dev, body: { briefs: { L0: l1 } } })).status, 400);
assert.equal((await call('POST', '/brief', { token: dev, body: { briefs: { L2: l0 } } })).status, 400);
assert.equal((await call('POST', '/brief', { token: dev, body: { briefs: { L0: l0, L1: l1 } } })).status, 200);

// agents: token shown once, only the hash is stored, level scoping, revoke
assert.equal((await call('POST', '/agents', { token: viewer, body: { name: 'a', level: 'L0' } })).status, 401);
assert.equal((await call('POST', '/agents', { token: dev, body: { name: 'a', level: 'L9' } })).status, 400);
var a0 = (await call('POST', '/agents', { token: dev, body: { name: 'chatgpt', level: 'L0' } })).body;
var a1 = (await call('POST', '/agents', { token: dev, body: { name: 'claude', level: 'L1' } })).body;
assert.match(a0.token, /^[0-9a-f]{64}$/);
var stored = env.DB.raw.prepare('SELECT token_hash FROM agents').all().map(function (r) { return r.token_hash; });
assert.ok(stored.length === 2 && stored.indexOf(a0.token) < 0 && stored.indexOf(a1.token) < 0);
var g0 = await call('GET', '/brief', { token: a0.token, noOrigin: true });
assert.equal(g0.status, 200);
assert.equal(g0.body.brief.level, 'L0');
assert.equal(g0.raw.indexOf('upcomingBills'), -1);
assert.equal((await call('GET', '/brief', { token: a1.token, noOrigin: true })).body.brief.level, 'L1');
// agent tokens reach nothing but GET /brief
for (var pth of ['/snapshot', '/snapshots', '/agents', '/pull']) {
  assert.equal((await call('GET', pth, { token: a1.token, noOrigin: true })).status, 401, pth);
}
assert.equal((await call('POST', '/snapshot', { token: a1.token, body: { blob: 'x' }, noOrigin: true })).status, 401);
assert.equal((await call('GET', '/brief', { token: dev })).status, 401);
var listA = (await call('GET', '/agents', { token: dev })).body.agents;
assert.equal(listA.length, 2);
assert.ok(JSON.stringify(listA).indexOf(a0.token) < 0);
assert.equal((await call('POST', '/agents/revoke', { token: dev, body: { id: a0.id } })).status, 200);
assert.equal((await call('GET', '/brief', { token: a0.token, noOrigin: true })).status, 401);
assert.equal((await call('GET', '/brief', { token: a1.token, noOrigin: true })).status, 200);

// revoking viewers locks out the second phone
assert.equal((await call('POST', '/viewers/revoke', { token: dev })).status, 200);
assert.equal((await call('GET', '/snapshot', { token: viewer })).status, 401);

// existing /pull route still needs the writer token
assert.equal((await call('GET', '/pull', { token: viewer })).status, 401);

console.log('worker-household-test: ok');
