-- 56_rls_coverage_gap.sql
--
-- A REAL, previously-undetected tenant-isolation gap - not a tidy-up.
--
-- Migration 12 enabled and FORCEd row level security by scanning
-- information_schema ONCE, at the moment it ran, and creating a policy
-- for every table carrying organization_id. That worked for everything
-- existing at the time. But it was a one-shot scan, not a standing
-- rule, and six organization_id tables created by LATER migrations
-- never had RLS enabled and have no policy attached at all:
--
--   portfolio_budget             (migration 27)
--   portfolio_budget_transfer    (migration 27)
--   annual_plan                  (migration 29)
--   governance_tier              (migration 31)
--   portfolio_budget_adjustment  (migration 32)
--   role                         (migration 34)
--
-- Migrations 42 onward each declare their own RLS inline (see 42, 45,
-- 47, 48, 52, 54, 55) so the gap is specifically the 27-34 window,
-- where the inline-RLS habit hadn't been established yet and 12's
-- one-time scan was implicitly - and wrongly - being relied on.
--
-- Practical impact to date: none observed, because there is currently
-- one real tenant. Every route also scopes its own queries by
-- organization_id in the WHERE clause, so no cross-tenant read is
-- known to have happened. But that is defence-in-depth working by
-- luck of tenancy count, not by design: RLS is the backstop for
-- exactly the case where a route forgets its filter, and on these six
-- tables the backstop simply wasn't there. Budgets, annual plans and
-- role definitions are not tables you want relying on a single layer.
--
-- How this was found: the boot-time assert_rls_coverage() call added
-- alongside migration 55 failed on every startup - correctly. The
-- check was right; making it fatal was wrong, and caused a production
-- crash loop. The check is now non-fatal (see server/src/index.ts);
-- this migration closes what it found.
--
-- Policies below intentionally use current_setting('app.current_org', true)
-- - the two-argument, missing_ok form, matching migration 12's dynamic
-- policies. Without `true`, a query issued outside withTenantContext()
-- raises "unrecognized configuration parameter" instead of simply
-- returning no rows. (Note: migrations 47-55 use the one-argument form.
-- That is a real inconsistency worth a follow-up pass, but it is NOT
-- changed here - this migration fixes missing policies only, and
-- rewriting working ones under an incident is how second incidents
-- happen.)

BEGIN;

DO $$
DECLARE
    tbl TEXT;
    policy_name TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'portfolio_budget',
        'portfolio_budget_transfer',
        'annual_plan',
        'governance_tier',
        'portfolio_budget_adjustment',
        'role'
    ]
    LOOP
        -- Skip anything that doesn't exist in this database (e.g. a
        -- future environment where one of these was retired) rather
        -- than failing the whole migration on it.
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = tbl AND c.relkind = 'r' AND n.nspname = 'public'
        ) THEN
            RAISE NOTICE 'Table % not present, skipped', tbl;
            CONTINUE;
        END IF;

        policy_name := 'tenant_isolation_' || tbl;

        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = tbl AND policyname = policy_name
        ) THEN
            EXECUTE format(
                'CREATE POLICY %I ON %I USING (organization_id = current_setting(''app.current_org'', true)::uuid) WITH CHECK (organization_id = current_setting(''app.current_org'', true)::uuid)',
                policy_name, tbl
            );
            RAISE NOTICE 'Created policy % on %', policy_name, tbl;
        ELSE
            RAISE NOTICE 'Policy % already present on %, skipped', policy_name, tbl;
        END IF;
    END LOOP;
END $$;

-- Prove it worked before committing. If any organization_id table is
-- still uncovered, this raises and the whole migration rolls back --
-- far better than discovering it from a log line later.
SELECT assert_rls_coverage();

COMMIT;
