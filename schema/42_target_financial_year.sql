-- 42_target_financial_year.sql
-- Adds the Five-Year Horizon concept: a demand can carry a target
-- financial year (+ optional quarter span) independent of Annual
-- Planning's per-year committed envelope. Set at raise (by the
-- raiser) or at assessment (by the assessor) with no reason required
-- for the first-ever value -- matching the portfolio_budget_adjustment
-- pattern where only *changes* to an existing value need a reason.
--
-- Drag/resize on the Five-Year Horizon view is a distinct capability
-- from raising or assessing, gated by a new permission key, and every
-- such change is one reassignment event logged with a reason.

BEGIN;

-- ── demand: target year/quarter span ─────────────────────────────
ALTER TABLE demand
  ADD COLUMN target_start_year    INT,
  ADD COLUMN target_start_quarter SMALLINT CHECK (target_start_quarter BETWEEN 1 AND 4),
  ADD COLUMN target_end_year      INT,
  ADD COLUMN target_end_quarter   SMALLINT CHECK (target_end_quarter BETWEEN 1 AND 4),
  ADD COLUMN target_year_set_by   UUID REFERENCES app_user(id),
  ADD COLUMN target_year_set_at   TIMESTAMPTZ;

ALTER TABLE demand
  ADD CONSTRAINT target_span_order_check CHECK (
    target_start_year IS NULL
    OR target_end_year IS NULL
    OR target_end_year > target_start_year
    OR (target_end_year = target_start_year AND target_end_quarter >= target_start_quarter)
  );

-- A span implies a start; an end without a start is meaningless.
ALTER TABLE demand
  ADD CONSTRAINT target_span_requires_start CHECK (
    target_end_year IS NULL OR target_start_year IS NOT NULL
  );

COMMENT ON COLUMN demand.target_start_year IS
  'Five-Year Horizon: first FY this demand is realistically targeted for. Nullable -- not every demand is horizon-tagged. Distinct from date_driver_type (an externally fixed date) and from annual_plan (this year''s committed envelope).';
COMMENT ON COLUMN demand.target_end_year IS
  'Five-Year Horizon: last FY, for multi-year spans. NULL means single-quarter/single-year (end = start).';

CREATE INDEX idx_demand_target_start_year ON demand (target_start_year) WHERE target_start_year IS NOT NULL;

-- ── audit trail: one row per drag/resize reassignment ────────────
CREATE TABLE demand_target_year_reassignment (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),
  demand_id      UUID NOT NULL REFERENCES demand(id),
  from_year      INT NOT NULL,
  from_quarter   SMALLINT CHECK (from_quarter BETWEEN 1 AND 4),
  to_year        INT NOT NULL,
  to_quarter     SMALLINT CHECK (to_quarter BETWEEN 1 AND 4),
  from_end_year  INT,
  from_end_quarter SMALLINT CHECK (from_end_quarter BETWEEN 1 AND 4),
  to_end_year    INT,
  to_end_quarter SMALLINT CHECK (to_end_quarter BETWEEN 1 AND 4),
  reason         TEXT NOT NULL,
  changed_by     UUID NOT NULL REFERENCES app_user(id),
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_target_year_reassignment_demand ON demand_target_year_reassignment (demand_id);

COMMENT ON TABLE demand_target_year_reassignment IS
  'Audit trail for lead/admin drag or resize on the Five-Year Horizon view. One row per reassignment, even when a resize crosses a fiscal-year boundary -- start and end move together as a single event, not two.';

ALTER TABLE demand_target_year_reassignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_target_year_reassignment FORCE ROW LEVEL SECURITY;

CREATE POLICY demand_target_year_reassignment_tenant_isolation ON demand_target_year_reassignment
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

-- ── new permission key ────────────────────────────────────────────
INSERT INTO permission (key, label, description) VALUES (
  'demand.reassign_target_year',
  'Reassign target year (Five-Year Horizon)',
  'Drag or resize a demand''s target year/quarter span on the Five-Year Horizon view. Distinct from raising or assessing a demand -- this is the lead/admin override capability, and every use is reason-required and logged.'
);

COMMIT;
