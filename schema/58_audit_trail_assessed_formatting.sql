-- 58_audit_trail_assessed_formatting.sql
--
-- Same class of readability gap as migration 57, flagged at the same
-- time but deferred rather than bundled in: the Assessed (P75) row
-- rendered as bare, unlabelled numbers --
--
--   Assessed (P75)
--   Neil Hatch . 10000.00 / 28000.00
--   "proceed"
--
-- No currency symbol, no thousands separator, and nothing tells the
-- reader which number is cost and which is benefit -- readable only if
-- you already know the column order. Reformatted to:
--
--   Assessed (P75)
--   Neil Hatch . Cost: 10,000.00 / Benefit: 28,000.00
--   "proceed"
--
-- Currency is deliberately NOT prefixed here (no hardcoded £) -- every
-- other money figure in this schema is GBP-only by convention
-- (demand.currency and business_case.currency both default 'GBP' but
-- are "not surfaced anywhere" per DATABASE_SCHEMA_REFERENCE.md), and
-- the UI layer is the existing place that decides currency display
-- (see DemandDetail.tsx's own `money()` helper for the delivery
-- panel). Labels and separators belong in the view since every
-- consumer wants them; currency formatting stays a UI concern so it
-- doesn't need a schema change the day this becomes multi-currency.
--
-- Uses to_char(..., 'FM999,999,999,990.00') for the separator --
-- 'FM' suppresses the fixed-width padding to_char applies by default,
-- which would otherwise left-pad every value with spaces.
--
-- Individually NULL cost/benefit (assessment recorded with only one
-- side confident enough to state) renders as 'not recorded' for that
-- side rather than silently dropping it or showing a blank half of
-- the string.
--
-- Column names, types and order are unchanged from migration 57, so
-- CREATE OR REPLACE VIEW is valid.

BEGIN;

CREATE OR REPLACE VIEW demand_audit_trail AS
  SELECT id AS demand_id, created_at AS event_at, 'raised' AS event_type,
         raised_by AS actor_id, NULL::UUID AS reference_id,
         NULL::TEXT AS prior_value, NULL::TEXT AS new_value, NULL::TEXT AS reason
    FROM demand

  UNION ALL
  SELECT id, triaged_at, 'triaged', triaged_by, NULL, NULL, complexity_tier, triage_notes
    FROM demand WHERE triaged_at IS NOT NULL

  UNION ALL
  SELECT id, stopped_at, 'stopped', stopped_by, NULL, NULL, NULL, stop_reason
    FROM demand WHERE stopped_at IS NOT NULL

  UNION ALL
  SELECT id, accepted_at, 'promoted', NULL, NULL, NULL, NULL, NULL
    FROM demand WHERE accepted_at IS NOT NULL

  UNION ALL
  SELECT demand_id, assessed_at, 'assessed', assessed_by, NULL, NULL,
         'Cost: ' || COALESCE(to_char(assessed_cost, 'FM999,999,999,990.00'), 'not recorded') ||
         ' / Benefit: ' || COALESCE(to_char(assessed_benefit, 'FM999,999,999,990.00'), 'not recorded'),
         recommendation
    FROM demand_assessment WHERE assessed_at IS NOT NULL

  UNION ALL
  SELECT demand_id, set_at, 'raci_named', set_by, NULL, NULL, NULL, NULL
    FROM demand_raci WHERE set_at IS NOT NULL

  UNION ALL
  SELECT h.demand_id, h.changed_at, 'delivering_portfolio_reassigned', h.changed_by,
         h.to_sub_portfolio_id,
         COALESCE(pf.name, CASE WHEN h.from_sub_portfolio_id IS NULL THEN '(unassigned)' ELSE '(deleted)' END),
         COALESCE(pt.name, CASE WHEN h.to_sub_portfolio_id IS NULL THEN '(unassigned)' ELSE '(deleted)' END),
         h.reason
    FROM demand_portfolio_assignment_history h
    LEFT JOIN portfolio pf ON pf.id = h.from_sub_portfolio_id
    LEFT JOIN portfolio pt ON pt.id = h.to_sub_portfolio_id

  UNION ALL
  SELECT r.demand_id, r.changed_at, 'raising_portfolio_reassigned', r.changed_by,
         r.to_portfolio_id,
         COALESCE(pf.name, '(deleted)'),
         COALESCE(pt.name, '(deleted)'),
         r.reason
    FROM demand_raising_portfolio_reassignment r
    LEFT JOIN portfolio pf ON pf.id = r.from_portfolio_id
    LEFT JOIN portfolio pt ON pt.id = r.to_portfolio_id

  UNION ALL
  SELECT demand_id, changed_at, 'target_year_reassigned', changed_by, NULL,
         from_year::TEXT || '-Q' || from_quarter::TEXT,
         to_year::TEXT || '-Q' || to_quarter::TEXT, reason
    FROM demand_target_year_reassignment

  UNION ALL
  SELECT demand_id, moved_at, 'annual_plan_placement', moved_by, plan_id,
         NULL, column_placement, reason
    FROM annual_plan_item WHERE moved_at IS NOT NULL

  UNION ALL
  SELECT v.demand_id, v.added_at, 'confidential_viewer_added', v.added_by,
         v.user_id, NULL, COALESCE(u.display_name, '(deleted)'), NULL
    FROM demand_confidential_viewer v
    LEFT JOIN app_user u ON u.id = v.user_id

  UNION ALL
  SELECT r.demand_id, r.revoked_at, 'confidential_viewer_revoked', r.revoked_by,
         r.user_id, COALESCE(u.display_name, '(deleted)'), NULL, NULL
    FROM demand_confidential_viewer_revocation r
    LEFT JOIN app_user u ON u.id = r.user_id

  UNION ALL
  SELECT bc.demand_id, rev.changed_at, 'business_case_' || rev.field, rev.changed_by,
         rev.reference_id, rev.prior_value::TEXT, rev.new_value::TEXT, rev.reason
    FROM business_case_revision rev
    JOIN business_case bc ON bc.id = rev.business_case_id;

COMMENT ON VIEW demand_audit_trail IS
  'One chronological feed per demand across every currently-live audit source in this schema. Foreign keys are resolved to display names and money figures are labelled with thousands separators here rather than in the calling route, so every consumer gets readable values (migrations 57, 58). Not itself tenant-filtered -- callers must always query it with WHERE demand_id = $1 after their own can_view_confidential_demand() check, same as every other confidential-demand read path. Excludes demand_field_revision and demand_score_revision (schema-only) -- extend this view in the same migration that wires either one up.';

COMMIT;
