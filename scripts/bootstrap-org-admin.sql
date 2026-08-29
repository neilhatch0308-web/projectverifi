-- ============================================================
-- bootstrap-org-admin.sql
--
-- One-time bootstrap: the User Admin screen requires users.manage,
-- which nobody has until someone is granted the Org Admin role - a
-- genuine chicken-and-egg problem for the very first admin on a
-- freshly migrated database. This grants Org Admin (every permission,
-- including users.manage) to a user by email, directly via SQL, so
-- you can then use the real UI (Users screen) for everyone else.
--
-- Edit the email below if it's not you, then run:
--   psql -h localhost -p 5432 -U postgres -d postgres -f bootstrap-org-admin.sql
-- ============================================================

-- RLS is FORCE ROW LEVEL SECURITY even for manual psql queries -
-- set tenant context first, same as any other direct query against a
-- tenant table (see HANDOFF.md gotchas). Acme Holdings' seeded org ID:
SELECT set_config('app.current_org', '11111111-1111-1111-1111-111111111111', false);

INSERT INTO app_user_role (user_id, role_id, granted_by)
SELECT id, '34111111-0000-0000-0000-000000000005', id  -- self-granted, bootstrap only
FROM app_user
WHERE email = 'neil@we-verifi.co.uk'
ON CONFLICT DO NOTHING;

-- Confirm it took:
SELECT u.display_name, u.email, r.name AS role
FROM app_user_role ur
JOIN app_user u ON u.id = ur.user_id
JOIN role r ON r.id = ur.role_id
WHERE u.email = 'neil@we-verifi.co.uk';