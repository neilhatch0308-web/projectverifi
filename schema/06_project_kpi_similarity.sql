-- ============================================================
-- Project Delivery, KPI Tracking & Similarity Detection Extension
-- Anchors benefit realization to a real go-live date, tracks
-- operational KPIs as ongoing evidence, and generalizes duplicate/
-- overlap detection to check new demands and benefits against
-- ALL historic activity, not just other open demands.
-- Depends on: organization, app_user, demand, business_case, benefit
-- ============================================================

-- ---------- Did it actually launch? ----------
CREATE TABLE project_delivery (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id    UUID NOT NULL REFERENCES business_case(id),
    delivery_lead_id    UUID REFERENCES app_user(id),
    status               TEXT NOT NULL DEFAULT 'in_delivery',
                             -- in_delivery | live | closed | cancelled
    go_live_date         DATE,          -- the anchor point for KPI measurement and realization checks
    closed_date          DATE,
    cancellation_reason  TEXT,          -- populated if status = cancelled
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Success KPIs, defined at business case submission ----------
CREATE TABLE kpi_definition (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id       UUID NOT NULL REFERENCES business_case(id),
    benefit_id              UUID REFERENCES benefit(id),   -- which claimed benefit this KPI evidences, if any
    name                     TEXT NOT NULL,        -- 'Affiliate reconciliation processing time'
    kpi_type                 TEXT NOT NULL DEFAULT 'lagging',  -- leading | lagging
    unit                     TEXT NOT NULL,        -- 'GBP', '%', 'hours', 'count', 'days'
    baseline_value           NUMERIC(14,2),
    target_value             NUMERIC(14,2),
    measurement_frequency    TEXT NOT NULL DEFAULT 'monthly',  -- weekly | monthly | quarterly
    measurement_start        DATE,        -- typically = project_delivery.go_live_date, can be overridden
    measurement_end          DATE,        -- when tracking is expected to stop, null = ongoing
    owner_user_id            UUID REFERENCES app_user(id),   -- accountable for reporting actuals
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- The actual tracked values over time ----------
CREATE TABLE kpi_measurement (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kpi_definition_id   UUID NOT NULL REFERENCES kpi_definition(id),
    period_date         DATE NOT NULL,        -- the period this measurement represents
    actual_value        NUMERIC(14,2) NOT NULL,
    recorded_by         UUID REFERENCES app_user(id),
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes               TEXT,
    UNIQUE (kpi_definition_id, period_date)
);

-- ---------- AI-assisted similarity / duplicate / overlap detection ----------
-- Generalizes benefit_link and demand_link into one mechanism that can
-- check a NEW demand or benefit against ANY historic entity — open
-- demands, delivered business cases, or already-claimed benefits —
-- not just concurrent open items.
CREATE TABLE ai_similarity_check (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES organization(id),
    source_entity_type      TEXT NOT NULL,     -- 'demand' | 'benefit'
    source_entity_id        UUID NOT NULL,
    compared_entity_type    TEXT NOT NULL,     -- 'demand' | 'benefit' | 'business_case'
    compared_entity_id      UUID NOT NULL,
    similarity_score        NUMERIC(4,3),      -- 0.000–1.000, from embedding/semantic comparison
    match_dimension         TEXT,              -- 'title_semantic' | 'channel+benefit_type' | 'baseline_reference'
    ai_rationale             TEXT,              -- short model-generated explanation, plain language
    review_outcome           TEXT NOT NULL DEFAULT 'unreviewed',
                                 -- unreviewed | confirmed_duplicate | related_not_duplicate | false_positive
    reviewed_by               UUID REFERENCES app_user(id),
    reviewed_at               TIMESTAMPTZ,
    checked_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (NOT (source_entity_type = compared_entity_type AND source_entity_id = compared_entity_id))
);

-- ---------- Indexes ----------
CREATE INDEX idx_delivery_case ON project_delivery(business_case_id);
CREATE INDEX idx_delivery_status ON project_delivery(status);
CREATE INDEX idx_kpi_def_case ON kpi_definition(business_case_id);
CREATE INDEX idx_kpi_def_benefit ON kpi_definition(benefit_id);
CREATE INDEX idx_kpi_measurement_def ON kpi_measurement(kpi_definition_id, period_date);
CREATE INDEX idx_similarity_source ON ai_similarity_check(source_entity_type, source_entity_id);
CREATE INDEX idx_similarity_score ON ai_similarity_check(similarity_score DESC);
CREATE INDEX idx_similarity_review ON ai_similarity_check(review_outcome);

-- ============================================================
-- Design notes:
-- 1. `project_delivery.go_live_date` is the anchor the whole downstream
--    tracking chain hangs off: KPI `measurement_start`, and (in the
--    original model) `realization_check.scheduled_date` should
--    typically be set relative to it (e.g. go_live + 6 months) rather
--    than a fixed date chosen at business-case-approval time when
--    the real delivery date is still unknown.
-- 2. KPI vs. realization check — deliberately two different things:
--    `kpi_measurement` is frequent, operational, and owned by whoever
--    runs the thing day to day (e.g. monthly processing time).
--    `realization_check` is the periodic, formal financial verdict
--    the benefit owner signs off. KPI trend data is the evidence a
--    realization_check should reference, not a replacement for it.
-- 3. `ai_similarity_check` is intentionally NOT a gate. It writes
--    candidate matches with a score and rationale; nothing blocks
--    submission automatically. A PMO reviewer (or the sponsor, at
--    acceptance) sees flagged candidates above a threshold — e.g.
--    similarity_score > 0.75 — and marks review_outcome. This keeps
--    a human as the actual duplicate-caller, since a false "blocked as
--    duplicate" is worse for morale than an occasional missed overlap.
-- 4. Practically, `similarity_score` and `ai_rationale` get populated
--    by an app-layer job: embed each new demand/benefit's title +
--    baseline_reference + channel + description, compare against
--    embeddings of existing demand/benefit records (and delivered
--    business cases), and write rows here for anything above a
--    minimum threshold — cheap enough to run on every new submission.
-- 5. Recommend surfacing `ai_similarity_check` results at TWO points:
--    (a) when a demand is raised (checked against demand + benefit
--    history), and (b) when a business case's financial assessment
--    is submitted (each benefit line checked against other benefit
--    lines claiming growth/saving in the same channel) — this is
--    exactly the "another project already claimed revenue growth
--    here" check you described.
-- ============================================================
