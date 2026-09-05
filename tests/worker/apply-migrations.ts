import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const now = Date.now();
await env.DB.batch([
  env.DB.prepare(
    `INSERT OR IGNORE INTO organizations (id, name, slug, status, created_at, updated_at)
     VALUES ('org_vecta', 'ООО «Векта»', 'vecta', 'active', ?1, ?1)`,
  ).bind(now),
  env.DB.prepare(
    `INSERT OR IGNORE INTO users
     (id, auth_subject, email, display_name, platform_role, status, created_at, updated_at)
     VALUES ('user_organizer', 'local:organizer', 'organizer@vecta.local', 'Алексей Ковалёв', NULL, 'active', ?1, ?1)`,
  ).bind(now),
  env.DB.prepare(
    `INSERT OR IGNORE INTO users
     (id, auth_subject, email, display_name, platform_role, status, created_at, updated_at)
     VALUES ('user_staging_owner', 'app:user_staging_owner', NULL, 'Владелец Vecta', NULL, 'active', ?1, ?1)`,
  ).bind(now),
  env.DB.prepare(
    `INSERT OR IGNORE INTO memberships
     (id, organization_id, user_id, role, status, created_at, updated_at)
     VALUES ('membership_vecta_organizer', 'org_vecta', 'user_organizer', 'organizer', 'active', ?1, ?1)`,
  ).bind(now),
  env.DB.prepare(
    `INSERT OR IGNORE INTO memberships
     (id, organization_id, user_id, role, status, created_at, updated_at)
     VALUES ('membership_vecta_owner', 'org_vecta', 'user_staging_owner', 'organizer', 'active', ?1, ?1)`,
  ).bind(now),
]);
