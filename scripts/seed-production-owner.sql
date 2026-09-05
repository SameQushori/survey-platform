PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
VALUES (
  'org_vecta',
  'Vecta',
  'vecta',
  'active',
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

INSERT OR IGNORE INTO users
  (id, auth_subject, email, display_name, platform_role, status, created_at, updated_at)
VALUES (
  'user_production_owner',
  'app:user_production_owner',
  NULL,
  'Владелец Vecta',
  'super_admin',
  'active',
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);

INSERT OR IGNORE INTO memberships
  (id, organization_id, user_id, role, status, created_at, updated_at)
VALUES (
  'membership_vecta_production_owner',
  'org_vecta',
  'user_production_owner',
  'organizer',
  'active',
  unixepoch('now') * 1000,
  unixepoch('now') * 1000
);
