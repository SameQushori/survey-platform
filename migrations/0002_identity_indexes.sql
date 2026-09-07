CREATE UNIQUE INDEX idx_users_email_normalized
  ON users(lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX idx_memberships_org_status
  ON memberships(organization_id, status);

PRAGMA optimize;
