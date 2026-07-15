CREATE TABLE users (
  email      TEXT PRIMARY KEY,
  banned     INTEGER NOT NULL DEFAULT 0,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);
