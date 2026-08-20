-- ============================================================
-- Demand Scoring Extension — Weighted Criteria Matrix
-- Replaces the simple impact/effort/urgency formula with a
-- transparent, editable matrix tied to a living strategy register.
-- Depends on: organization, app_user, demand
-- (see benefits_tracker_data_model.sql, demand_management_extension.sql)
-- ============================================================

-- Remove the old simple scoring columns — scoring now lives in its own tables
ALTER TABLE demand DROP COLUMN IF EXISTS impact_score;
ALTER TABLE demand DROP COLUMN IF EXISTS effort_score;
ALTER TABLE demand DROP COLUMN IF EXISTS urgency_score;
ALTER TABLE demand DROP COLUMN IF EXISTS priority_score;

-- ---------- The scoring matrix itself — rows are your criteria ----------
CREATE TABLE scoring_criterion (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organization(id),
    name            TEXT NOT NULL,          -- 'Regulatory', 'Revenue Growth', 'Cost Reduction',
                                             -- 'Effort Reduction', 'Business Growth', 'Maintain', 'Other'
    description     TEXT,
    max_points      NUMERIC(5,2) NOT NULL,  -- e.g. 20 for Regulatory
    is_fixed        BOOLEAN NOT NULL DEFAULT false,
                        -- true = binary/all-or-nothing (Regulatory: applies -> full points, else 0)
                        -- false = scored on a sliding scale up to max_points
    active          BOOLEAN NOT NULL DEFAULT true,   -- retire a criterion without deleting history
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Background information: the active strategy register ----------
-- This is what scorers check a demand against, so "Business Growth" or
-- "Revenue Growth" points are grounded in a real, named strategic priority
-- rather than a gut-feel guess.
CREATE TABLE strategy_objective (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organization(id),
    title           TEXT NOT NULL,          -- 'Grow ELT market share', 'Salesforce consolidation'
    description     TEXT,
    category        TEXT,                   -- growth | efficiency | risk | market | cost | other
    owner_user_id   UUID REFERENCES app_user(id),  -- exec accountable for this strategic priority
    active_from     DATE,
    active_to       DATE,                   -- null = still active; set when superseded
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Which strategy a given demand supports ----------
CREATE TABLE demand_strategy_link (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id               UUID NOT NULL REFERENCES demand(id),
    strategy_objective_id   UUID NOT NULL REFERENCES strategy_objective(id),
    alignment_notes         TEXT,           -- why this demand supports this strategy
    linked_by               UUID REFERENCES app_user(id),
    linked_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- The actual score awarded per demand, per criterion ----------
CREATE TABLE demand_score (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id       UUID NOT NULL REFERENCES demand(id),
    criterion_id    UUID NOT NULL REFERENCES scoring_criterion(id),
    score_awarded   NUMERIC(5,2) NOT NULL,
    rationale       TEXT,           -- 'Applies — EU AI Act deadline June 2026' / 'Supports Salesforce consolidation strategy'
    scored_by       UUID REFERENCES app_user(id),
    scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (demand_id, criterion_id)   -- one current score per criterion per demand; re-scoring overwrites via app logic + audit_log
);

-- ---------- Priority view — the total, always derived, never stored ----------
CREATE VIEW demand_priority_view AS
SELECT
    d.id AS demand_id,
    d.title,
    d.status,
    COALESCE(SUM(ds.score_awarded), 0) AS total_score,
    COUNT(ds.id) AS criteria_scored,
    (SELECT COUNT(*) FROM scoring_criterion sc
        WHERE sc.organization_id = d.organization_id AND sc.active) AS criteria_available
FROM demand d
LEFT JOIN demand_score ds ON ds.demand_id = d.id
GROUP BY d.id, d.title, d.status, d.organization_id;

-- ---------- Indexes ----------
CREATE INDEX idx_criterion_org ON scoring_criterion(organization_id);
CREATE INDEX idx_strategy_org ON strategy_objective(organization_id);
CREATE INDEX idx_strategy_link_demand ON demand_strategy_link(demand_id);
CREATE INDEX idx_demand_score_demand ON demand_score(demand_id);

-- ---------- Suggested seed data (edit weights to match your matrix) ----------
-- INSERT INTO scoring_criterion (organization_id, name, max_points, is_fixed) VALUES
--   ('<org_id>', 'Regulatory',        20, true),
--   ('<org_id>', 'Revenue Growth',    20, false),
--   ('<org_id>', 'Cost Reduction',    20, false),
--   ('<org_id>', 'Effort Reduction',  15, false),
--   ('<org_id>', 'Business Growth',   15, false),
--   ('<org_id>', 'Maintain',          10, false),
--   ('<org_id>', 'Other',              5, false);

-- ============================================================
-- Design notes:
-- 1. `is_fixed` criteria (Regulatory) should be scored all-or-nothing
--    in the app layer: either it applies (full max_points) or it
--    doesn't (0) — no partial credit, which matches how you described it.
-- 2. `demand_priority_view` deliberately shows `criteria_scored` vs
--    `criteria_available` alongside the total — a demand scored on
--    2 of 7 criteria looks very different from one fully assessed,
--    and ranking by raw total alone would hide that.
-- 3. Re-scoring a criterion should go through the app layer so the
--    old value is written to audit_log before being overwritten —
--    UNIQUE(demand_id, criterion_id) means the DB only ever holds
--    the current score, history lives in the audit trail.
-- 4. `strategy_objective.active_to` lets you retire a strategic
--    priority when it's superseded, without losing the historical
--    record of what a past demand was scored against at the time.
-- ============================================================
