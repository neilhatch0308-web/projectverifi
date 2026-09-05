-- 47_confidential_named_viewers.sql
--
-- Replaces the old blanket demand.view_confidential permission (which
-- granted visibility into EVERY confidential demand org-wide) with a
-- genuine per-demand access list. A demand affecting a small number of
-- people -- the framework's own example is a redundancy round -- needs
-- a restricted, named circle of viewers, not "everyone who happens to
-- hold a role."
--
-- Visibility for a confidential demand is the union of:
--   1. Whoever raised it
--   2. Whoever is explicitly named in demand_confidential_viewer
--   3. Whoever is CURRENTLY ASSIGNED to work it -- the tagged assessor,
--      any of the five RACI seats, or (once promoted) the business
--      case's sponsor or submitter. Being assigned the work grants
--      visibility to do it; this is deliberately live/derived rather
--      than a copy, so reassigning the assessor or renaming a RACI
--      seat immediately changes who can see it, with nothing to keep
--      in sync.
--
-- No admin override exists. org.manage does NOT see confidential
-- demands by default -- the named list is the only way in, by design,
-- with no exceptions. This is a deliberate, considered choice, not an
-- oversight: continuity if a raiser leaves the organisation is a real
-- gap this creates, and should be handled by a *named* successor
-- being added to the list by someone who can already see it, not by a
-- standing admin backdoor.
--
-- The old demand.view_confidential permission catalog row is left in
-- place (matching how portfolio_budget_transfer was retired: not
-- deleted, just no longer live) -- any role that already has it
-- ticked keeps showing it ticked in Roles admin, but no route checks
-- it anymore as of this migration.

BEGIN;

CREATE TABLE demand_confidential_viewer (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),
  demand_id       UUID NOT NULL REFERENCES demand(id),
  user_id         UUID NOT NULL REFERENCES app_user(id),
  added_by        UUID NOT NULL REFERENCES app_user(id),
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (demand_id, user_id)
);

CREATE INDEX idx_confidential_viewer_demand ON demand_confidential_viewer (demand_id);

COMMENT ON TABLE demand_confidential_viewer IS
  'Explicitly named viewers for a confidential demand, on top of the raiser and whoever is currently assigned to work it (see can_view_confidential_demand()). Only someone who can already see the demand may add or remove a name here -- an append/revoke circle of trust, not an admin-managed list.';

ALTER TABLE demand_confidential_viewer ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_confidential_viewer FORCE ROW LEVEL SECURITY;

CREATE POLICY demand_confidential_viewer_tenant_isolation ON demand_confidential_viewer
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

-- Single source of truth for "can this user see this confidential
-- demand" -- every route that needs the check calls this rather than
-- re-deriving the OR-chain locally. STABLE (not VOLATILE) since it
-- only reads within the current transaction snapshot, which lets
-- Postgres use it freely inside a larger WHERE clause.
CREATE OR REPLACE FUNCTION can_view_confidential_demand(p_demand_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM demand d WHERE d.id = p_demand_id AND d.raised_by = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM demand_confidential_viewer v
     WHERE v.demand_id = p_demand_id AND v.user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM demand d WHERE d.id = p_demand_id AND d.assigned_assessor_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM demand_raci r
     WHERE r.demand_id = p_demand_id
       AND p_user_id IN (r.accountable_financial_id, r.accountable_scope_id,
                          r.accountable_schedule_id, r.sponsor_id, r.benefit_owner_id)
  )
  OR EXISTS (
    SELECT 1 FROM business_case bc
     WHERE bc.demand_id = p_demand_id
       AND p_user_id IN (bc.sponsor_user_id, bc.submitted_by)
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION can_view_confidential_demand IS
  'True if p_user_id can see p_demand_id despite it being confidential: raiser, named viewer, tagged assessor, any RACI seat, or (once promoted) the business case sponsor/submitter. Derived live from current assignments -- reassigning any of these roles immediately changes visibility, nothing to keep in sync manually.';

COMMIT;
