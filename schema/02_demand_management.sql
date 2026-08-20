-- ============================================================
-- Demand Management Extension
-- Sits upstream of business_case. Every idea — big or small —
-- enters here first. Most small ones never need to become a
-- full business case. "Not now" is a tracked state, not a dead end.
-- Depends on: organization, app_user, portfolio, business_case
-- (see benefits_tracker_data_model.sql)
-- ============================================================

CREATE TABLE demand (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES organization(id),
    portfolio_id            UUID REFERENCES portfolio(id),

    title                   TEXT NOT NULL,
    description             TEXT,
    raised_by               UUID REFERENCES app_user(id),
    raised_date             DATE NOT NULL DEFAULT CURRENT_DATE,

    -- rough sizing at point of raising — deliberately loose, not a full case
    size_tier               TEXT NOT NULL DEFAULT 'unsized',
                                -- unsized | quick_win | needs_case
    estimated_cost          NUMERIC(14,2),
    currency                TEXT DEFAULT 'GBP',
    benefit_hypothesis      TEXT,        -- plain-language "why this matters", not a formal benefit row yet

    -- triage scoring — simple, transparent, editable at any time
    impact_score            SMALLINT,    -- 1-5
    effort_score            SMALLINT,    -- 1-5 (higher = more effort)
    urgency_score            SMALLINT,    -- 1-5
    priority_score           NUMERIC(4,2) GENERATED ALWAYS AS (
                                 (COALESCE(impact_score,0) + COALESCE(urgency_score,0))
                                 - COALESCE(effort_score,0)
                             ) STORED,

    status                  TEXT NOT NULL DEFAULT 'raised',
                                -- raised | triaged | backlog | parked | actioned
                                -- | promoted | rejected | duplicate
    next_review_date        DATE,        -- when to automatically resurface a parked idea
    review_trigger          TEXT,        -- free text: 'revisit if Q3 budget opens', 'revisit if competitor X ships this'

    -- outcome linkage
    promoted_business_case_id UUID REFERENCES business_case(id),  -- set when size_tier = needs_case and it gets promoted
    resolution_notes         TEXT,        -- why actioned directly, rejected, or marked duplicate

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Every time the same idea gets raised again ----------
-- Prevents the "three people suggested this in three different quarters"
-- problem by giving re-raises a home instead of becoming a new row.
CREATE TABLE demand_raise_event (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id       UUID NOT NULL REFERENCES demand(id),
    raised_by       UUID REFERENCES app_user(id),
    raised_date     DATE NOT NULL DEFAULT CURRENT_DATE,
    context_notes   TEXT     -- 'raised again in Q3 planning, unaware of original 2025 request'
);

-- ---------- Duplicate/similar demand detection ----------
-- Same pattern as benefit_link: platform flags, a human resolves.
CREATE TABLE demand_link (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id_a         UUID NOT NULL REFERENCES demand(id),
    demand_id_b         UUID NOT NULL REFERENCES demand(id),
    relationship_type   TEXT NOT NULL,   -- duplicate | related | supersedes
    flagged_by          UUID REFERENCES app_user(id),  -- null = system-matched
    flagged_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved            BOOLEAN NOT NULL DEFAULT false,
    resolution_notes    TEXT,
    CHECK (demand_id_a <> demand_id_b)
);

-- ---------- Quick-win actioning trail ----------
-- For size_tier = 'quick_win' demands that get actioned directly
-- without ever becoming a business_case — still needs a record of
-- what was decided and what it cost, for the graveyard/wins report.
CREATE TABLE demand_action (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id       UUID NOT NULL REFERENCES demand(id),
    actioned_by     UUID REFERENCES app_user(id),
    actioned_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    actual_cost     NUMERIC(14,2),
    outcome_notes   TEXT
);

-- ---------- Indexes ----------
CREATE INDEX idx_demand_org ON demand(organization_id);
CREATE INDEX idx_demand_status ON demand(status);
CREATE INDEX idx_demand_review_date ON demand(next_review_date);
CREATE INDEX idx_demand_priority ON demand(priority_score DESC);
CREATE INDEX idx_raise_event_demand ON demand_raise_event(demand_id);
CREATE INDEX idx_demand_link_pair ON demand_link(demand_id_a, demand_id_b);

-- Extend the shared audit_log entity_type values to include:
--   'demand' | 'demand_link' | 'demand_action'
-- (audit_log table itself is generic and already defined in
-- benefits_tracker_data_model.sql — no schema change needed there)

-- ============================================================
-- Design notes:
-- 1. `priority_score` is deliberately a simple, transparent formula
--    (impact + urgency - effort) computed in the DB, not a black box —
--    people need to trust and argue with a prioritization score,
--    not just receive it.
-- 2. `next_review_date` + `review_trigger` together are the core fix
--    for "good ideas lost to time" — a scheduled job can surface
--    parked demands automatically rather than relying on memory.
-- 3. size_tier = 'quick_win' demands can go straight to `demand_action`
--    without ever touching `business_case` — this keeps small asks
--    lightweight, which is the whole point of not forcing everything
--    through the same heavyweight process.
-- 4. size_tier = 'needs_case' demands, once approved, get a row in
--    `business_case` with `promoted_business_case_id` linking back —
--    so the eventual benefit rows can inherit the original
--    `benefit_hypothesis` as their first draft, and you can report
--    "this idea sat for 14 months before funding."
-- ============================================================
