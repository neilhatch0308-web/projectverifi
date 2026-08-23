-- ============================================================
-- 11_programme_layer.sql
--
-- Adds `programme` — a grouping of one or more business_case (project)
-- rows, governed the same way individual projects are: a named sponsor,
-- an optional link to a strategic goal, and its own rollup view.
--
-- A programme is NOT a duplicate of business_case_raci's full 5-seat
-- model — day-to-day accountability (financial/scope/schedule) still
-- sits at the individual project level, since that's where re-basing
-- decisions actually get made. The programme layer adds a level of
-- oversight above that, not a parallel accountability structure.
--
-- Depends on: 01_benefits_tracker_core.sql, 09_rpvf_dimensions_and_governance.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS programme (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organization(id),
    name                TEXT NOT NULL,
    description         TEXT,
    sponsor_user_id     UUID REFERENCES app_user(id),   -- programme-level exec sponsor, may differ from any one project's sponsor
    status              TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','closed','cancelled')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at           TIMESTAMPTZ
);

-- One project belongs to zero or one programme — kept as a nullable FK on
-- business_case rather than a join table, since a project can't sensibly
-- serve two programmes at once (unlike strategic_goal, which is many-to-many
-- by design). If that assumption's wrong, this becomes a join table instead.
ALTER TABLE business_case
    ADD COLUMN IF NOT EXISTS programme_id UUID REFERENCES programme(id);

-- A programme can also link to a strategic goal directly — for cases where
-- the programme as a whole serves a goal even if not every child project does
CREATE TABLE IF NOT EXISTS programme_goal_link (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    programme_id        UUID NOT NULL REFERENCES programme(id),
    strategic_goal_id   UUID NOT NULL REFERENCES strategic_goal(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (programme_id, strategic_goal_id)
);

-- ---------- Rollup: spend, claimed value, and dis-benefits across all
-- projects in a programme. Same non-summing caution as portfolio_value_by_goal
-- applies if a programme's child projects ALSO individually link to goals —
-- don't add the programme-level and project-level numbers together.
CREATE OR REPLACE VIEW programme_rollup AS
SELECT
    p.id AS programme_id,
    p.name,
    p.status,
    count(DISTINCT bc.id) AS project_count,
    sum(i.actual_spend_to_date) AS total_spend,
    sum(b.claimed_value) FILTER (WHERE b.status = 'realized') AS total_realized_value,
    sum(db.value) AS total_dis_benefit_value
FROM programme p
LEFT JOIN business_case bc ON bc.programme_id = p.id
LEFT JOIN investment i ON i.business_case_id = bc.id
LEFT JOIN benefit b ON b.business_case_id = bc.id
LEFT JOIN dis_benefit db ON db.business_case_id = bc.id
GROUP BY p.id, p.name, p.status;

-- ---------- Outcome-class distribution rolled up to programme level ----------
-- (mirrors outcome_class_distribution from 09, scoped down one level)
CREATE OR REPLACE VIEW programme_outcome_distribution AS
SELECT
    bc.programme_id,
    rc.outcome_classification,
    count(*) AS n
FROM realization_check rc
JOIN benefit b ON b.id = rc.benefit_id
JOIN business_case bc ON bc.id = b.business_case_id
WHERE rc.outcome_classification IS NOT NULL
  AND bc.programme_id IS NOT NULL
GROUP BY bc.programme_id, rc.outcome_classification;

-- ---------- Indexes ----------
CREATE INDEX IF NOT EXISTS idx_programme_org ON programme(organization_id);
CREATE INDEX IF NOT EXISTS idx_case_programme ON business_case(programme_id);
CREATE INDEX IF NOT EXISTS idx_programme_goal_link ON programme_goal_link(programme_id);

-- ============================================================
-- Design notes:
-- 1. A programme deliberately does NOT get its own kpi_definition /
--    success-criteria rows. Its "success" is the aggregate of its child
--    projects' criteria — programme_rollup and programme_outcome_distribution
--    are the read-side answer to "how's the programme doing," not a
--    parallel set of programme-level targets to define and maintain.
--    Revisit this if a programme ever needs a target that ISN'T just the
--    sum of its projects (e.g. "cut integration overhead by 30% across
--    the consolidation programme" as a standalone claim) — that would need
--    its own kpi_definition with a programme_id column, not added here
--    since it wasn't asked for.
-- 2. cost_benefit_flag and dis_benefit stay at business_case level, not
--    duplicated at programme level — the rollup view sums them, so a
--    programme-wide "this may cost more than it saves" read is available
--    without a second flag-and-dismiss mechanism to maintain.
-- 3. If a project later needs to move between programmes (reorg, scope
--    split), that's a straightforward UPDATE on business_case.programme_id
--    — no lineage-preservation table added for this yet, unlike initiative
--    merges/splits in the original RPVF doc's §7. Add one if programme
--    reassignment needs its own audit trail beyond the generic audit_log.
-- ============================================================
