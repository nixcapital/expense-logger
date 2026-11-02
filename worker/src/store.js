// D1 access. Only hashes, encrypted tokens and cursors are stored here.
var FAIL_WINDOW_MS = 15 * 60 * 1000;
export var MAX_FAILURES = 5;

export async function recentFailures(db, now) {
  await db.prepare('DELETE FROM auth_failures WHERE ts < ?').bind(now - FAIL_WINDOW_MS).run();
  var row = await db.prepare('SELECT COUNT(*) AS n FROM auth_failures').first();
  return row ? Number(row.n) : 0;
}

export async function recordFailure(db, now) {
  await db.prepare('INSERT INTO auth_failures (ts) VALUES (?)').bind(now).run();
}

export async function addDevice(db, tokenHash, now) {
  await db.prepare('INSERT INTO devices (token_hash, created_at, revoked) VALUES (?, ?, 0)').bind(tokenHash, now).run();
}

export async function deviceActive(db, tokenHash) {
  var row = await db.prepare('SELECT revoked FROM devices WHERE token_hash = ?').bind(tokenHash).first();
  return !!row && Number(row.revoked) === 0;
}

export async function revokeDevice(db, tokenHash) {
  await db.prepare('UPDATE devices SET revoked = 1 WHERE token_hash = ?').bind(tokenHash).run();
}

export async function saveItem(db, item) {
  await db.prepare(
    'INSERT OR REPLACE INTO items (item_id, institution, access_token_enc, cursor, account_map, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(item.itemId, item.institution || '', item.accessTokenEnc, '', JSON.stringify(item.accountMap || {}), item.now).run();
}

export async function listItems(db) {
  var res = await db.prepare(
    'SELECT item_id, institution, access_token_enc, cursor, needs_reconnect, account_map FROM items ORDER BY created_at, item_id'
  ).all();
  return res.results || [];
}

export async function getItem(db, itemId) {
  return db.prepare('SELECT item_id, access_token_enc FROM items WHERE item_id = ?').bind(itemId).first();
}

export async function loadBatch(db) {
  var row = await db.prepare('SELECT batch_id, payload FROM batches LIMIT 1').first();
  if (!row) return null;
  return { batchId: row.batch_id, payload: JSON.parse(row.payload) };
}

// Persist the new cursor and the merged unacked batch together, so a cursor never
// advances without its rows being stored.
export async function commitSync(db, args) {
  var stmts = [];
  stmts.push(db.prepare('DELETE FROM batches').bind());
  if (args.batch) {
    stmts.push(db.prepare('INSERT INTO batches (batch_id, payload, created_at) VALUES (?, ?, ?)')
      .bind(args.batch.batchId, JSON.stringify(args.batch.payload), args.now));
  }
  stmts.push(db.prepare('UPDATE items SET cursor = ?, needs_reconnect = 0 WHERE item_id = ?')
    .bind(args.cursor, args.itemId));
  await db.batch(stmts);
}

export async function setNeedsReconnect(db, itemId, flag) {
  await db.prepare('UPDATE items SET needs_reconnect = ? WHERE item_id = ?').bind(flag ? 1 : 0, itemId).run();
}

// Returns 'deleted', 'none' (nothing stored) or 'stale' (a different batch is stored).
export async function ackBatch(db, batchId) {
  var cur = await db.prepare('SELECT batch_id FROM batches LIMIT 1').first();
  if (!cur) return 'none';
  if (cur.batch_id !== batchId) return 'stale';
  await db.prepare('DELETE FROM batches WHERE batch_id = ?').bind(batchId).run();
  return 'deleted';
}

// ---- Household mirror and agent brief ----
export var SNAPSHOTS_KEPT = 5;

export async function addViewer(db, tokenHash, now) {
  await db.prepare('INSERT INTO viewers (token_hash, created_at, revoked) VALUES (?, ?, 0)').bind(tokenHash, now).run();
}
export async function viewerActive(db, tokenHash) {
  var row = await db.prepare('SELECT revoked FROM viewers WHERE token_hash = ?').bind(tokenHash).first();
  return !!row && Number(row.revoked) === 0;
}
export async function revokeAllViewers(db) {
  await db.prepare('UPDATE viewers SET revoked = 1').bind().run();
}

export async function addSnapshot(db, blob, now) {
  await db.prepare('INSERT INTO snapshots (blob, created_at) VALUES (?, ?)').bind(blob, now).run();
  await db.prepare('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)')
    .bind(SNAPSHOTS_KEPT).run();
}
export async function listSnapshots(db) {
  var res = await db.prepare('SELECT id, created_at, LENGTH(blob) AS bytes FROM snapshots ORDER BY id DESC').all();
  return res.results || [];
}
export async function getSnapshot(db, id) {
  if (id) return db.prepare('SELECT id, blob, created_at FROM snapshots WHERE id = ?').bind(id).first();
  return db.prepare('SELECT id, blob, created_at FROM snapshots ORDER BY id DESC LIMIT 1').first();
}

export async function saveBrief(db, level, body, now) {
  await db.prepare('INSERT OR REPLACE INTO briefs (level, body, updated_at) VALUES (?, ?, ?)').bind(level, body, now).run();
}
export async function getBrief(db, level) {
  return db.prepare('SELECT body, updated_at FROM briefs WHERE level = ?').bind(level).first();
}

export async function addAgent(db, a) {
  await db.prepare('INSERT INTO agents (id, name, level, token_hash, created_at, revoked) VALUES (?, ?, ?, ?, ?, 0)')
    .bind(a.id, a.name, a.level, a.tokenHash, a.now).run();
}
export async function agentByHash(db, tokenHash) {
  var row = await db.prepare('SELECT id, level, revoked FROM agents WHERE token_hash = ?').bind(tokenHash).first();
  return row && Number(row.revoked) === 0 ? row : null;
}
export async function listAgents(db) {
  var res = await db.prepare('SELECT id, name, level, created_at, revoked FROM agents ORDER BY created_at, id').all();
  return res.results || [];
}
export async function revokeAgent(db, id) {
  await db.prepare('UPDATE agents SET revoked = 1 WHERE id = ?').bind(id).run();
}
