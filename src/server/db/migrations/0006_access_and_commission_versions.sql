CREATE TABLE revoked_sessions (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_revoked_sessions_expiry ON revoked_sessions(expires_at);

-- Existing financial rules remain immutable. Every edit creates a new version.
ALTER TABLE commission_rules ADD COLUMN name TEXT NOT NULL DEFAULT 'Regra de comissão';
