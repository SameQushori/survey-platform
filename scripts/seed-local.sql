PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
VALUES ('org_vecta', 'ООО «Векта»', 'vecta', 'active', 1788037200000, 1788037200000);

INSERT OR IGNORE INTO users (id, auth_subject, email, display_name, platform_role, status, created_at, updated_at)
VALUES
  ('user_super_admin', 'local:super-admin', 'admin@vecta.local', 'Администратор Vecta', 'super_admin', 'active', 1788037200000, 1788037200000),
  ('user_organizer', 'local:organizer', 'organizer@vecta.local', 'Алексей Ковалёв', NULL, 'active', 1788037200000, 1788037200000);

INSERT OR IGNORE INTO memberships (id, organization_id, user_id, role, status, created_at, updated_at)
VALUES ('membership_vecta_organizer', 'org_vecta', 'user_organizer', 'organizer', 'active', 1788037200000, 1788037200000);
