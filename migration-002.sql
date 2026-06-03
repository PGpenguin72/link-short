-- Migration for EXISTING databases (already have links + sessions tables).
-- Adds multi-user support: users table + owner/active columns on links.
-- Run with: npx wrangler d1 execute link-short-db --remote --file=migration-002.sql

CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  banned     INTEGER NOT NULL DEFAULT 0,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE links ADD COLUMN owner_email TEXT;
ALTER TABLE links ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE links ADD COLUMN disabled_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_email);
