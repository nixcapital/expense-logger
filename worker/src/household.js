// Household mirror + agent brief routes (plan #66, docs/AGENT_BRIEF.md).
// The Worker stores ciphertext snapshots it cannot read, and plaintext briefs that
// are scanned for forbidden fields. Agents only ever reach GET /brief.
import { sha256Hex, randomToken } from './crypto.js';
import * as store from './store.js';

var MAX_SNAPSHOT = 3 * 1024 * 1024;
var MAX_SMALL = 64 * 1024;
var LEVELS = { L0: 0, L1: 1 };
// Key names that must never appear anywhere in a stored brief (AGENTS.md).
var FORBIDDEN = /(bankText|access_token|public_token|account_id|transaction_id|accountNumber|mask|sync\.v1|deviceToken|receipt)/i;

function hasForbidden(value) {
  if (Array.isArray(value)) return value.some(hasForbidden);
  if (value && typeof value === 'object') {
    return Object.keys(value).some(function (k) { return FORBIDDEN.test(k) || hasForbidden(value[k]); });
  }
  return false;
}

async function readBody(request, max) {
  var text = await request.text();
  if (text.length > max) return { error: 413 };
  if (!text) return { value: {} };
  try { return { value: JSON.parse(text) }; } catch (e) { return { error: 400 }; }
}

// ctx: { json, bearer, authDevice, checkSetupCode } from index.js. Returns a Response or null.
export async function route(request, env, url, cors, now, ctx) {
  var p = url.pathname;
  var m = request.method;
  var json = function (s, b) { return ctx.json(s, b, cors); };

  async function isViewer() {
    var t = ctx.bearer(request);
    return !!t && store.viewerActive(env.DB, await sha256Hex(t));
  }

  if (p === '/household/pair' && m === 'POST') {
    var b = await readBody(request, MAX_SMALL);
    if (b.error) return json(b.error, { error: b.error === 413 ? 'too_large' : 'bad_json' });
    var pr = await ctx.checkSetupCode(env, b.value.setupCode, now, env.HOUSEHOLD_CODE);
    if (pr === 'locked') return json(429, { error: 'too_many_attempts' });
    if (pr !== 'ok') return json(401, { error: 'bad_setup_code' });
    var vt = randomToken();
    await store.addViewer(env.DB, await sha256Hex(vt), now);
    return json(200, { viewerToken: vt });
  }

  if (p === '/snapshot' && m === 'POST') {
    if (!await ctx.authDevice(request, env)) return json(401, { error: 'unauthorized' });
    var sb = await readBody(request, MAX_SNAPSHOT);
    if (sb.error) return json(sb.error, { error: sb.error === 413 ? 'too_large' : 'bad_json' });
    if (typeof sb.value.blob !== 'string' || !sb.value.blob) return json(400, { error: 'missing_blob' });
    await store.addSnapshot(env.DB, sb.value.blob, now);
    return json(200, { ok: true });
  }

  if (p === '/snapshot' && m === 'GET') {
    var dev = await ctx.authDevice(request, env);
    if (!dev && !await isViewer()) return json(401, { error: 'unauthorized' });
    var idParam = url.searchParams.get('id');
    // Only the writer phone may fetch an older snapshot (rollback); viewers get the newest.
    if (idParam && !dev) return json(403, { error: 'forbidden' });
    var snap = await store.getSnapshot(env.DB, idParam ? Number(idParam) : null);
    if (!snap) return json(404, { error: 'no_snapshot' });
    return json(200, { id: snap.id, blob: snap.blob, createdAt: snap.created_at });
  }

  if (p === '/snapshots' && m === 'GET') {
    if (!await ctx.authDevice(request, env)) return json(401, { error: 'unauthorized' });
    var list = await store.listSnapshots(env.DB);
    return json(200, { snapshots: list.map(function (r) { return { id: r.id, createdAt: r.created_at, bytes: r.bytes }; }) });
  }

  if (p === '/viewers/revoke' && m === 'POST') {
    if (!await ctx.authDevice(request, env)) return json(401, { error: 'unauthorized' });
    await store.revokeAllViewers(env.DB);
    return json(200, { ok: true });
  }

  if (p === '/brief' && m === 'POST') {
    if (!await ctx.authDevice(request, env)) return json(401, { error: 'unauthorized' });
    var bb = await readBody(request, MAX_SMALL);
    if (bb.error) return json(bb.error, { error: bb.error === 413 ? 'too_large' : 'bad_json' });
    var briefs = bb.value && bb.value.briefs;
    var levels = briefs && typeof briefs === 'object' ? Object.keys(briefs) : [];
    if (!levels.length) return json(400, { error: 'missing_briefs' });
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i];
      if (!(lv in LEVELS) || !briefs[lv] || typeof briefs[lv] !== 'object') return json(400, { error: 'bad_level' });
      if (briefs[lv].level !== lv) return json(400, { error: 'level_mismatch' });
      if (hasForbidden(briefs[lv])) return json(400, { error: 'forbidden_field' });
    }
    for (var j = 0; j < levels.length; j++) await store.saveBrief(env.DB, levels[j], JSON.stringify(briefs[levels[j]]), now);
    return json(200, { ok: true });
  }

  if (p === '/brief' && m === 'GET') {
    var t = ctx.bearer(request);
    var agent = t ? await store.agentByHash(env.DB, await sha256Hex(t)) : null;
    if (!agent) return json(401, { error: 'unauthorized' });
    var row = await store.getBrief(env.DB, agent.level);
    if (!row) return json(404, { error: 'no_brief' });
    return json(200, { brief: JSON.parse(row.body), updatedAt: row.updated_at });
  }

  if (p === '/agents' && m === 'GET') {
    if (!await ctx.authDevice(request, env)) return json(401, { error: 'unauthorized' });
    var ag = await store.listAgents(env.DB);
    return json(200, { agents: ag.map(function (a) {
      return { id: a.id, name: a.name, level: a.level, createdAt: a.created_at, revoked: Number(a.revoked) === 1 };
    }) });
  }

  if (p === '/agents' && m === 'POST') {
    if (!await ctx.authDevice(request, env)) return json(401, { error: 'unauthorized' });
    var ab = await readBody(request, MAX_SMALL);
    if (ab.error) return json(ab.error, { error: ab.error === 413 ? 'too_large' : 'bad_json' });
    var name = typeof ab.value.name === 'string' ? ab.value.name.trim().slice(0, 40) : '';
    if (!name || !(ab.value.level in LEVELS)) return json(400, { error: 'bad_agent' });
    var token = randomToken();
    var id = randomToken().slice(0, 12);
    await store.addAgent(env.DB, { id: id, name: name, level: ab.value.level, tokenHash: await sha256Hex(token), now: now });
    // The token is shown once; only its hash is stored.
    return json(200, { id: id, name: name, level: ab.value.level, token: token });
  }

  if (p === '/agents/revoke' && m === 'POST') {
    if (!await ctx.authDevice(request, env)) return json(401, { error: 'unauthorized' });
    var rb = await readBody(request, MAX_SMALL);
    if (rb.error) return json(rb.error, { error: 'bad_json' });
    if (typeof rb.value.id !== 'string' || !rb.value.id) return json(400, { error: 'missing_id' });
    await store.revokeAgent(env.DB, rb.value.id);
    return json(200, { ok: true });
  }

  return null;
}
