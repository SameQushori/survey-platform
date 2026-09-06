PRAGMA foreign_keys = ON;

CREATE TABLE organizer_auth_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired')),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  CHECK (expires_at > created_at),
  CHECK ((status = 'active' AND used_at IS NULL) OR status IN ('used', 'expired'))
);

CREATE TABLE organizer_auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_digest TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at > created_at)
);

CREATE INDEX idx_auth_challenges_user_created ON organizer_auth_challenges(user_id, created_at DESC);
CREATE INDEX idx_auth_challenges_expiry ON organizer_auth_challenges(expires_at);
CREATE INDEX idx_auth_sessions_user_expiry ON organizer_auth_sessions(user_id, expires_at DESC);
CREATE INDEX idx_auth_sessions_expiry ON organizer_auth_sessions(expires_at);

PRAGMA optimize;
