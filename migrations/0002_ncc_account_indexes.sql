CREATE TABLE IF NOT EXISTS member_verifications (
  member_number TEXT PRIMARY KEY,
  member_type TEXT NOT NULL,
  masked_name TEXT NOT NULL,
  status TEXT NOT NULL,
  status_label TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT '',
  valid INTEGER NOT NULL CHECK (valid IN (0, 1)),
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_verifications_status
  ON member_verifications(status, synced_at DESC);

CREATE TABLE IF NOT EXISTS member_recovery_index (
  lookup_hash TEXT PRIMARY KEY,
  masked_email TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_recovery_attempts (
  client_hash TEXT PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_recovery_updated
  ON account_recovery_attempts(updated_at DESC);

CREATE TABLE IF NOT EXISTS account_admin_audit (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  target_member_number TEXT NOT NULL DEFAULT '',
  before_value TEXT NOT NULL DEFAULT '',
  after_value TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_admin_audit_created
  ON account_admin_audit(created_at DESC);
