-- Replace Google/email authentication with PG72 ID stable OIDC subjects.
-- Existing users remain unbound until their first PG72 ID login presents the
-- same verified email. Existing sessions cannot be trusted across the identity
-- migration, so this migration intentionally invalidates them.

ALTER TABLE users ADD COLUMN sso_subject TEXT;

CREATE UNIQUE INDEX idx_users_sso_subject
  ON users(sso_subject);

CREATE TABLE auth_bootstrap (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  admin_subject TEXT UNIQUE NOT NULL,
  completed_at  TEXT NOT NULL,
  FOREIGN KEY (admin_subject) REFERENCES users(sso_subject) ON DELETE RESTRICT
);

DROP INDEX IF EXISTS idx_sessions_expires;
ALTER TABLE sessions RENAME TO sessions_google_legacy;

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  sso_subject TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sso_subject) REFERENCES users(sso_subject) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_sessions_subject ON sessions(sso_subject);

DROP TABLE sessions_google_legacy;
