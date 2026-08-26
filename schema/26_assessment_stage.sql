-- ============================================================
-- 26_assessment_stage.sql
--
-- Phase 2 of the v0.7 direction: the P75 assessment stage, sitting
-- between triage acceptance and annual planning.
--
-- EVERY accepted demand goes through assessment - no cost threshold,
-- no skipping. A cheap demand with a weak benefit case deserves the
-- same scrutiny as an expensive one; a threshold would let exactly the
-- wrong things through unexamined. Fast-tracking is about SPEED (less
-- to work out when a quote already exists), never about exemption.
--
-- Confidence is about the WHOLE case, not just cost. Someone can
-- arrive with a firm quote and still be P50 overall, because nobody
-- has tested whether the benefit claim survives contact with reality.
-- Hence separate confidence on cost and on benefit - "cost nailed
-- down, benefit speculative" is a real and common state, and making
-- that asymmetry visible is the point.
--
-- The assessor states their OWN figures alongside the conceiver's
-- preserved original claim. The original is never overwritten (see
-- RPVF v0.7 section 2b, the anchored claim). The delta between them
-- is the artifact - it may be higher, lower, or identical, and a
-- confirmed claim is as valuable a record as a halved one. Validity
-- comes from knowing what was and what is.
-- ============================================================

-- ---------- The claim, captured at raise (P50) ----------
-- The conceiver's own figures. Preserved permanently, never edited
-- after raise - assessment produces new figures rather than changing
-- these.

ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS claimed_cost NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS claimed_benefit NUMERIC(14,2);

COMMENT ON COLUMN demand.claimed_cost IS 'P50 cost as stated by the conceiver at raise. Preserved, never overwritten by assessment.';
COMMENT ON COLUMN demand.claimed_benefit IS 'P50 benefit as claimed by the conceiver at raise. Preserved, never overwritten - this is the number they must stand by.';

-- ---------- The assessment (P75) ----------

CREATE TABLE IF NOT EXISTS demand_assessment (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id               UUID NOT NULL UNIQUE REFERENCES demand(id),

    -- Assessed figures - the assessor's own view, sitting ALONGSIDE
    -- the preserved claim, not replacing it
    assessed_cost           NUMERIC(14,2),
    assessed_benefit        NUMERIC(14,2),

    -- Confidence stated separately, because they genuinely differ
    cost_confidence         TEXT CHECK (cost_confidence IN ('low', 'medium', 'high')),
    benefit_confidence      TEXT CHECK (benefit_confidence IN ('low', 'medium', 'high')),

    -- The reasoning - what changed from the claim and why, or why it stands
    assessment_narrative    TEXT,

    -- Who did the work, and in what capacity. An internal BA's P75 and
    -- an external consultant's P75 are different things when you read
    -- the plan six months later.
    assessed_by             UUID REFERENCES app_user(id),
    assessor_capacity       TEXT CHECK (assessor_capacity IN
                             ('portfolio_lead', 'business_analyst', 'technical_consultant',
                              'project_manager', 'third_party', 'other')),
    assessor_detail         TEXT,   -- e.g. the third party's name

    -- Analytical, but decision-driving (v0.7 decision 34). The assessor
    -- may recommend stopping; the decision itself is recorded on demand.status.
    recommendation          TEXT CHECK (recommendation IN ('proceed', 'stop', 'no_recommendation')),

    assessed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessment_demand ON demand_assessment(demand_id);

-- ---------- New statuses ----------
-- 'assessed'  - P75 complete, now plannable
-- 'stopped'   - killed at assessment because the economics collapsed.
--               DELIBERATELY distinct from 'rejected' (killed at triage
--               as not worth pursuing) - a demand stopped because the
--               numbers fell apart under scrutiny is a completely
--               different portfolio signal from one rejected on the idea.

COMMENT ON COLUMN demand.status IS 'raised -> accepted -> assessed -> promoted. Terminal: rejected (killed at triage, on the idea), stopped (killed at assessment, on the economics).';

-- A view exposing the claim-vs-assessed delta, since it's the thing
-- worth reporting on and shouldn't be recalculated ad hoc in each query.
CREATE OR REPLACE VIEW demand_estimate_movement AS
SELECT
    d.id AS demand_id,
    d.title,
    d.status,
    d.claimed_cost,
    d.claimed_benefit,
    a.assessed_cost,
    a.assessed_benefit,
    (a.assessed_cost - d.claimed_cost) AS cost_movement,
    (a.assessed_benefit - d.claimed_benefit) AS benefit_movement,
    a.cost_confidence,
    a.benefit_confidence,
    a.recommendation,
    a.assessed_at
FROM demand d
LEFT JOIN demand_assessment a ON a.demand_id = d.id;
