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
  var res = await db.prepare('SELECT item_id, institution, account_map FROM items').all();
  return res.results || [];
}
