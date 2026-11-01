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
  account_map TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_failures (
  ts INTEGER NOT NULL
);
