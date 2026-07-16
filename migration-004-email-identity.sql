-- Fail closed when legacy rows differ only by email casing. The application
-- normalizes new verified emails, and identity binding assumes one legacy row
-- per normalized address. Existing duplicates must be resolved before retrying.

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized
  ON users(lower(email));
