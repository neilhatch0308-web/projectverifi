-- 55_demand_audit_trail.sql
--
-- What already existed before this migration: RPVF's house style has
-- always been "prior value, new value, reason, who, when" -- but spread
-- across nine separate tables (demand_portfolio_assignment_history,
-- demand_raising_portfolio_reassignment, demand_target_year_reassignment,
-- annual_plan_item.reason/moved_by/moved_at, business_case_revision,
-- demand.triaged_by/at + stopped_by/at, demand_assessment.assessed_by/at,
-- demand_confidential_viewer.added_by/at), with no single place that
-- stitches "everything that happened to demand X" into one timeline.
--
-- This migration does two things:
--
-- 1. Closes four REAL gaps found while reviewing lifecycle coverage:
--    a) Revoking a confidential viewer was a hard DELETE -- the fact
--       someone was ever granted access disappeared along with the
--       grant itself. demand_confidential_viewer_revocation is
--       insert-only and written at the moment of removal, so the grant
--       history survives.
--    b) There was no record of who actually VIEWED a confidential
--       demand, only who's currently allowed to. demand_confidential_
--       access_log is the "used it" fact, separate from "granted it".
--       High-volume by nature, so deliberately thin: no reason field,
--       fire-and-forget, insert-only.
--    c) demand_raci had no actor column at all -- RACI seats got named
--       at promotion with zero record of WHO named them, only when
--       (set_at). Added set_by, backfilled NULL for existing rows
--       (honest: we don't know who did it retroactively) and wired the
--       accept/promote route to populate it going forward.
--    d) No single read path across the nine existing sources --
--       demand_audit_trail view below.
--
-- 2. Adds demand_field_revision and demand_score_revision as prepared,
--    SCHEMA-ONLY infrastructure, matching this project's own existing
--    convention for "the shape is right, the route doesn't exist yet"
--    (see Delivery/Adoption/Realisation in framework doc v1.0). Neither
--    table has a route writing to it as of this migration:
--      - demand_field_revision: title/description/outcome_statement
--        have no PATCH route at all today (confirmed against actual
--        route code, not assumed) -- there's nothing to audit yet
--        because there's no edit path yet. When one gets built, it
--        should write here.
--      - demand_score_revision: demand_score is INSERT-only at raise
--        time; no route exists to re-score an already-raised demand.
--        Same situation -- prepared, not wired.
--    Both are left out of demand_audit_trail's UNION below for the
--    same reason: a view sourcing from a table nothing ever writes to
--    would just be a permanent empty branch. Add them to the view the
--    same migration that adds the routes which populate them.

BEGIN;

-- ---------- 1a. Confidential viewer revocation (insert-only) ----------

CREATE TABLE demand_confidential_viewer_revocation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),
  demand_id       UUID NOT NULL REFERENCES demand(id),
  user_id         UUID NOT NULL,              -- the viewer who was removed
  originally_added_by UUID,                    -- carried over from the deleted grant row, if known
  originally_added_at TIMESTAMPTZ,
  revoked_by      UUID NOT NULL REFERENCES app_user(id),
  revoked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_confidential_viewer_revocation_demand ON demand_confidential_viewer_revocation (demand_id);

COMMENT ON TABLE demand_confidential_viewer_revocation IS
  'Written at the moment a demand_confidential_viewer row is deleted, so the fact someone was once granted access to a confidential demand survives the revocation. Insert-only -- no update or delete route should ever exist for this table.';

ALTER TABLE demand_confidential_viewer_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_confidential_viewer_revocation FORCE ROW LEVEL SECURITY;

CREATE POLICY demand_confidential_viewer_revocation_tenant_isolation ON demand_confidential_viewer_revocation
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

-- ---------- 1b. Confidential access log (insert-only, high-volume) ----------

CREATE TABLE demand_confidential_access_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),
  demand_id       UUID NOT NULL REFERENCES demand(id),
  viewed_by       UUID NOT NULL REFERENCES app_user(id),
  viewed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Which of can_view_confidential_demand()'s branches let them in --
  -- raiser / named_viewer / assessor / raci / business_case. Recorded
  -- at write time since it's derived-live and could change later.
  access_basis    TEXT NOT NULL
);

CREATE INDEX idx_confidential_access_log_demand ON demand_confidential_access_log (demand_id, viewed_at DESC);

COMMENT ON TABLE demand_confidential_access_log IS
  'One row per successful confidential-demand detail view. Distinct from demand_confidential_viewer (who is CURRENTLY allowed) -- this is who actually looked, and when. Deliberately thin (no reason field) since it is fire-and-forget on every read, not a reason-carrying governance action. Never write this synchronously in the same transaction as the read it logs -- a logging failure must not block a legitimate view.';

ALTER TABLE demand_confidential_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_confidential_access_log FORCE ROW LEVEL SECURITY;

CREATE POLICY demand_confidential_access_log_tenant_isolation ON demand_confidential_access_log
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

-- ---------- 1c. demand_raci actor column (completeness fix) ----------

ALTER TABLE demand_raci ADD COLUMN set_by UUID REFERENCES app_user(id);

COMMENT ON COLUMN demand_raci.set_by IS
  'Who named the RACI seats at promotion. NULL for any row created before this migration -- genuinely unknown, not backfilled with a guess. Populated going forward by POST /demands/:id/accept.';

-- ---------- 2. Schema-only prepared infrastructure (no route yet) ----------

CREATE TABLE demand_field_revision (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),
  demand_id       UUID NOT NULL REFERENCES demand(id),
  field           TEXT NOT NULL CHECK (field IN ('title', 'description', 'outcome_statement')),
  prior_value     TEXT,
  new_value       TEXT,
  reason          TEXT,
  changed_by      UUID NOT NULL REFERENCES app_user(id),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_demand_field_revision_demand ON demand_field_revision (demand_id, changed_at DESC);

COMMENT ON TABLE demand_field_revision IS
  'SCHEMA-ONLY as of migration 55 -- no route writes to this yet, because title/description/outcome_statement have no edit route at all today. Prepared ahead of one being built, matching this schema''s existing convention for staged capability (see demand_delivery pre-migration-52). Do not add this to demand_audit_trail until a real write path exists.';

ALTER TABLE demand_field_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_field_revision FORCE ROW LEVEL SECURITY;

CREATE POLICY demand_field_revision_tenant_isolation ON demand_field_revision
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

CREATE TABLE demand_score_revision (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),
  demand_id       UUID NOT NULL REFERENCES demand(id),
  criterion_id    UUID NOT NULL REFERENCES scoring_criterion(id),
  prior_score     NUMERIC(5,2),
  new_score       NUMERIC(5,2) NOT NULL,
  reason          TEXT,
  changed_by      UUID NOT NULL REFERENCES app_user(id),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_demand_score_revision_demand ON demand_score_revision (demand_id, changed_at DESC);

COMMENT ON TABLE demand_score_revision IS
  'SCHEMA-ONLY as of migration 55 -- no route re-scores an already-raised demand today; demand_score is INSERT-only at raise. Prepared ahead of a re-scoring route being built. Do not add this to demand_audit_trail until one exists.';

ALTER TABLE demand_score_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_score_revision FORCE ROW LEVEL SECURITY;

CREATE POLICY demand_score_revision_tenant_isolation ON demand_score_revision
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

-- ---------- 3. Unified read path across every LIVE source ----------
-- "Derive rather than duplicate" (decision 75) -- a view, not a table
-- that gets written to. Every branch below already had a real write
-- path before this migration except demand_confidential_viewer_
-- revocation and the demand_raci.set_by column, both added above.
--
-- Row-level security note: this view has no policy of its own (views
-- can't carry RLS) -- it inherits tenant isolation from the FORCE ROW
-- LEVEL SECURITY policies on every underlying table, since the view
-- runs with the querying role's own permissions (not a SECURITY
-- DEFINER function), same as annual_plan_totals and the other existing
-- views in this schema.

CREATE VIEW demand_audit_trail AS
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

  UNION ALL
  SELECT demand_id, changed_at, 'delivering_portfolio_reassigned', changed_by,
         to_sub_portfolio_id, from_sub_portfolio_id::TEXT, to_sub_portfolio_id::TEXT, reason
    FROM demand_portfolio_assignment_history

  UNION ALL
  SELECT demand_id, changed_at, 'raising_portfolio_reassigned', changed_by,
         to_portfolio_id, from_portfolio_id::TEXT, to_portfolio_id::TEXT, reason
    FROM demand_raising_portfolio_reassignment

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
         v.user_id, NULL, NULL, NULL
    FROM demand_confidential_viewer v

  UNION ALL
  SELECT r.demand_id, r.revoked_at, 'confidential_viewer_revoked', r.revoked_by,
         r.user_id, NULL, NULL, NULL
    FROM demand_confidential_viewer_revocation r

  UNION ALL
  SELECT bc.demand_id, rev.changed_at, 'business_case_' || rev.field, rev.changed_by,
         rev.reference_id, rev.prior_value::TEXT, rev.new_value::TEXT, rev.reason
    FROM business_case_revision rev
    JOIN business_case bc ON bc.id = rev.business_case_id;

COMMENT ON VIEW demand_audit_trail IS
  'One chronological feed per demand across every currently-live audit source in this schema. Not itself tenant-filtered -- callers must always query it with WHERE demand_id = $1 (single-demand reads, matching how this view is actually used) after their own can_view_confidential_demand() check, same as every other confidential-demand read path. Excludes demand_field_revision and demand_score_revision (schema-only, see above) -- extend this view in the same migration that wires either one up.';

COMMIT;
