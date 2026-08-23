-- ============================================================
-- 09_rpvf_dimensions_and_governance.sql
--
-- Aligns the existing schema (01–08) with decisions locked since it was
-- written: the four-dimension success model, preserved-original criteria
-- with gated re-basing, corporate strategic goals (capped 5/year), the
-- slim 5-seat RACI, mandatory attribution confidence, the cost-to-benefit
-- flag, sequenced adoption capture, and separate-line dis-benefits.
--
-- Deliberately ADDITIVE, not a rewrite — 01–08 already have good working
-- patterns (demand_link duplicate handling, ai_similarity_check, the
-- api_credential trust boundary, next_review_date resurfacing) that stay
-- exactly as they are. This file only adds what's new since.
--
-- Naming reuse from the existing schema, not renamed to match the RPVF
-- doc's own vocabulary 1:1:
--   - `portfolio` IS the division concept (its own example data already
--     used 'Academic Division') — no new division table needed.
--   - `kpi_definition` IS where success criteria already live — extended
--     here with a `dimension` tag rather than duplicated into a new table.
--   - `business_case` IS the RPVF `initiative` — the delivery-side unit
--     goals and RACI seats attach to.
--   - `realization_check` IS `criteria_match` — extended with outcome
--     classification + mandatory attribution rather than replaced.
--
-- Depends on: 01_benefits_tracker_core.sql, 02_demand_management.sql,
-- 06_project_kpi_similarity.sql, 08_rbac_and_security.sql
-- ============================================================

-- ============================================================
-- 1. FOUR-DIMENSION MODEL ON EXISTING SUCCESS CRITERIA
-- ============================================================

ALTER TABLE kpi_definition
    ADD COLUMN IF NOT EXISTS dimension TEXT
        CHECK (dimension IN ('delivery','adoption','business','financial'));

-- Direct vs weighted scoring — both always shown together, per tenant weight
CREATE TABLE IF NOT EXISTS dimension_weighting (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organization(id),
    dimension       TEXT NOT NULL CHECK (dimension IN ('delivery','adoption','business','financial')),
    weight          NUMERIC(5,4) NOT NULL CHECK (weight >= 0 AND weight <= 1),
    effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
    UNIQUE (organization_id, dimension, effective_from)
);

-- Adoption change type — captured at demand conception, not at project_delivery
ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS adoption_change_type TEXT
        CHECK (adoption_change_type IN ('process','tool','both'));

-- ============================================================
-- 2. PRESERVED ORIGINAL + GATED RE-BASING
-- ============================================================

-- kpi_definition rows are the original criteria once a demand is accepted.
-- Mark that moment so the app layer can block direct UPDATEs from there on.
ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

ALTER TABLE kpi_definition
    ADD COLUMN IF NOT EXISTS is_original BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS reference_class_shown TEXT;   -- benchmark snapshot shown at capture

-- Approval-gated re-base — reason, approver, prior value, delegation by aspect
CREATE TABLE IF NOT EXISTS kpi_definition_revision (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kpi_definition_id       UUID NOT NULL REFERENCES kpi_definition(id),
    aspect                  TEXT NOT NULL CHECK (aspect IN ('financial','scope_outcome','timescale')),
    prior_value             TEXT NOT NULL,
    new_value               TEXT NOT NULL,
    reason                  TEXT NOT NULL,
    approver_user_id        UUID NOT NULL REFERENCES app_user(id),
    agreeing_party_user_id  UUID REFERENCES app_user(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    -- Delegation-matrix enforcement (financial -> accountable_financial seat,
    -- scope_outcome -> accountable_scope seat, timescale -> accountable_schedule
    -- seat) happens in the app layer against business_case_raci below.
);

CREATE INDEX IF NOT EXISTS idx_kpi_revision_def ON kpi_definition_revision(kpi_definition_id);

-- ============================================================
-- 3. STRATEGIC GOALS — corporate only, capped 5/year (LOCKED)
-- ============================================================

CREATE TABLE IF NOT EXISTS strategic_goal (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organization(id),
    name            TEXT NOT NULL,
    description     TEXT,
    goal_year       INT NOT NULL,
    declared_by     UUID NOT NULL REFERENCES app_user(id),
    declared_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_locked       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enforce_strategic_goal_cap() RETURNS trigger AS $$
BEGIN
    IF (SELECT count(*) FROM strategic_goal
        WHERE organization_id = NEW.organization_id AND goal_year = NEW.goal_year) >= 5 THEN
        RAISE EXCEPTION 'Strategic goal cap reached: max 5 goals per organization per year';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_strategic_goal_cap ON strategic_goal;
CREATE TRIGGER trg_strategic_goal_cap
    BEFORE INSERT ON strategic_goal
    FOR EACH ROW EXECUTE FUNCTION enforce_strategic_goal_cap();

-- Links business_case (the RPVF initiative) to a goal — optional,
-- opportunistic, no spend split (deliberately non-summing across goals)
CREATE TABLE IF NOT EXISTS business_case_goal_link (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id    UUID NOT NULL REFERENCES business_case(id),
    strategic_goal_id   UUID NOT NULL REFERENCES strategic_goal(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_case_id, strategic_goal_id)
);

-- ============================================================
-- 4. SLIM RACI (5 SEATS) — sits alongside the existing RBAC role table
-- RBAC (08) governs platform PERMISSIONS (who can do what, generally).
-- RACI here governs ACCOUNTABILITY for one specific business_case —
-- a named individual who owns re-basing decisions for that initiative.
-- Different purpose, both needed.
-- ============================================================

CREATE TABLE IF NOT EXISTS business_case_raci (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id            UUID NOT NULL UNIQUE REFERENCES business_case(id),
    accountable_financial_id    UUID NOT NULL REFERENCES app_user(id),
    accountable_scope_id        UUID NOT NULL REFERENCES app_user(id),
    accountable_schedule_id     UUID NOT NULL REFERENCES app_user(id),
    sponsor_id                  UUID NOT NULL REFERENCES app_user(id),
    benefit_owner_id            UUID NOT NULL REFERENCES app_user(id),
    set_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. ATTRIBUTION CONFIDENCE + OUTCOME CLASSIFICATION ON realization_check
-- (realization_check already plays the criteria_match role — extend it)
-- ============================================================

ALTER TABLE realization_check
    ADD COLUMN IF NOT EXISTS outcome_classification TEXT
        CHECK (outcome_classification IN
            ('met','partially_met','not_met','deferred','cannot_assess','superseded')),
    ADD COLUMN IF NOT EXISTS attribution_confidence TEXT
        CHECK (attribution_confidence IN ('direct','contributory','coincidental','unknown')),
    ADD COLUMN IF NOT EXISTS cannot_assess_reason TEXT,
    ADD COLUMN IF NOT EXISTS cannot_assess_approved_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS superseded_by_kpi_definition_id UUID REFERENCES kpi_definition(id);

-- Mandatory attribution on financial-dimension claims only — no threshold, no opt-out
CREATE OR REPLACE FUNCTION enforce_attribution_on_financial() RETURNS trigger AS $$
DECLARE
    benefit_dimension TEXT;
BEGIN
    -- realization_check -> benefit -> (no dimension on benefit directly;
    -- dimension lives on kpi_definition). Walk via kpi_measurement's
    -- kpi_definition where linked, else skip enforcement (pre-dimension
    -- benefits from the original schema won't have one set).
    SELECT kd.dimension INTO benefit_dimension
    FROM kpi_definition kd
    WHERE kd.benefit_id = NEW.benefit_id
    LIMIT 1;

    IF benefit_dimension = 'financial' AND NEW.attribution_confidence IS NULL THEN
        RAISE EXCEPTION 'attribution_confidence is mandatory for financial-dimension realization_check rows';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_realization_check_attribution ON realization_check;
CREATE TRIGGER trg_realization_check_attribution
    BEFORE INSERT OR UPDATE ON realization_check
    FOR EACH ROW EXECUTE FUNCTION enforce_attribution_on_financial();

-- ============================================================
-- 6. COST-TO-BENEFIT FLAG — remaining spend vs remaining benefit
-- ============================================================

CREATE TABLE IF NOT EXISTS cost_benefit_flag (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id                UUID NOT NULL REFERENCES business_case(id),
    tripped_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    remaining_spend                 NUMERIC(14,2) NOT NULL,
    remaining_benefit               NUMERIC(14,2) NOT NULL,
    confidence                      TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
    status                          TEXT NOT NULL DEFAULT 'standing'
                                     CHECK (status IN ('standing','dismissed_strategic','dismissed_regulatory','resolved')),
    dismissed_goal_id               UUID REFERENCES strategic_goal(id),
    dismissed_regulatory_ref        TEXT,
    dismissed_by                    UUID REFERENCES app_user(id),
    dismissed_reason                TEXT,
    dismissed_at                    TIMESTAMPTZ,
    CHECK (
        (status = 'dismissed_strategic' AND dismissed_goal_id IS NOT NULL) OR
        (status = 'dismissed_regulatory' AND dismissed_regulatory_ref IS NOT NULL) OR
        (status IN ('standing','resolved'))
    )
);

CREATE INDEX IF NOT EXISTS idx_cbf_case ON cost_benefit_flag(business_case_id);

-- ============================================================
-- 7. DIS-BENEFITS — separate lines, never netted
-- ============================================================

CREATE TABLE IF NOT EXISTS dis_benefit (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id    UUID NOT NULL REFERENCES business_case(id),
    description         TEXT NOT NULL,
    owner_user_id        UUID NOT NULL REFERENCES app_user(id),
    value               NUMERIC(14,2),   -- negative in nature; kept separate from `benefit`, never summed against it
    currency            TEXT DEFAULT 'GBP',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS benefit_owner_handover (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    benefit_id      UUID NOT NULL REFERENCES benefit(id),
    from_user_id    UUID REFERENCES app_user(id),
    to_user_id      UUID NOT NULL REFERENCES app_user(id),
    handed_over_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason          TEXT
);

-- ============================================================
-- 8. SEQUENCED ADOPTION CAPTURE — perception (closure) vs reality (after delay)
-- ============================================================

CREATE TABLE IF NOT EXISTS adoption_measurement (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id    UUID NOT NULL UNIQUE REFERENCES business_case(id),
    change_type         TEXT NOT NULL CHECK (change_type IN ('process','tool','both')),
    measurement_method  TEXT NOT NULL CHECK (measurement_method IN ('telemetry','attestation','survey','not_applicable')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS adoption_survey_question (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adoption_measurement_id     UUID NOT NULL REFERENCES adoption_measurement(id),
    ai_drafted_text             TEXT NOT NULL,
    confirmed_text              TEXT,
    confirmed_by                UUID REFERENCES app_user(id),
    confirmed_at                TIMESTAMPTZ,
    changed_from_baseline       BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS outcome_questionnaire (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_case_id        UUID NOT NULL REFERENCES business_case(id),
    questionnaire_type      TEXT NOT NULL CHECK (questionnaire_type IN ('perception','reality')),
    respondent_group        TEXT NOT NULL,   -- 'stakeholder' | 'executing_team'
    sent_at                 TIMESTAMPTZ,
    completed_at             TIMESTAMPTZ,
    summary_score            NUMERIC(5,2)
);

-- Gap shown as a delta, never averaged
CREATE OR REPLACE VIEW adoption_perception_reality_gap AS
SELECT
    p.business_case_id,
    p.summary_score AS perception_score,
    r.summary_score AS reality_score,
    (r.summary_score - p.summary_score) AS gap_delta
FROM outcome_questionnaire p
JOIN outcome_questionnaire r
    ON r.business_case_id = p.business_case_id AND r.questionnaire_type = 'reality'
WHERE p.questionnaire_type = 'perception';

-- ============================================================
-- 9. PORTFOLIO ROLLUP VIEWS — by goal (non-summing) and by division
-- ============================================================

CREATE OR REPLACE VIEW portfolio_value_by_goal AS
SELECT
    sg.id AS strategic_goal_id, sg.name, sg.goal_year,
    count(DISTINCT bgl.business_case_id) AS initiative_count,
    sum(i.actual_spend_to_date) AS total_spend,
    sum(b.claimed_value) AS total_claimed_value
FROM strategic_goal sg
JOIN business_case_goal_link bgl ON bgl.strategic_goal_id = sg.id
JOIN investment i ON i.business_case_id = bgl.business_case_id
LEFT JOIN benefit b ON b.business_case_id = bgl.business_case_id
GROUP BY sg.id, sg.name, sg.goal_year;

-- `portfolio` already IS division — this rollup was implicitly available
-- via `business_case.portfolio_id` already; no new view strictly needed,
-- but named here for discoverability alongside the goal rollup above.
CREATE OR REPLACE VIEW portfolio_value_by_division AS
SELECT
    p.id AS portfolio_id, p.name,
    count(DISTINCT bc.id) AS initiative_count,
    sum(i.actual_spend_to_date) AS total_spend
FROM portfolio p
JOIN business_case bc ON bc.portfolio_id = p.id
JOIN investment i ON i.business_case_id = bc.id
GROUP BY p.id, p.name;

-- Soft-outcome-class distribution — portfolio health metric (framework §11 Q9)
CREATE OR REPLACE VIEW outcome_class_distribution AS
SELECT
    bc.organization_id,
    rc.outcome_classification,
    count(*) AS n
FROM realization_check rc
JOIN benefit b ON b.id = rc.benefit_id
JOIN business_case bc ON bc.id = b.business_case_id
WHERE rc.outcome_classification IS NOT NULL
GROUP BY bc.organization_id, rc.outcome_classification;

-- ============================================================
-- 10. INDEXES for the new tables
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_goal_org_year ON strategic_goal(organization_id, goal_year);
CREATE INDEX IF NOT EXISTS idx_goal_link_case ON business_case_goal_link(business_case_id);
CREATE INDEX IF NOT EXISTS idx_raci_case ON business_case_raci(business_case_id);
CREATE INDEX IF NOT EXISTS idx_disbenefit_case ON dis_benefit(business_case_id);
CREATE INDEX IF NOT EXISTS idx_adoption_case ON adoption_measurement(business_case_id);
CREATE INDEX IF NOT EXISTS idx_questionnaire_case ON outcome_questionnaire(business_case_id);

-- ============================================================
-- OPEN ITEMS carried into this migration (unresolved in the framework doc):
--
-- 1. Q9 wording ('overdue is unrealised' vs 'not credited as evidenced')
--    is not yet locked — realization_check.outcome_classification has no
--    explicit 'overdue' value, so the app layer should treat a demand
--    whose kpi_definition.target_date has passed with no realization_check
--    row as the signal, not a stored classification. Revisit once locked.
--
-- 2. The existing 03_demand_scoring_matrix.sql (impact/effort/urgency,
--    priority_score) and this file's four-dimension model are NOT the
--    same thing — the former scores whether to DO a demand (triage),
--    the latter scores whether it SUCCEEDED (post-delivery). Both stay;
--    don't merge them.
--
-- 3. `priority_score` in 02_demand_management.sql is still a hard-coded
--    GENERATED column formula (impact + urgency - effort). Known gap:
--    should be tenant-configurable, not fixed. Not addressed here —
--    flagging so it isn't lost.
--
-- 4. RLS policies are NOT included in this file. 08_rbac_and_security.sql's
--    design notes describe the intended policy shape but none are actually
--    created yet in the repo as checked. This is the highest-priority
--    follow-up before any real tenant data goes in — every organization_id
--    table needs `ENABLE ROW LEVEL SECURITY` plus a policy, and a boot-time
--    self-test asserting that's true, not just documented intent.
-- ============================================================