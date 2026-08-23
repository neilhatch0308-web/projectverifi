-- ============================================================
-- 12_row_level_security.sql
--
-- Enables and enforces tenant isolation on every table that carries an
-- organization_id column, across files 01-11. Written to scan the actual
-- schema dynamically rather than hand-listing tables, so nothing gets
-- missed and nothing needs updating by hand as new tables get added later
-- (03-07's tables, if they ever gain their own organization_id, will be
-- picked up automatically the next time this file - or the self-test
-- below - is run).
--
-- Two parts:
--   1. A DO block that finds every base table with an organization_id
--      column and, for each one: enables RLS, forces it (so even the
--      table owner/superuser is subject to it - see note below), and
--      creates a standard tenant-isolation policy if one doesn't
--      already exist.
--   2. A callable function assert_rls_coverage() that raises an
--      exception listing any organization_id table that somehow lacks
--      RLS or a policy. The app should call this once at boot (a single
--      query, see server integration note at the bottom) so a missing
--      policy fails loudly at startup instead of silently leaking data
--      across tenants in production.
--
-- IMPORTANT - FORCE ROW LEVEL SECURITY:
-- By default, Postgres RLS does NOT apply to a table's owner (or a
-- superuser). If your app connects as 'postgres' (the default root
-- user, which is what local dev has been using so far), RLS would be
-- silently bypassed for every query - the policies would exist but do
-- nothing. FORCE ROW LEVEL SECURITY closes that gap; the table owner
-- is subject to the policy too, same as any other role.
-- Before this matters in practice: create a non-superuser app role
-- (ledger_app, already referenced in SETUP_GUIDE.md's Cloud SQL setup)
-- and connect as that role, not postgres, from the actual application.
-- ============================================================

-- ---------- 1. Dynamically enable + force RLS, create policies ----------

DO $$
DECLARE
    tbl RECORD;
    policy_name TEXT;
BEGIN
    FOR tbl IN
        SELECT DISTINCT c.relname AS table_name
        FROM information_schema.columns col
        JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r'   -- base tables only, not views
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE col.column_name = 'organization_id'
          AND col.table_schema = 'public'
    LOOP
        policy_name := 'tenant_isolation_' || tbl.table_name;

        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl.table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl.table_name);

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = tbl.table_name
              AND policyname = policy_name
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON %I USING (organization_id = current_setting(''app.current_org'', true)::uuid)',
                policy_name, tbl.table_name
            );
            RAISE NOTICE 'Created policy % on table %', policy_name, tbl.table_name;
        ELSE
            RAISE NOTICE 'Policy % already exists on table %, skipped', policy_name, tbl.table_name;
        END IF;
    END LOOP;
END $$;

-- ---------- 2. Boot-time self-test ----------
-- Call this from the app at startup: SELECT assert_rls_coverage();
-- Raises an exception (which should crash startup, not just log a
-- warning) if any organization_id table lacks RLS enabled, forced, or
-- a policy. A loud startup failure here is much cheaper than a silent
-- cross-tenant data leak in production.

CREATE OR REPLACE FUNCTION assert_rls_coverage() RETURNS void AS $$
DECLARE
    tbl RECORD;
    problems TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOR tbl IN
        SELECT DISTINCT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
        FROM information_schema.columns col
        JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE col.column_name = 'organization_id'
          AND col.table_schema = 'public'
    LOOP
        IF NOT tbl.relrowsecurity THEN
            problems := array_append(problems, tbl.table_name || ': RLS not enabled');
        ELSIF NOT tbl.relforcerowsecurity THEN
            problems := array_append(problems, tbl.table_name || ': RLS enabled but not FORCEd (owner/superuser would bypass it)');
        ELSIF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = tbl.table_name
        ) THEN
            problems := array_append(problems, tbl.table_name || ': RLS enabled but no policy attached');
        END IF;
    END LOOP;

    IF array_length(problems, 1) > 0 THEN
        RAISE EXCEPTION 'RLS coverage check FAILED for % table(s): %', array_length(problems, 1), array_to_string(problems, ' | ');
    ELSE
        RAISE NOTICE 'RLS coverage check passed - every organization_id table has RLS enabled, forced, and a policy attached.';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Run it once now, immediately, as part of applying this file - so you
-- get an instant pass/fail rather than waiting until the app's next boot.
SELECT assert_rls_coverage();

-- ============================================================
-- Server integration (add to server/src/index.ts or a startup module):
--
--   const result = await pool.query('SELECT assert_rls_coverage()');
--   // if this throws, let it crash the process - don't catch and continue.
--
-- Grant execute to the app role once ledger_app exists:
--   GRANT EXECUTE ON FUNCTION assert_rls_coverage() TO ledger_app;
--
-- Known gap this does NOT close:
--   - This only covers tables with an organization_id column. Any table
--     that's tenant-scoped indirectly (e.g. joined through a parent
--     table's organization_id rather than carrying its own column -
--     none currently in this schema, but worth checking as new tables
--     get added) won't be caught by this scan and needs a manual policy.
-- ============================================================