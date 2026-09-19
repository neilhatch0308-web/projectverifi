-- 66_change_control_baselines.sql
--
-- Post-approval change control, step 1 of 5: baseline versions and the
-- change request wrapper.
--
-- THE GAP. The process flow draws a RE-BASE loop (which aspect is
-- moving, accountable seat approves, prior + new value recorded). Only
-- part of it was ever built: kpi_definition_revision (migration 09)
-- was dropped in migration 38 without a replacement, scope and
-- timescale have no change path at all (planned_end_date has no update
-- route by design), and migration 54 covers spend/benefits/risks only,
-- as separate unrelated log rows. Nothing groups "cost too high, so
-- descope" into one traceable event, and delivery has no concept of
-- "the baseline as currently agreed".
--
-- THE MODEL.
--   1. The ask (raise/accept) stays permanently anchored where it
--      already is: demand.claimed_cost / claimed_benefit, and
--      kpi_definition rows. Nothing here touches them.
--   2. The commitment (business case approval) becomes baseline v1.
--      Every later change is a change_request that produces a new,
--      immutable baseline version (v2, v3, ...) linked to its
--      predecessor.
--   3. The CURRENT baseline is never stored -- it is the highest
--      version for the demand (view business_case_current_baseline).
--      Same derive-don't-duplicate rule as Portfolio Budget's Current.
--   4. Descoped success measures are recorded in kpi_descope, NOT by
--      editing kpi_definition (which trg_block_criterion_edit locks
--      after acceptance, correctly). The original measure stays
--      untouched; the descope is a separate, insert-only fact.
--
-- WHAT THIS DELIBERATELY DOES NOT DO (later steps):
--   - who decided / attestation / tolerance / required level (step 2)
--   - held state for confidential deciders (step 3)
--   - confirm / dispute and My Home (step 4)
--   - reporting (step 5)
--   - close the older direct post-approval edit routes from 54. Until
--     step 2 they remain a second, parallel way to change approved
--     figures. Flagged, not fixed here.
--
-- BACKFILL HONESTY. Business cases already approved get a v1 flagged
-- backfilled = true. Cost is reconstructed from the earliest logged
-- approved_amount revision if one exists, else the current figure.
-- Benefit total cannot be reconstructed (no snapshot was ever taken),
-- so it is the current sum. The flag exists so nobody mistakes a
-- reconstructed v1 for a captured one.

BEGIN;

-- ---------- 1. change_request (the wrapper) ----------
CREATE TABLE change_request (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organization(id),
  demand_id        UUID NOT NULL REFERENCES demand(id),
  business_case_id UUID NOT NULL REFERENCES business_case(id),
  reason           TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by       UUID NOT NULL REFERENCES app_user(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_change_request_demand ON change_request (demand_id, created_at DESC);

-- ---------- 2. baseline_version ----------
CREATE TABLE baseline_version (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organization(id),
  demand_id         UUID NOT NULL REFERENCES demand(id),
  business_case_id  UUID NOT NULL REFERENCES business_case(id),
  version_number    INT  NOT NULL CHECK (version_number >= 1),
  kind              TEXT NOT NULL CHECK (kind IN ('approved', 'rebase')),
  predecessor_id    UUID REFERENCES baseline_version(id),
  change_request_id UUID REFERENCES change_request(id),
  approved_cost     NUMERIC(14,2),
  benefit_total     NUMERIC(14,2),
  planned_end_date  DATE,
  scope_summary     TEXT,
  backfilled        BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID REFERENCES app_user(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (demand_id, version_number),
  -- v1 is the approval itself and has no predecessor or change request;
  -- every later version has both.
  CONSTRAINT baseline_version_shape CHECK (
    (kind = 'approved' AND version_number = 1 AND predecessor_id IS NULL AND change_request_id IS NULL)
    OR
    (kind = 'rebase' AND version_number > 1 AND predecessor_id IS NOT NULL AND change_request_id IS NOT NULL)
  )
);
CREATE INDEX idx_baseline_version_bc ON baseline_version (business_case_id, version_number DESC);

-- ---------- 3. kpi_descope (insert-only) ----------
CREATE TABLE kpi_descope (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organization(id),
  kpi_definition_id UUID NOT NULL UNIQUE REFERENCES kpi_definition(id),
  change_request_id UUID NOT NULL REFERENCES change_request(id),
  created_by        UUID NOT NULL REFERENCES app_user(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 4. Group existing revision rows under a change request ----------
ALTER TABLE business_case_revision
  ADD COLUMN change_request_id UUID REFERENCES change_request(id);
CREATE INDEX idx_business_case_revision_cr ON business_case_revision (change_request_id)
  WHERE change_request_id IS NOT NULL;

-- ---------- 5. Immutability: insert-only, enforced in the database ----------
CREATE OR REPLACE FUNCTION block_change_control_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is insert-only. Record a new change request instead of editing history.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_change_request_immutable BEFORE UPDATE OR DELETE ON change_request
  FOR EACH ROW EXECUTE FUNCTION block_change_control_mutation();
CREATE TRIGGER trg_baseline_version_immutable BEFORE UPDATE OR DELETE ON baseline_version
  FOR EACH ROW EXECUTE FUNCTION block_change_control_mutation();
CREATE TRIGGER trg_kpi_descope_immutable BEFORE UPDATE OR DELETE ON kpi_descope
  FOR EACH ROW EXECUTE FUNCTION block_change_control_mutation();

-- ---------- 6. Backfill v1 for business cases already approved ----------
-- Same narrow RLS bypass as migration 63: a migration acts for no
-- tenant, so with app.current_org unset the owning role sees zero rows.
-- Disabled only for this statement, restored (with FORCE) straight after.
ALTER TABLE demand DISABLE ROW LEVEL SECURITY;
ALTER TABLE business_case DISABLE ROW LEVEL SECURITY;
ALTER TABLE investment DISABLE ROW LEVEL SECURITY;
ALTER TABLE benefit DISABLE ROW LEVEL SECURITY;
ALTER TABLE demand_delivery DISABLE ROW LEVEL SECURITY;
ALTER TABLE business_case_revision DISABLE ROW LEVEL SECURITY;

INSERT INTO baseline_version
  (organization_id, demand_id, business_case_id, version_number, kind,
   approved_cost, benefit_total, planned_end_date, scope_summary, backfilled, created_by, created_at)
SELECT bc.organization_id, bc.demand_id, bc.id, 1, 'approved',
       COALESCE(
         (SELECT (r.prior_value #>> '{}')::numeric
            FROM business_case_revision r
           WHERE r.business_case_id = bc.id AND r.field = 'approved_amount'
           ORDER BY r.changed_at ASC LIMIT 1),
         (SELECT i.approved_amount FROM investment i WHERE i.business_case_id = bc.id)
       ),
       (SELECT SUM(b.claimed_value) FROM benefit b WHERE b.business_case_id = bc.id),
       (SELECT dd.planned_end_date FROM demand_delivery dd WHERE dd.demand_id = bc.demand_id),
       COALESCE(d.outcome_statement, d.title),
       true,
       NULL,
       COALESCE(bc.decision_date::timestamptz, bc.created_at)
  FROM business_case bc
  JOIN demand d ON d.id = bc.demand_id
 WHERE bc.decision = 'approved'
   AND bc.demand_id IS NOT NULL;

ALTER TABLE demand ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand FORCE ROW LEVEL SECURITY;
ALTER TABLE business_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_case FORCE ROW LEVEL SECURITY;
ALTER TABLE investment ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment FORCE ROW LEVEL SECURITY;
ALTER TABLE benefit ENABLE ROW LEVEL SECURITY;
ALTER TABLE benefit FORCE ROW LEVEL SECURITY;
ALTER TABLE demand_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_delivery FORCE ROW LEVEL SECURITY;
ALTER TABLE business_case_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_case_revision FORCE ROW LEVEL SECURITY;

-- ---------- 7. RLS on the new tables (after the backfill) ----------
ALTER TABLE change_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_change_request ON change_request
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

ALTER TABLE baseline_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_baseline_version ON baseline_version
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

ALTER TABLE kpi_descope ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_descope FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_kpi_descope ON kpi_descope
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

-- ---------- 8. Current baseline: derived, never stored ----------
-- Not confidentiality-filtered (same contract as every cross-cutting
-- view here): the calling route must apply can_view_confidential_demand().
CREATE VIEW business_case_current_baseline AS
SELECT DISTINCT ON (bv.demand_id)
       bv.demand_id, bv.business_case_id, bv.id AS baseline_version_id,
       bv.version_number, bv.kind, bv.approved_cost, bv.benefit_total,
       bv.planned_end_date, bv.scope_summary, bv.created_at
  FROM baseline_version bv
 ORDER BY bv.demand_id, bv.version_number DESC;

COMMENT ON TABLE baseline_version IS
  'Immutable commitment chain per demand. v1 = business case approval, v2+ = re-bases via change_request. Original ask lives on demand/kpi_definition and is never touched here.';

SELECT assert_rls_coverage();

COMMIT;
