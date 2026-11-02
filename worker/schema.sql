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
-- Household mirror and agent brief (plan #66, docs/AGENT_BRIEF.md). Snapshots are
-- opaque ciphertext; the key never reaches the Worker. Last 5 are kept.
CREATE TABLE IF NOT EXISTS viewers (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blob TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS briefs (
  level TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
