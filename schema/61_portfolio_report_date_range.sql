-- 61_portfolio_report_date_range.sql
--
-- Adds a date range to portfolio_report (migration 60), scoped by RAISE
-- DATE (demand.created_at) -- "which demands were raised in this
-- period" is the natural reporting-period question, and every stage
-- timing/financial figure for that demand rolls up under whichever
-- period it was raised in, even if later stages happened afterward.
-- This is a real, named design choice, not the only possible one --
-- an alternative would be "any demand with activity in this window",
-- which would let one demand appear in multiple periods. Raise-date
-- scoping keeps each demand in exactly one period, which is what you
-- want when periods are meant to sum to a total.
--
-- A plain VIEW cannot take parameters, so this replaces the view with
-- a SQL function of the same name and column shape - callable as
-- `SELECT * FROM portfolio_report()` for all-time (both bounds
-- default NULL) or `SELECT * FROM portfolio_report('2026-01-01',
-- '2026-06-30')` for a period. STABLE, not VOLATILE, since it only
-- reads - lets Postgres treat it like any other table function.
--
-- IMPORTANT: the date filter is on the LEFT JOIN's ON clause, not a
-- WHERE clause. Putting it in WHERE would silently turn the LEFT JOIN
-- into an inner join for date-filtered portfolios - any portfolio
-- with zero demand raised in the chosen period would vanish from the
-- report entirely instead of showing demand_count = 0. Filtering in
-- ON keeps every portfolio in the result set regardless of the date
-- range; only which demands feed its aggregates changes.

BEGIN;

DROP VIEW IF EXISTS portfolio_report;

CREATE FUNCTION portfolio_report(p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL)
RETURNS TABLE (
    portfolio_id UUID,
    portfolio_name TEXT,
    demand_count BIGINT,

    avg_days_raise_to_triage NUMERIC, n_raise_to_triage BIGINT,
    avg_days_triage_to_assess NUMERIC, n_triage_to_assess BIGINT,
    avg_days_assess_to_promote NUMERIC, n_assess_to_promote BIGINT,
    avg_days_promote_to_decision NUMERIC, n_promote_to_decision BIGINT,
    avg_days_decision_to_delivery_start NUMERIC, n_decision_to_delivery_start BIGINT,
    avg_days_delivery_duration NUMERIC, n_delivery_duration BIGINT,
    avg_days_complete_to_adoption NUMERIC, n_complete_to_adoption BIGINT,
    avg_days_adoption_to_benefit NUMERIC, n_adoption_to_benefit BIGINT,

    avg_claimed_cost NUMERIC, n_claimed_cost BIGINT,
    avg_claimed_benefit NUMERIC, n_claimed_benefit BIGINT,
    avg_assessed_cost NUMERIC, n_assessed_cost BIGINT,
    avg_assessed_benefit NUMERIC, n_assessed_benefit BIGINT,
    avg_actual_cost NUMERIC, n_actual_cost BIGINT,
    avg_actual_benefit NUMERIC, n_actual_benefit BIGINT
) AS $$
SELECT
    p.id, p.name, COUNT(d.id),

    AVG(EXTRACT(EPOCH FROM (d.triaged_at - d.created_at)) / 86400.0)
        FILTER (WHERE d.triaged_at IS NOT NULL),
    COUNT(*) FILTER (WHERE d.triaged_at IS NOT NULL),

    AVG(EXTRACT(EPOCH FROM (da.assessed_at - d.triaged_at)) / 86400.0)
        FILTER (WHERE da.assessed_at IS NOT NULL AND d.triaged_at IS NOT NULL),
    COUNT(*) FILTER (WHERE da.assessed_at IS NOT NULL AND d.triaged_at IS NOT NULL),

    AVG(EXTRACT(EPOCH FROM (d.accepted_at - da.assessed_at)) / 86400.0)
        FILTER (WHERE d.accepted_at IS NOT NULL AND da.assessed_at IS NOT NULL),
    COUNT(*) FILTER (WHERE d.accepted_at IS NOT NULL AND da.assessed_at IS NOT NULL),

    AVG(EXTRACT(EPOCH FROM (bc.decision_date::TIMESTAMPTZ - d.accepted_at)) / 86400.0)
        FILTER (WHERE bc.decision_date IS NOT NULL AND d.accepted_at IS NOT NULL),
    COUNT(*) FILTER (WHERE bc.decision_date IS NOT NULL AND d.accepted_at IS NOT NULL),

    AVG(EXTRACT(EPOCH FROM (dd.delivery_started_at - bc.decision_date::TIMESTAMPTZ)) / 86400.0)
        FILTER (WHERE dd.delivery_started_at IS NOT NULL AND bc.decision_date IS NOT NULL),
    COUNT(*) FILTER (WHERE dd.delivery_started_at IS NOT NULL AND bc.decision_date IS NOT NULL),

    AVG(EXTRACT(EPOCH FROM (dd.delivery_completed_at - dd.delivery_started_at)) / 86400.0)
        FILTER (WHERE dd.delivery_completed_at IS NOT NULL AND dd.delivery_started_at IS NOT NULL),
    COUNT(*) FILTER (WHERE dd.delivery_completed_at IS NOT NULL AND dd.delivery_started_at IS NOT NULL),

    AVG(EXTRACT(EPOCH FROM (dd.adoption_measured_at - dd.delivery_completed_at)) / 86400.0)
        FILTER (WHERE dd.adoption_measured_at IS NOT NULL AND dd.delivery_completed_at IS NOT NULL),
    COUNT(*) FILTER (WHERE dd.adoption_measured_at IS NOT NULL AND dd.delivery_completed_at IS NOT NULL),

    AVG(EXTRACT(EPOCH FROM (dd.benefit_realized_at - dd.adoption_measured_at)) / 86400.0)
        FILTER (WHERE dd.benefit_realized_at IS NOT NULL AND dd.adoption_measured_at IS NOT NULL),
    COUNT(*) FILTER (WHERE dd.benefit_realized_at IS NOT NULL AND dd.adoption_measured_at IS NOT NULL),

    AVG(d.claimed_cost) FILTER (WHERE d.claimed_cost IS NOT NULL),
    COUNT(*) FILTER (WHERE d.claimed_cost IS NOT NULL),
    AVG(d.claimed_benefit) FILTER (WHERE d.claimed_benefit IS NOT NULL),
    COUNT(*) FILTER (WHERE d.claimed_benefit IS NOT NULL),

    AVG(da.assessed_cost) FILTER (WHERE da.assessed_cost IS NOT NULL),
    COUNT(*) FILTER (WHERE da.assessed_cost IS NOT NULL),
    AVG(da.assessed_benefit) FILTER (WHERE da.assessed_benefit IS NOT NULL),
    COUNT(*) FILTER (WHERE da.assessed_benefit IS NOT NULL),

    AVG(dd.actual_cost) FILTER (WHERE dd.actual_cost IS NOT NULL),
    COUNT(*) FILTER (WHERE dd.actual_cost IS NOT NULL),
    AVG(dd.actual_benefit_value) FILTER (WHERE dd.actual_benefit_value IS NOT NULL),
    COUNT(*) FILTER (WHERE dd.actual_benefit_value IS NOT NULL)

FROM portfolio p
LEFT JOIN demand d ON d.portfolio_id = p.id
    AND (p_from IS NULL OR d.created_at::DATE >= p_from)
    AND (p_to IS NULL OR d.created_at::DATE <= p_to)
LEFT JOIN demand_assessment da ON da.demand_id = d.id
LEFT JOIN business_case bc ON bc.demand_id = d.id
LEFT JOIN demand_delivery dd ON dd.demand_id = d.id
WHERE p.parent_portfolio_id IS NULL
GROUP BY p.id, p.name;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION portfolio_report IS
  'Per-portfolio rollup, scoped by raise date when p_from/p_to are given (both NULL = all-time). Filters on demand.created_at via the LEFT JOIN''s ON clause, not WHERE, so a portfolio with zero demand raised in range still appears with demand_count = 0 rather than disappearing. Same columns and semantics as migration 60''s view -- always show each avg_ column next to its matching n_ count, never alone. Tenant-scoped automatically via the underlying tables'' own RLS policies.';

-- ---------- Re-prove tenant isolation, now through the function ----------
DO $$
DECLARE
    org_a UUID := gen_random_uuid();
    org_b UUID := gen_random_uuid();
    portfolio_a UUID;
    leaked_count INT;
BEGIN
    PERFORM set_config('app.current_org', org_a::TEXT, true);
    INSERT INTO organization (id, name) VALUES (org_a, 'RLS test org A (migration 61)');
    INSERT INTO portfolio (id, organization_id, name) VALUES (gen_random_uuid(), org_a, 'RLS test portfolio A') RETURNING id INTO portfolio_a;

    PERFORM set_config('app.current_org', org_b::TEXT, true);
    INSERT INTO organization (id, name) VALUES (org_b, 'RLS test org B (migration 61)');
    INSERT INTO portfolio (id, organization_id, name) VALUES (gen_random_uuid(), org_b, 'RLS test portfolio B');

    -- unbounded call
    SELECT COUNT(*) INTO leaked_count FROM portfolio_report() WHERE portfolio_id = portfolio_a;

    PERFORM set_config('app.current_org', org_a::TEXT, true);
    DELETE FROM portfolio WHERE organization_id = org_a;
    DELETE FROM organization WHERE id = org_a;
    PERFORM set_config('app.current_org', org_b::TEXT, true);
    DELETE FROM portfolio WHERE organization_id = org_b;
    DELETE FROM organization WHERE id = org_b;

    IF leaked_count > 0 THEN
        RAISE EXCEPTION 'portfolio_report() leaked cross-tenant data: org B could see org A''s portfolio';
    END IF;
    RAISE NOTICE 'portfolio_report() tenant isolation confirmed after date-range change.';
END $$;

COMMIT;
