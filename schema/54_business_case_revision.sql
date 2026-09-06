-- 54_business_case_revision.sql
--
-- Real gap found in practice: requested_spend, investment.approved_amount,
-- and the benefit/risk registers stayed freely editable for the entire
-- life of a business case, with zero awareness of whether a decision
-- had even been made -- a demand that's fully delivered and benefit-
-- realised could still have its originally-approved spend silently
-- rewritten via the same route used while the case was still being
-- built. None of this was gated on demand.status or bc.decision at
-- all; it simply never came up until delivery tracking (migration 52)
-- made it obvious something upstream was still moving underneath it.
--
-- Fix: once a business case reaches decision = 'approved', the figures
-- that decision was actually made on stop being freely editable.
-- Anything that genuinely needs to change after that point still can
-- -- this is not a hard lock -- but it now requires a reason and gets
-- written to this table, matching the same shape already used for
-- portfolio_budget_adjustment and the demand-level RE-BASE loop:
-- prior value, new value, reason, who, when. Before approval, nothing
-- changes -- the existing free-edit behaviour during case-building is
-- untouched.
--
-- What's covered:
--   - requested_spend (business_case)
--   - approved_amount (investment) -- actual_spend_to_date is
--     deliberately NOT covered here: that figure's entire purpose is
--     to move as real spend occurs, tracking it as a "revision" would
--     misrepresent normal, expected activity as an exception.
--   - benefit rows: both adding a new one and editing an existing one's
--     claimed_value/title/recurrence/duration_years
--   - business_case_risk: adding a new one
--
-- What's NOT covered, deliberately:
--   - risk status/mitigation updates -- ongoing risk management during
--     delivery is expected, normal activity, not a rewrite of the
--     original case.
--   - risk likelihood/impact -- no route has ever existed to edit
--     these after creation (confirmed against actual route code, not
--     assumed), so they were already effectively locked before this
--     migration.
--   - risk deletion -- this migration removes the ability to delete a
--     risk once a business case is approved, full stop, no tracked
--     path around it. A risk from the approved case is part of the
--     record; if it's no longer relevant, its status becomes 'closed'
--     via the existing PATCH route, not erased.

BEGIN;

CREATE TABLE business_case_revision (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organization(id),
  business_case_id UUID NOT NULL REFERENCES business_case(id),
  field            TEXT NOT NULL CHECK (field IN (
                     'requested_spend', 'approved_amount',
                     'benefit_added', 'benefit_edited', 'risk_added'
                   )),
  -- Set for benefit_added/benefit_edited only -- the benefit row this
  -- revision concerns. NULL for requested_spend/approved_amount,
  -- which apply to the business case as a whole.
  reference_id     UUID,
  prior_value      JSONB,
  new_value        JSONB,
  reason           TEXT NOT NULL,
  changed_by       UUID NOT NULL REFERENCES app_user(id),
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_case_revision_case ON business_case_revision (business_case_id, changed_at DESC);

COMMENT ON TABLE business_case_revision IS
  'Audit trail for changes to requested_spend, approved_amount, benefits, or new risks made AFTER a business case reaches decision = approved. Before approval, no revision rows are created -- the case is still being built and free editing is expected. After approval, the underlying tables (business_case, investment, benefit, business_case_risk) still get updated/inserted as normal -- this table exists so the change itself, and why it was made, is never lost.';

ALTER TABLE business_case_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_case_revision FORCE ROW LEVEL SECURITY;

CREATE POLICY business_case_revision_tenant_isolation ON business_case_revision
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

COMMIT;
