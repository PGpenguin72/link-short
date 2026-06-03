-- Full schema for fresh installs. For existing databases, run migration-002.sql instead.

CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  banned     INTEGER NOT NULL DEFAULT 0,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT UNIQUE NOT NULL,
  target_url      TEXT NOT NULL,
  owner_email     TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  disabled_reason TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_links_slug ON links(slug);
CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_email);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
