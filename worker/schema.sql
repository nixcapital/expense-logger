CREATE TABLE IF NOT EXISTS devices (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
  item_id TEXT PRIMARY KEY,
  institution TEXT NOT NULL DEFAULT '',
  access_token_enc TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  needs_reconnect INTEGER NOT NULL DEFAULT 0,
  account_map TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_failures (
  ts INTEGER NOT NULL
);
-- At most one unacknowledged batch exists. It is deleted when the phone acks its batch_id.
CREATE TABLE IF NOT EXISTS batches (
  batch_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
