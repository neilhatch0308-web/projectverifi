-- ============================================================
-- 65_portfolio_level_objectives.sql
--
-- Two changes to strategic_goal:
--   1. Removes the 5-per-org-per-year cap entirely (trigger + function,
--      both from migration 09).
--   2. Adds portfolio_id -- NULL means a corporate/org-wide objective
--      (the only kind that existed before this migration), non-NULL
--      means it belongs to that parent portfolio.
--
-- A demand may link to a corporate objective OR one owned by its own
-- raising portfolio. Parent-portfolio-only, trigger-enforced, for the
-- same reason portfolio_budget and annual_plan are parent-only: a
-- demand's raising portfolio is always a parent, and the delivering
-- sub-portfolio is nullable and typically assigned after raise -- so a
-- sub-portfolio-owned objective would be invisible at exactly the
-- moment someone first picks one.
--
-- Declares RLS inline per HANDOFF.md 6b. strategic_goal was created in
-- migration 09 and IS covered by migration 12's scan, but 6b says to
-- confirm rather than assume -- the cross-tenant self-test below does
-- that rather than trusting the coverage function alone.
--
-- NOTE ON RUNNING THIS AS `postgres`: real Postgres superusers bypass
-- RLS regardless of FORCE (HANDOFF.md 6), so a clean pass of the
-- self-test below when run as a superuser does NOT prove the policy
-- works. It proves the write-side WITH CHECK path is sane. A genuine
-- verification needs a non-superuser role that owns these tables.
--
-- Plain ASCII only (HANDOFF.md 6) -- no smart quotes or em-dashes.
-- ============================================================

BEGIN;

-- ---------- 1. Remove the 5-per-year cap ----------

DROP TRIGGER IF EXISTS trg_strategic_goal_cap ON strategic_goal;
DROP FUNCTION IF EXISTS enforce_strategic_goal_cap();

-- ---------- 2. Portfolio-level objectives ----------

ALTER TABLE strategic_goal
  ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES portfolio(id);

COMMENT ON COLUMN strategic_goal.portfolio_id IS
  'NULL = corporate/org-wide objective. Non-NULL = owned by that parent portfolio. Parent-only, enforced by trg_strategic_goal_parent_portfolio.';

-- Parent-only, following enforce_plan_on_parent_portfolio's precedent.
CREATE OR REPLACE FUNCTION enforce_goal_on_parent_portfolio() RETURNS trigger AS $$
BEGIN
  IF NEW.portfolio_id IS NOT NULL THEN
    IF (SELECT parent_portfolio_id FROM portfolio WHERE id = NEW.portfolio_id) IS NOT NULL THEN
      RAISE EXCEPTION 'A portfolio objective must belong to a parent portfolio, not a sub-portfolio';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_strategic_goal_parent_portfolio ON strategic_goal;
CREATE TRIGGER trg_strategic_goal_parent_portfolio
  BEFORE INSERT OR UPDATE ON strategic_goal
  FOR EACH ROW EXECUTE FUNCTION enforce_goal_on_parent_portfolio();

-- Partial index: only portfolio-scoped goals, matching the
-- idx_demand_target_start_year pattern (migration 42).
CREATE INDEX IF NOT EXISTS idx_goal_portfolio_year
  ON strategic_goal(portfolio_id, goal_year) WHERE portfolio_id IS NOT NULL;

-- ---------- 3. RLS (confirm, do not assume -- HANDOFF 6b) ----------

ALTER TABLE strategic_goal ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategic_goal FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strategic_goal_tenant_isolation ON strategic_goal;
CREATE POLICY strategic_goal_tenant_isolation ON strategic_goal
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

-- ---------- 4. Cross-tenant self-test ----------
-- Seeds as org A with its own context set, so each insert satisfies its
-- own table's WITH CHECK, rather than disabling RLS table by table.
-- Only `organization` needs the narrow disable bracket (HANDOFF 6b):
-- inserting two orgs means one of them can never match a single active
-- context, whichever one is set.
--
-- If this block is more trouble than it is worth in a given
-- environment, it is safe to delete entirely -- everything above it is
-- the actual migration. Keep `SELECT assert_rls_coverage();` either way.

DO $$
DECLARE
  org_a UUID := gen_random_uuid();
  org_b UUID := gen_random_uuid();
  user_a UUID := gen_random_uuid();
  leaked INT;
BEGIN
  PERFORM set_config('app.current_org', org_a::text, true);

  ALTER TABLE organization DISABLE ROW LEVEL SECURITY;
  INSERT INTO organization (id, name) VALUES (org_a, 'RLS test A'), (org_b, 'RLS test B');
  ALTER TABLE organization ENABLE ROW LEVEL SECURITY;

  INSERT INTO app_user (id, organization_id, email, display_name)
    VALUES (user_a, org_a, 'rlstest-a@example.invalid', 'RLS Test A');
  INSERT INTO strategic_goal (id, organization_id, name, goal_year, declared_by)
    VALUES (gen_random_uuid(), org_a, 'Org A objective', 2026, user_a);

  -- The actual test: switch to org B, confirm org A's row is invisible.
  PERFORM set_config('app.current_org', org_b::text, true);
  SELECT count(*) INTO leaked FROM strategic_goal WHERE organization_id = org_a;
  IF leaked <> 0 THEN
    RAISE EXCEPTION 'RLS leak: org B saw % of org A strategic_goal rows', leaked;
  END IF;

  -- Cleanup, back in org A's context so the deletes can see their rows.
  PERFORM set_config('app.current_org', org_a::text, true);
  DELETE FROM strategic_goal WHERE organization_id = org_a;
  DELETE FROM app_user WHERE organization_id = org_a;

  ALTER TABLE organization DISABLE ROW LEVEL SECURITY;
  DELETE FROM organization WHERE id IN (org_a, org_b);
  ALTER TABLE organization ENABLE ROW LEVEL SECURITY;

  PERFORM set_config('app.current_org', '', true);
END $$;

SELECT assert_rls_coverage();

COMMIT;