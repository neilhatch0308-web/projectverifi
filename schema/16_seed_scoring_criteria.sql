-- ============================================================
-- 16_seed_scoring_criteria.sql
--
-- 03_demand_scoring_matrix.sql built the scoring infrastructure
-- (scoring_criterion, demand_score, strategy_objective,
-- demand_priority_view) but left it completely unseeded - zero
-- criteria exist for any org yet, so the matrix has nothing to score
-- against. This seeds the suggested default set for Acme Holdings.
--
-- Run with app.current_org already set to Acme Holdings' id, same as
-- any other write against an RLS-protected table.
-- ============================================================

INSERT INTO scoring_criterion (id, organization_id, name, description, max_points, is_fixed, active)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', v.name, v.description, v.max_points, v.is_fixed, true
FROM (VALUES
    ('Regulatory',       'A named regulatory or compliance obligation requires this', 20, true),
    ('Revenue Growth',   'Directly grows top-line revenue', 20, false),
    ('Cost Reduction',   'Directly reduces operating cost', 20, false),
    ('Effort Reduction', 'Reduces manual effort or process friction', 15, false),
    ('Business Growth',  'Supports wider strategic growth beyond direct revenue', 15, false),
    ('Maintain',         'Keeps an existing capability running / prevents decay', 10, false),
    ('Other',            'Does not fit the above categories', 5, false)
) AS v(name, description, max_points, is_fixed)
WHERE NOT EXISTS (
    SELECT 1 FROM scoring_criterion
    WHERE organization_id = '11111111-1111-1111-1111-111111111111' AND name = v.name
);
