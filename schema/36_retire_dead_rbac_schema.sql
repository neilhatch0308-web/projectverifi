-- ============================================================
-- 36_retire_dead_rbac_schema.sql
--
-- MUST RUN BEFORE 34_roles_and_permissions.sql (despite the number) -
-- same kind of ordering exception as 10_seed_dummy_data.sql needing to
-- run after 11_programme_layer.sql. Worth noting in SETUP_GUIDE /
-- COMMAND_REFERENCE so a fresh database build gets this right too.
--
-- 08_rbac_and_security.sql defined an earlier RBAC design - role,
-- permission, role_permission, user_role_assignment, api_credential,
-- api_access_log, and a demand_pending_similarity_review view - that
-- was never wired into the application. Confirmed via grep: zero
-- references anywhere in server/ or client/ to any of these table or
-- view names, or to their code/resource/action-shaped columns. It's
-- dead schema, same category as the pre-RPVF Delivery/Adoption/
-- Realisation tables noted in HANDOFF.md - present, never connected.
--
-- 34_roles_and_permissions.sql collided with it: CREATE TABLE IF NOT
-- EXISTS silently skipped role/permission/role_permission because
-- tables with those names already existed, just with a totally
-- different column set. The INSERTs that followed then failed on
-- columns (key, organization_id, permission_key) that only exist in
-- the NEW shape, not the old one.
--
-- If any of these tables hold data you actually care about - unlikely,
-- since nothing in the app ever wrote to them - export it before
-- running this.
-- ============================================================

-- app_user_role was created during the partial run of 34 - correctly
-- shaped, but its role_id foreign key was necessarily created against
-- whatever table was named "role" AT THAT TIME, which was the OLD dead
-- one. It's empty (the role/permission inserts that would have
-- populated it all failed), so dropping and letting 34 recreate it
-- against the real role table is safe and loses nothing.
DROP TABLE IF EXISTS app_user_role;

DROP VIEW IF EXISTS demand_pending_similarity_review;
DROP TABLE IF EXISTS api_access_log;
DROP TABLE IF EXISTS api_credential;
DROP TABLE IF EXISTS user_role_assignment;
DROP TABLE IF EXISTS role_permission;
DROP TABLE IF EXISTS permission;
DROP TABLE IF EXISTS role;

-- business_case.sensitivity_level (added by the same dead migration)
-- is left in place - harmless, unused, and dropping a column is more
-- destructive than dropping never-populated tables. Remove manually
-- later if you want it gone; nothing depends on it either way.