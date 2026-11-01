// node worker/test/worker-auth-test.mjs  (Node 22+; uses node:sqlite as a D1 stand-in)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../src/index.js';
import { b64encode, sha256Hex } from '../src/crypto.js';
import { makeDb } from './helpers.mjs';

var here = path.dirname(fileURLToPath(import.meta.url));
var ORIGIN = 'https://nixcapital.github.io';
var SETUP = 'fake-setup-code-1234';
var ACCESS = 'access-sandbox-FAKE-0001';
var KEY = b64encode(new Uint8Array(32).fill(7));

function makeEnv() {
  return {
    DB: makeDb(), ALLOWED_ORIGIN: ORIGIN, REDIRECT_URI: ORIGIN + '/expense-logger/link.html',
    PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'fake-client', PLAID_SECRET: 'fake-secret',
    TOKEN_ENC_KEY: KEY, SETUP_CODE: SETUP
  };
}

var plaidCalls = [];
function fakeFetch(url, init) {
  var body = JSON.parse(init.body);
  plaidCalls.push({ url: url, body: body });
  var out = {};
  if (url.endsWith('/link/token/create')) out = { link_token: 'link-sandbox-FAKE' };
  else if (url.endsWith('/item/public_token/exchange')) out = { access_token: ACCESS, item_id: 'item-FAKE-1' };
  return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(out); } });
}

function req(method, p, opts) {
  opts = opts || {};
  var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (opts.origin !== null) headers['Origin'] = opts.origin || ORIGIN;
  return new Request('https://worker.example' + p, { method: method, headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
}

var env = makeEnv();
var deps = { fetch: fakeFetch };

// pairing: wrong code rejected, nothing stored
var r = await handle(req('POST', '/pair', { body: { setupCode: 'nope' } }), env, deps);
assert.equal(r.status, 401);
assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM devices').get().n, 0);

// pairing: right code gives a token; only its hash is stored
r = await handle(req('POST', '/pair', { body: { setupCode: SETUP } }), env, deps);
assert.equal(r.status, 200);
var token = (await r.json()).deviceToken;
assert.match(token, /^[0-9a-f]{64}$/);
var rows = env.DB.raw.prepare('SELECT token_hash FROM devices').all();
assert.equal(rows.length, 1);
assert.equal(rows[0].token_hash, await sha256Hex(token));
assert.notEqual(rows[0].token_hash, token);

// CORS: allowed origin echoed on success; other origin gets 403 and no ACAO header
assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
r = await handle(req('POST', '/pair', { origin: 'https://evil.example', body: { setupCode: SETUP } }), env, deps);
assert.equal(r.status, 403);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
r = await handle(req('OPTIONS', '/pair', { origin: 'https://evil.example' }), env, deps);
assert.equal(r.status, 403);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
r = await handle(req('OPTIONS', '/pair'), env, deps);
assert.equal(r.status, 204);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
assert.equal(r.headers.get('Access-Control-Allow-Credentials'), null);

// bearer: missing/bad token is 401, good token disconnects, then is revoked
r = await handle(req('POST', '/disconnect'), env, deps);
assert.equal(r.status, 401);
r = await handle(req('POST', '/disconnect', { headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } }), env, deps);
assert.equal(r.status, 401);
r = await handle(req('POST', '/disconnect', { headers: { Authorization: 'Bearer ' + token } }), env, deps);
assert.equal(r.status, 200);
r = await handle(req('POST', '/disconnect', { headers: { Authorization: 'Bearer ' + token } }), env, deps);
assert.equal(r.status, 401);

// link routes need the setup code
r = await handle(req('POST', '/link/token'), env, deps);
assert.equal(r.status, 401);
r = await handle(req('POST', '/link/token', { headers: { Authorization: 'Setup ' + SETUP } }), env, deps);
assert.equal(r.status, 200);
assert.equal((await r.json()).linkToken, 'link-sandbox-FAKE');
var lt = plaidCalls.filter(function (c) { return c.url.endsWith('/link/token/create'); })[0];
assert.equal(lt.url.startsWith('https://sandbox.plaid.com'), true);
assert.equal(lt.body.transactions.days_requested, 730);
assert.deepEqual(lt.body.products, ['transactions']);
assert.equal(lt.body.redirect_uri, env.REDIRECT_URI);

// exchange: access token is stored encrypted; plaintext never appears in any table or response
r = await handle(req('POST', '/link/exchange', {
  headers: { Authorization: 'Setup ' + SETUP },
  body: { public_token: 'public-sandbox-FAKE', institution: 'Fake Bank', accountMap: { 'plaid-acct-1': 'acct-checking' } }
}), env, deps);
assert.equal(r.status, 200);
var text = await r.text();
assert.equal(text.includes(ACCESS), false);
var item = env.DB.raw.prepare('SELECT * FROM items').get();
assert.equal(item.item_id, 'item-FAKE-1');
assert.equal(JSON.stringify(item).includes(ACCESS), false);
assert.ok(item.access_token_enc.length > 20);
var dump = JSON.stringify(env.DB.raw.prepare('SELECT * FROM devices').all()) + JSON.stringify(env.DB.raw.prepare('SELECT * FROM auth_failures').all());
assert.equal(dump.includes(ACCESS), false);
import { decryptText } from '../src/crypto.js';
assert.equal(await decryptText(KEY, item.access_token_enc), ACCESS);

// update mode: token for an existing Item uses the decrypted access token and no products
plaidCalls.length = 0;
r = await handle(req('POST', '/link/token', { headers: { Authorization: 'Setup ' + SETUP }, body: { itemId: 'item-FAKE-1' } }), env, deps);
assert.equal(r.status, 200);
assert.equal((await r.json()).linkToken, 'link-sandbox-FAKE');
var ut = plaidCalls.filter(function (c) { return c.url.endsWith('/link/token/create'); })[0];
assert.equal(ut.body.access_token, ACCESS);
assert.equal(ut.body.products, undefined);
r = await handle(req('POST', '/link/token', { headers: { Authorization: 'Setup ' + SETUP }, body: { itemId: 'nope' } }), env, deps);
assert.equal(r.status, 404);

// bad account map and missing token rejected
r = await handle(req('POST', '/link/exchange', { headers: { Authorization: 'Setup ' + SETUP }, body: { public_token: 'x', accountMap: { a: 'acct-evil' } } }), env, deps);
assert.equal(r.status, 400);
r = await handle(req('POST', '/link/exchange', { headers: { Authorization: 'Setup ' + SETUP }, body: {} }), env, deps);
assert.equal(r.status, 400);

// lockout: 5 bad codes then even the right code is refused until the window passes
var env2 = makeEnv();
var t0 = 1000000;
for (var i = 0; i < 5; i++) {
  r = await handle(req('POST', '/pair', { body: { setupCode: 'bad' + i } }), env2, { fetch: fakeFetch, now: function () { return t0 + i; } });
  assert.equal(r.status, 401);
}
r = await handle(req('POST', '/pair', { body: { setupCode: SETUP } }), env2, { fetch: fakeFetch, now: function () { return t0 + 10; } });
assert.equal(r.status, 429);
r = await handle(req('POST', '/pair', { body: { setupCode: SETUP } }), env2, { fetch: fakeFetch, now: function () { return t0 + 16 * 60 * 1000; } });
assert.equal(r.status, 200);

// Plaid failure returns a short code, never the raw body
var failFetch = function () { return Promise.resolve({ ok: false, status: 400, json: function () { return Promise.resolve({ error_code: 'INVALID_PUBLIC_TOKEN', secret_leak: 'should-not-appear' }); } }); };
r = await handle(req('POST', '/link/exchange', { headers: { Authorization: 'Setup ' + SETUP }, body: { public_token: 'x', accountMap: {} } }), env, { fetch: failFetch });
assert.equal(r.status, 502);
var ft = await r.text();
assert.equal(ft.includes('should-not-appear'), false);
assert.equal(ft.includes('INVALID_PUBLIC_TOKEN'), true);

// no secrets committed in worker/ config
var toml = fs.readFileSync(path.join(here, '..', 'wrangler.toml'), 'utf8');
assert.equal(/PLAID_SECRET\s*=/.test(toml) || /SETUP_CODE\s*=/.test(toml) || /TOKEN_ENC_KEY\s*=/.test(toml), false);

console.log('worker-auth-test: ok');
