-- 57_audit_trail_readable_values.sql
--
-- Bug in migration 55's view, found the moment a real history was read:
-- portfolio reassignment rows rendered as raw UUIDs --
--
--   Raising portfolio reassigned
--   Neil Hatch . 453a83f2-...-c6014b3494 -> 3d152e8f-...-b9be295dc60
--
-- The underlying audit tables correctly store foreign keys, but the
-- view passed them straight through as text into prior_value/new_value,
-- which are what the UI displays. A person reading their own demand's
-- history cannot be expected to resolve a portfolio UUID by eye.
--
-- Fixed by resolving names inside the view rather than in the route:
-- the view is the single place this data is assembled, so a second
-- consumer (a report, an export) gets readable values for free instead
-- of each caller re-deriving the same joins. Consistent with this
-- schema's existing "one source of truth, derive rather than duplicate"
-- house style (decision 75).
--
-- Same class of fix applied to confidential viewer add/revoke, which
-- recorded WHO was added only in reference_id (a UUID the UI never
-- shows), leaving those rows reading as a bare actor and timestamp with
-- no indication of who was actually granted or lost access.
--
-- COALESCE(..., '(deleted)') guards the case where a referenced
-- portfolio or user row no longer exists -- an audit trail must still
-- render an event whose subject has since been removed. Showing
-- '(deleted)' is honest; a blank or a crash is not.
--
-- Column names, types and order are unchanged, so CREATE OR REPLACE
-- VIEW is valid here (Postgres rejects REPLACE if the shape changes).

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
  SELECT demand_id, assessed_at, 'assessed', assessed_by, NULL,
         NULL, assessed_cost::TEXT || ' / ' || assessed_benefit::TEXT, recommendation
    FROM demand_assessment WHERE assessed_at IS NOT NULL

  UNION ALL
  SELECT demand_id, set_at, 'raci_named', set_by, NULL, NULL, NULL, NULL
    FROM demand_raci WHERE set_at IS NOT NULL

  -- Delivering sub-portfolio: from may legitimately be NULL
  -- ("not yet categorised"), so that reads as '(unassigned)', which is
  -- a real prior state rather than missing data.
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
  'One chronological feed per demand across every currently-live audit source in this schema. Foreign keys are resolved to display names here rather than in the calling route, so every consumer gets readable values (migration 57). Not itself tenant-filtered -- callers must always query it with WHERE demand_id = $1 after their own can_view_confidential_demand() check, same as every other confidential-demand read path. Excludes demand_field_revision and demand_score_revision (schema-only) -- extend this view in the same migration that wires either one up.';

COMMIT;
