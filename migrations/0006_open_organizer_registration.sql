PRAGMA foreign_keys = ON;

-- Vecta no longer exposes a platform-wide Super Admin role. Existing owners keep
-- their organization membership and continue as regular organizers.
UPDATE users
SET platform_role = NULL,
    updated_at = unixepoch('now') * 1000
WHERE platform_role IS NOT NULL;
