// Expense Logger sync Worker (plan: issue #46). Plumbing only: pairing, auth, CORS,
// Plaid Link token + public_token exchange. Sync/pull/ack arrive in a later PR.
import { sha256Hex, secretsEqual, randomToken, encryptText } from './crypto.js';
import { createLinkToken, exchangePublicToken } from './plaid.js';
import * as store from './store.js';

var MAX_BODY = 10 * 1024;
var ALLOWED_ACCOUNTS = { 'acct-checking': true, 'acct-chase': true };

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

function json(status, body, origin) {
  var headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(body), { status: status, headers: headers });
}

async function readJson(request) {
  var len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return { error: 413 };
  var text = await request.text();
  if (text.length > MAX_BODY) return { error: 413 };
  if (!text) return { value: {} };
  try { return { value: JSON.parse(text) }; } catch (e) { return { error: 400 }; }
}

// Check a setup code with a global failure lockout (single user, so one bucket is enough).
async function checkSetupCode(env, code, now) {
  if (await store.recentFailures(env.DB, now) >= store.MAX_FAILURES) return 'locked';
  if (typeof code === 'string' && code && env.SETUP_CODE && await secretsEqual(code, env.SETUP_CODE)) return 'ok';
  await store.recordFailure(env.DB, now);
  return 'bad';
}

function bearer(request) {
  var h = request.headers.get('Authorization') || '';
  var m = /^Bearer ([0-9a-f]{64})$/.exec(h);
  return m ? m[1] : null;
}

function setupCodeFromHeader(request) {
  var h = request.headers.get('Authorization') || '';
  var m = /^Setup (.{1,200})$/.exec(h);
  return m ? m[1] : null;
}

export async function handle(request, env, deps) {
  deps = deps || {};
  var fetchFn = deps.fetch || globalThis.fetch;
  var now = deps.now ? deps.now() : Date.now();
  var url = new URL(request.url);
  var allowed = env.ALLOWED_ORIGIN;
  var origin = request.headers.get('Origin');

  if (origin && origin !== allowed) return json(403, { error: 'origin_not_allowed' }, null);
  var cors = origin ? origin : null;

  if (request.method === 'OPTIONS') {
    if (!cors) return json(403, { error: 'origin_not_allowed' }, null);
    return new Response(null, { status: 204, headers: corsHeaders(cors) });
  }

  if (url.pathname === '/health' && request.method === 'GET') return json(200, { ok: true }, cors);
  if (request.method !== 'POST') return json(404, { error: 'not_found' }, cors);

  var body = await readJson(request);
  if (body.error) return json(body.error, { error: body.error === 413 ? 'too_large' : 'bad_json' }, cors);
  var data = body.value && typeof body.value === 'object' ? body.value : {};

  if (url.pathname === '/pair') {
    var pr = await checkSetupCode(env, data.setupCode, now);
    if (pr === 'locked') return json(429, { error: 'too_many_attempts' }, cors);
    if (pr !== 'ok') return json(401, { error: 'bad_setup_code' }, cors);
    var token = randomToken();
    await store.addDevice(env.DB, await sha256Hex(token), now);
    return json(200, { deviceToken: token }, cors);
  }

  if (url.pathname === '/disconnect') {
    var t = bearer(request);
    if (!t) return json(401, { error: 'unauthorized' }, cors);
    var h = await sha256Hex(t);
    if (!await store.deviceActive(env.DB, h)) return json(401, { error: 'unauthorized' }, cors);
    await store.revokeDevice(env.DB, h);
    return json(200, { ok: true }, cors);
  }

  if (url.pathname === '/link/token' || url.pathname === '/link/exchange') {
    // Linking runs in Safari (separate storage from the home-screen app), so it
    // authorizes with the setup code instead of the device token.
    var sr = await checkSetupCode(env, setupCodeFromHeader(request), now);
    if (sr === 'locked') return json(429, { error: 'too_many_attempts' }, cors);
    if (sr !== 'ok') return json(401, { error: 'unauthorized' }, cors);

    try {
      if (url.pathname === '/link/token') {
        var lt = await createLinkToken(env, fetchFn);
        return json(200, { linkToken: lt.link_token }, cors);
      }
      var accountMap = data.accountMap && typeof data.accountMap === 'object' ? data.accountMap : {};
      var clean = {};
      var ids = Object.keys(accountMap);
      for (var i = 0; i < ids.length; i++) {
        if (!ALLOWED_ACCOUNTS[accountMap[ids[i]]]) return json(400, { error: 'bad_account_map' }, cors);
        clean[ids[i]] = accountMap[ids[i]];
      }
      if (typeof data.public_token !== 'string' || !data.public_token) return json(400, { error: 'missing_public_token' }, cors);
      var ex = await exchangePublicToken(env, fetchFn, data.public_token);
      await store.saveItem(env.DB, {
        itemId: ex.item_id,
        institution: typeof data.institution === 'string' ? data.institution.slice(0, 80) : '',
        accessTokenEnc: await encryptText(env.TOKEN_ENC_KEY, ex.access_token),
        accountMap: clean,
        now: now
      });
      return json(200, { ok: true, itemId: ex.item_id }, cors);
    } catch (e) {
      // Never echo Plaid bodies or tokens; only a short code.
      return json(502, { error: 'plaid_error', code: e && e.plaidCode ? e.plaidCode : 'unknown' }, cors);
    }
  }

  return json(404, { error: 'not_found' }, cors);
}

export default {
  fetch: function (request, env) { return handle(request, env, {}); }
};
