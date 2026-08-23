-- ============================================================
-- 17_weighted_scoring_and_demand_fields.sql
--
-- Replaces the placeholder 7-criterion scoring set (16_seed_scoring_criteria.sql)
-- with the real weighted model: 5 categories, each scored against defined
-- levels (0/5/10/15/20), combined by weight - not a flat sum.
--
-- Also adds the submitter fields raising a demand should actually capture:
-- a named sponsor (distinct from raised_by, the conceiver), a need-by
-- date, and a separate "need and output" statement from the problem
-- statement (what must be delivered, not just what's wrong today).
--
-- Wires demand to the existing strategy_objective table (03_demand_scoring_matrix.sql)
-- via demand_strategy_link - that table has existed since the original
-- build but was never connected to any real flow until now.
-- ============================================================

-- ---------- 1. Weighted scoring model ----------

ALTER TABLE scoring_criterion
    ADD COLUMN IF NOT EXISTS weight_pct NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS level_definitions JSONB;

-- Retire the old generic 7-criterion set rather than deleting it - keeps
-- any demand_score rows already written against it intact and auditable,
-- just no longer offered for new scoring.
UPDATE scoring_criterion
SET active = false
WHERE organization_id = '11111111-1111-1111-1111-111111111111'
  AND weight_pct IS NULL;

INSERT INTO scoring_criterion (id, organization_id, name, description, max_points, is_fixed, active, weight_pct, level_definitions)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', v.name, v.description, 20, false, true, v.weight_pct, v.level_definitions::jsonb
FROM (VALUES
    (
        'Financial / Revenue Impact',
        'Revenue, cost reduction, margin protection',
        25.00,
        '{"0":"No measurable financial impact","5":"Minor efficiency or small cost avoidance","10":"Moderate cost reduction or revenue protection","15":"Significant cost reduction or new revenue stream","20":"Major revenue uplift or critical financial protection"}'
    ),
    (
        'Competitive Positioning',
        'Market share, speed-to-market, differentiation',
        15.00,
        '{"0":"No competitive relevance","5":"Slight improvement vs peers","10":"Noticeable competitive advantage","15":"Strong differentiation or market share gain","20":"Critical to remain competitive / avoid disruption"}'
    ),
    (
        'Regulatory / Legislative Drivers',
        'Mandatory compliance, audit findings',
        20.00,
        '{"0":"No regulatory relevance","5":"Recommended best practice","10":"Supports compliance but not mandatory","15":"Required for compliance within 12-24 months","20":"Mandatory regulatory requirement / audit finding"}'
    ),
    (
        'Cyber / Operational Risk Reduction',
        'Cyber, operational, continuity, data protection',
        20.00,
        '{"0":"No risk reduction","5":"Minor improvement in control posture","10":"Reduces a known risk with moderate likelihood","15":"Addresses a high-likelihood or high-impact risk","20":"Eliminates a critical cyber/operational risk"}'
    ),
    (
        'Reputational / Customer Impact',
        'Brand trust, customer experience, media exposure',
        20.00,
        '{"0":"No reputational impact","5":"Minor improvement to customer experience","10":"Noticeable improvement to service reliability","15":"Prevents reputational damage or service degradation","20":"Avoids major brand harm or customer loss"}'
    )
) AS v(name, description, weight_pct, level_definitions)
WHERE NOT EXISTS (
    SELECT 1 FROM scoring_criterion
    WHERE organization_id = '11111111-1111-1111-1111-111111111111' AND name = v.name
);

-- ---------- 2. Weighted priority view (replaces the flat-sum version) ----------

CREATE OR REPLACE VIEW demand_priority_view AS
SELECT
    d.id AS demand_id,
    d.title,
    d.status,
    COALESCE(SUM(ds.score_awarded), 0) AS total_score,
    COALESCE(SUM(ds.score_awarded * sc.weight_pct / 100.0), 0) AS weighted_score,
    COUNT(ds.id) AS criteria_scored,
    (SELECT COUNT(*) FROM scoring_criterion sc2
        WHERE sc2.organization_id = d.organization_id AND sc2.active) AS criteria_available
FROM demand d
LEFT JOIN demand_score ds ON ds.demand_id = d.id
LEFT JOIN scoring_criterion sc ON sc.id = ds.criterion_id
GROUP BY d.id, d.title, d.status, d.organization_id;

-- ---------- 3. Demand submitter fields ----------

ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS sponsor_user_id UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS need_by_date DATE,
    ADD COLUMN IF NOT EXISTS outcome_statement TEXT;

-- description column already holds the problem statement; outcome_statement
-- is deliberately separate - "what must be delivered" is a different
-- question from "what's wrong today", and conflating them was a real gap.

COMMENT ON COLUMN demand.description IS 'Problem statement: the issue or problem being raised';
COMMENT ON COLUMN demand.outcome_statement IS 'Need and output: what the demand needs to deliver and achieve';
COMMENT ON COLUMN demand.sponsor_user_id IS 'Proposed sponsor at raise time - may differ from the sponsor named later in demand_raci at acceptance; both are tracked, not merged';
