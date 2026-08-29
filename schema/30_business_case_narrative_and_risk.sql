-- ============================================================
-- 30_business_case_narrative_and_risk.sql
--
-- Two additions to Business Case, both scoped deliberately narrow:
--
-- 1. Executive summary + problem statement - free text, human-written,
--    the only genuinely NEW narrative content Business Case needs.
--    Financial detail is NOT duplicated here - it already lives as
--    claimed_cost/claimed_benefit (P50, at raise) and assessed_cost/
--    assessed_benefit (P75, at assessment) on demand/demand_assessment.
--    Business Case reads those via the existing demand_id join rather
--    than re-asking for numbers that already have an anchored claim.
--
-- 2. Risk assessment - a new register, mirroring the existing `benefit`
--    pattern (owned, typed, statused) rather than inventing a new shape.
--    Human-selected likelihood/impact, consistent with RPVF's standing
--    principle that AI may suggest but never verdicts; there is no
--    computed risk score here, only fields a person set them.
--
-- Strategic goal alignment is NOT new schema - demand_goal_link already
-- exists (20_consolidate_strategy_tables.sql) and is populated at demand
-- stage. This migration adds nothing for it; the API/UI change is to
-- surface what's already there on the Business Case screen too.
-- ============================================================

ALTER TABLE business_case
    ADD COLUMN IF NOT EXISTS executive_summary TEXT,
    ADD COLUMN IF NOT EXISTS problem_statement TEXT;

COMMENT ON COLUMN business_case.executive_summary IS 'Free text - concise overview, key outcomes, decision required. Human-written, not derived.';
COMMENT ON COLUMN business_case.problem_statement IS 'Free text - what problem/opportunity exists and why it matters. Human-written, not derived.';

-- ---------- Risk register ----------

CREATE TABLE IF NOT EXISTS business_case_risk (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id    UUID NOT NULL REFERENCES business_case(id),
    description         TEXT NOT NULL,
    category             TEXT NOT NULL CHECK (category IN ('delivery', 'business')),
        -- delivery: timeline/technical complexity. business: change adoption,
        -- dependency on other projects. Deliberately just these two - matches
        -- the template's own split, and a third catch-all bucket would just
        -- become where everything lands unclassified.
    likelihood           TEXT NOT NULL CHECK (likelihood IN ('low', 'medium', 'high')),
    impact                TEXT NOT NULL CHECK (impact IN ('low', 'medium', 'high')),
        -- Deliberately no computed score (e.g. likelihood x impact = 9). A
        -- 3x3 grid position is for a human to read, not for the platform to
        -- rank and imply false precision on - consistent with "flags, never
        -- verdicts."
    mitigation           TEXT,
    status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'mitigated', 'accepted', 'closed')),
        -- accepted is distinct from mitigated: "we chose to live with this"
        -- is a different, equally valid record from "we did something about it."
    owner_user_id         UUID REFERENCES app_user(id),
    raised_by             UUID REFERENCES app_user(id),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_case_risk_case ON business_case_risk(business_case_id);

COMMENT ON TABLE business_case_risk IS 'Risk register per business case. Human-selected likelihood/impact - no computed risk score, by design.';
