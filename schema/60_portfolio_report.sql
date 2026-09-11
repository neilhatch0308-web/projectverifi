-- 60_portfolio_report.sql
--
-- The first real "promise vs reality" / "where work gets stuck" report
-- against this schema. Everything it shows already exists as raw data
-- (raise/triage/assess/promote/decision/delivery timestamps, and
-- claimed (P50) / assessed (P75) / actual (P100) cost and benefit) --
-- this view is purely a rollup, no new columns anywhere.
--
-- Grouped by raising portfolio (demand.portfolio_id), matching how
-- every other portfolio-scoped screen in this app already groups
-- (All Demand's portfolio filter, Portfolio Rollup). Not enforced by a
-- trigger to be a parent portfolio, but is one by convention -
-- consistent with that, not a new assumption.
--
-- SAMPLE SIZE IS SURFACED EVERYWHERE AN AVERAGE IS, deliberately, as
-- its own column rather than left implicit. An average of one is not
-- a trend, and this framework's whole ethos (anchored claims, the
-- neutral reference class at raise, claimed-vs-assessed shown side by
-- side rather than one number replacing the other) is built around
-- never letting a single figure imply more confidence than the data
-- actually supports. A rollup report is exactly where that discipline
-- is easiest to accidentally drop -- an unqualified "avg 45 days" or
-- "avg £120k" reads as settled fact even when n=1. The UI consuming
-- this view should always show the sample count next to its average,
-- never the average alone.
--
-- Every stage-duration average only counts demands where BOTH ends of
-- that specific transition happened -- a demand still sitting in
-- Triage has no raise-to-triage duration yet, and including it as a
-- pending zero would silently pull the average toward "fast" for
-- exactly the demands taking longest. Excluding it (not counting it,
-- and not counting it as slow either) is the honest answer; the count
-- column shows how many demands each average is actually drawn from.
--
-- Only stopped_at IS NULL demands are excluded from nothing -- a
-- stopped demand's completed stages still count (it genuinely took
-- that long to get triaged before being stopped), it simply won't
-- have later-stage data to average, which the per-stage counts already
-- handle without a separate exclusion rule.
--
-- No organization_id filter needed: every underlying table (portfolio,
-- demand, demand_assessment, business_case, demand_delivery) already
-- carries its own FORCE ROW LEVEL SECURITY policy, so this view is
-- automatically tenant-scoped the same way annual_plan_totals and
-- demand_priority_view already are -- proven, not assumed, at the end
-- of this file.

BEGIN;

CREATE VIEW portfolio_report AS
SELECT
    p.id   AS portfolio_id,
    p.name AS portfolio_name,
    COUNT(d.id) AS demand_count,

    -- ---------- Stage timing, in days ----------
    AVG(EXTRACT(EPOCH FROM (d.triaged_at - d.created_at)) / 86400.0)
        FILTER (WHERE d.triaged_at IS NOT NULL) AS avg_days_raise_to_triage,
    COUNT(*) FILTER (WHERE d.triaged_at IS NOT NULL) AS n_raise_to_triage,

    AVG(EXTRACT(EPOCH FROM (da.assessed_at - d.triaged_at)) / 86400.0)
        FILTER (WHERE da.assessed_at IS NOT NULL AND d.triaged_at IS NOT NULL) AS avg_days_triage_to_assess,
    COUNT(*) FILTER (WHERE da.assessed_at IS NOT NULL AND d.triaged_at IS NOT NULL) AS n_triage_to_assess,

    AVG(EXTRACT(EPOCH FROM (d.accepted_at - da.assessed_at)) / 86400.0)
        FILTER (WHERE d.accepted_at IS NOT NULL AND da.assessed_at IS NOT NULL) AS avg_days_assess_to_promote,
    COUNT(*) FILTER (WHERE d.accepted_at IS NOT NULL AND da.assessed_at IS NOT NULL) AS n_assess_to_promote,

    AVG(EXTRACT(EPOCH FROM (bc.decision_date::TIMESTAMPTZ - d.accepted_at)) / 86400.0)
        FILTER (WHERE bc.decision_date IS NOT NULL AND d.accepted_at IS NOT NULL) AS avg_days_promote_to_decision,
    COUNT(*) FILTER (WHERE bc.decision_date IS NOT NULL AND d.accepted_at IS NOT NULL) AS n_promote_to_decision,

    AVG(EXTRACT(EPOCH FROM (dd.delivery_started_at - bc.decision_date::TIMESTAMPTZ)) / 86400.0)
        FILTER (WHERE dd.delivery_started_at IS NOT NULL AND bc.decision_date IS NOT NULL) AS avg_days_decision_to_delivery_start,
    COUNT(*) FILTER (WHERE dd.delivery_started_at IS NOT NULL AND bc.decision_date IS NOT NULL) AS n_decision_to_delivery_start,

    AVG(EXTRACT(EPOCH FROM (dd.delivery_completed_at - dd.delivery_started_at)) / 86400.0)
        FILTER (WHERE dd.delivery_completed_at IS NOT NULL AND dd.delivery_started_at IS NOT NULL) AS avg_days_delivery_duration,
    COUNT(*) FILTER (WHERE dd.delivery_completed_at IS NOT NULL AND dd.delivery_started_at IS NOT NULL) AS n_delivery_duration,

    AVG(EXTRACT(EPOCH FROM (dd.adoption_measured_at - dd.delivery_completed_at)) / 86400.0)
        FILTER (WHERE dd.adoption_measured_at IS NOT NULL AND dd.delivery_completed_at IS NOT NULL) AS avg_days_complete_to_adoption,
    COUNT(*) FILTER (WHERE dd.adoption_measured_at IS NOT NULL AND dd.delivery_completed_at IS NOT NULL) AS n_complete_to_adoption,

    AVG(EXTRACT(EPOCH FROM (dd.benefit_realized_at - dd.adoption_measured_at)) / 86400.0)
        FILTER (WHERE dd.benefit_realized_at IS NOT NULL AND dd.adoption_measured_at IS NOT NULL) AS avg_days_adoption_to_benefit,
    COUNT(*) FILTER (WHERE dd.benefit_realized_at IS NOT NULL AND dd.adoption_measured_at IS NOT NULL) AS n_adoption_to_benefit,

    -- ---------- Spend and benefit: P50 claimed, P75 assessed, P100 actual ----------
    -- Kept as three distinct pairs, never blended into one "the number"
    -- -- that is the entire point of not overwriting a claim.
    AVG(d.claimed_cost) FILTER (WHERE d.claimed_cost IS NOT NULL) AS avg_claimed_cost,
    COUNT(*) FILTER (WHERE d.claimed_cost IS NOT NULL) AS n_claimed_cost,
    AVG(d.claimed_benefit) FILTER (WHERE d.claimed_benefit IS NOT NULL) AS avg_claimed_benefit,
    COUNT(*) FILTER (WHERE d.claimed_benefit IS NOT NULL) AS n_claimed_benefit,

    AVG(da.assessed_cost) FILTER (WHERE da.assessed_cost IS NOT NULL) AS avg_assessed_cost,
    COUNT(*) FILTER (WHERE da.assessed_cost IS NOT NULL) AS n_assessed_cost,
    AVG(da.assessed_benefit) FILTER (WHERE da.assessed_benefit IS NOT NULL) AS avg_assessed_benefit,
    COUNT(*) FILTER (WHERE da.assessed_benefit IS NOT NULL) AS n_assessed_benefit,

    AVG(dd.actual_cost) FILTER (WHERE dd.actual_cost IS NOT NULL) AS avg_actual_cost,
    COUNT(*) FILTER (WHERE dd.actual_cost IS NOT NULL) AS n_actual_cost,
    AVG(dd.actual_benefit_value) FILTER (WHERE dd.actual_benefit_value IS NOT NULL) AS avg_actual_benefit,
    COUNT(*) FILTER (WHERE dd.actual_benefit_value IS NOT NULL) AS n_actual_benefit

FROM portfolio p
LEFT JOIN demand d ON d.portfolio_id = p.id
LEFT JOIN demand_assessment da ON da.demand_id = d.id
LEFT JOIN business_case bc ON bc.demand_id = d.id
LEFT JOIN demand_delivery dd ON dd.demand_id = d.id
WHERE p.parent_portfolio_id IS NULL  -- raising portfolios are parent-level by convention; excludes any sub-portfolio row that never has demand raised directly against it
GROUP BY p.id, p.name;

COMMENT ON VIEW portfolio_report IS
  'Per-portfolio rollup: average days spent in each lifecycle stage, and average claimed (P50) / assessed (P75) / actual (P100) cost and benefit. Every average has a matching n_ count column -- always display them together, never the average alone (see file header). Derived live from existing columns, nothing new stored. Tenant-scoped automatically via the underlying tables'' own RLS policies.';

-- ---------- Prove tenant scoping actually holds, not just assumed ----------
DO $$
DECLARE
    org_a UUID := gen_random_uuid();
    org_b UUID := gen_random_uuid();
    portfolio_a UUID;
    leaked_count INT;
BEGIN
    PERFORM set_config('app.current_org', org_a::TEXT, true);
    INSERT INTO organization (id, name) VALUES (org_a, 'RLS test org A');
    INSERT INTO portfolio (id, organization_id, name) VALUES (gen_random_uuid(), org_a, 'RLS test portfolio A') RETURNING id INTO portfolio_a;

    PERFORM set_config('app.current_org', org_b::TEXT, true);
    INSERT INTO organization (id, name) VALUES (org_b, 'RLS test org B');
    INSERT INTO portfolio (id, organization_id, name) VALUES (gen_random_uuid(), org_b, 'RLS test portfolio B');

    -- Still org B's context: can it see org A's portfolio via the view?
    SELECT COUNT(*) INTO leaked_count FROM portfolio_report WHERE portfolio_id = portfolio_a;

    -- Clean up before asserting, so a failed assertion doesn't leave test rows behind
    PERFORM set_config('app.current_org', org_a::TEXT, true);
    DELETE FROM portfolio WHERE organization_id = org_a;
    DELETE FROM organization WHERE id = org_a;
    PERFORM set_config('app.current_org', org_b::TEXT, true);
    DELETE FROM portfolio WHERE organization_id = org_b;
    DELETE FROM organization WHERE id = org_b;

    IF leaked_count > 0 THEN
        RAISE EXCEPTION 'portfolio_report leaked cross-tenant data: org B could see org A''s portfolio';
    END IF;
    RAISE NOTICE 'portfolio_report tenant isolation confirmed: org B saw 0 rows for org A''s portfolio.';
END $$;

COMMIT;
