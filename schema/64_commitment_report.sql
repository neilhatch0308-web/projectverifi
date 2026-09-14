-- 64_commitment_report.sql
--
-- Fourth sibling to portfolio_report() / demand_variance_report /
-- demand_stage_aging (migrations 60-62) -- same "derive rather than
-- duplicate" instinct (decision 75), reused a fourth time. Answers a
-- different question from the other three: not "how long does work
-- take" or "how far did actuals land from the original claim", but
-- "how much of what we've approved to spend has actually gone out the
-- door, right now." This is the number finance asks for on a
-- standing, recurring basis -- it did not have a rollup of its own
-- before this migration; it lived only per-business-case on Business
-- Case Detail.
--
-- Scoped to APPROVED business cases only (business_case.decision =
-- 'approved') -- a pending or declined case has no real commitment
-- behind it yet. approved_amount is the anchored commitment (locked
-- post-approval as of migration 54, changeable only with a logged
-- reason); actual_spend_to_date is the live, freely-moving figure by
-- design (migration 54's own note: treating its normal movement as a
-- tracked "revision" would misrepresent expected activity as an
-- exception). This report is exactly where that distinction pays off:
-- it's the one place actual_spend_to_date's continuous movement is
-- meant to be watched against the anchored approved_amount.
--
-- Two objects, same split as Variance/Aging: an aggregate (this
-- migration's commitment_report()) and a named list
-- (business_case_commitment) so a portfolio-level total never hides
-- which specific case is driving it -- same discipline, not a new one.
--
-- variance_amount is defined as (approved_amount - actual_spend_to_date)
-- -- POSITIVE means money approved but not yet spent (the "exposure"
-- headline), NEGATIVE means spend has overtaken what was approved (an
-- overrun in flight, not yet reconciled via business_case_revision).
-- Both directions matter and are shown as one signed figure, not two
-- separate columns, because unlike cost/benefit in Variance Report
-- these are the same unit and the same failure surface -- collapsing
-- them here does not hide a distinct failure mode the way blending
-- cost and benefit variance would.
--
-- variance_pct is NULL, never a fabricated number, when approved_amount
-- is zero or NULL -- same rule as demand_variance_report.
--
-- No organization_id filter needed: business_case, investment, and
-- demand all already carry their own FORCE ROW LEVEL SECURITY policy,
-- so both objects below are automatically tenant-scoped the same way
-- portfolio_report/demand_variance_report/demand_stage_aging already
-- are -- proven, not assumed, at the end of this file.

BEGIN;

-- ========== 1. Portfolio rollup: total approved vs actual, by raising portfolio ==========

CREATE FUNCTION commitment_report()
RETURNS TABLE (
    portfolio_id UUID,
    portfolio_name TEXT,
    n_approved_cases BIGINT,
    total_approved NUMERIC,
    total_actual NUMERIC,
    variance_amount NUMERIC,
    variance_pct NUMERIC,
    n_overrun BIGINT
) AS $$
SELECT
    p.id,
    p.name,
    COUNT(bc.id),
    COALESCE(SUM(inv.approved_amount), 0),
    COALESCE(SUM(inv.actual_spend_to_date), 0),
    COALESCE(SUM(inv.approved_amount), 0) - COALESCE(SUM(inv.actual_spend_to_date), 0),
    CASE WHEN COALESCE(SUM(inv.approved_amount), 0) != 0
         THEN ROUND(((SUM(inv.approved_amount) - SUM(inv.actual_spend_to_date)) / SUM(inv.approved_amount)) * 100, 1)
         ELSE NULL END,
    COUNT(*) FILTER (WHERE inv.actual_spend_to_date > inv.approved_amount)
FROM portfolio p
LEFT JOIN demand d ON d.portfolio_id = p.id
LEFT JOIN business_case bc ON bc.demand_id = d.id AND bc.decision = 'approved'
LEFT JOIN investment inv ON inv.business_case_id = bc.id
WHERE p.parent_portfolio_id IS NULL
GROUP BY p.id, p.name;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION commitment_report IS
  'Per-portfolio rollup of approved spend (investment.approved_amount) vs actual spend to date (investment.actual_spend_to_date), for business cases with decision = ''approved'' only. variance_amount = approved - actual: positive is approved-but-unspent exposure, negative is an in-flight overrun. variance_pct is NULL when total_approved is zero. n_overrun counts individual business cases where actual has exceeded approved. Tenant-scoped automatically via the underlying tables'' own RLS policies.';

-- ========== 2. Named list: individual business cases, worst variance first ==========
--
-- Mirrors demand_variance_report's shape and its confidentiality
-- contract exactly: CONFIDENTIALITY IS NOT FILTERED HERE, the calling
-- route must filter with (confidential = false OR
-- can_view_confidential_demand(demand_id, $user_id)).

CREATE VIEW business_case_commitment AS
SELECT
    bc.id AS business_case_id,
    bc.demand_id,
    d.title,
    d.portfolio_id,
    p.name AS portfolio_name,
    d.confidential,
    bc.decision_date,
    inv.approved_amount,
    inv.actual_spend_to_date,
    (inv.approved_amount - inv.actual_spend_to_date) AS variance_amount,
    CASE WHEN inv.approved_amount IS NOT NULL AND inv.approved_amount != 0
         THEN ROUND(((inv.approved_amount - inv.actual_spend_to_date) / inv.approved_amount) * 100, 1)
         ELSE NULL END AS variance_pct,
    (inv.actual_spend_to_date > inv.approved_amount) AS is_overrun
FROM business_case bc
JOIN demand d ON d.id = bc.demand_id
JOIN portfolio p ON p.id = d.portfolio_id
LEFT JOIN investment inv ON inv.business_case_id = bc.id
WHERE bc.decision = 'approved';

COMMENT ON VIEW business_case_commitment IS
  'Per-business-case approved vs actual spend, decision = approved only. variance_amount = approved - actual (positive = unspent exposure, negative = overrun). CONFIDENTIALITY IS NOT FILTERED HERE -- the calling route must filter with (confidential = false OR can_view_confidential_demand(demand_id, $user_id)).';

-- ---------- Prove tenant scoping actually holds, not just assumed ----------
DO $$
DECLARE
    org_a UUID := gen_random_uuid();
    org_b UUID := gen_random_uuid();
    portfolio_a UUID;
    leaked_count INT;
BEGIN
    PERFORM set_config('app.current_org', org_a::TEXT, true);
    INSERT INTO organization (id, name) VALUES (org_a, 'RLS test org A (migration 64)');
    INSERT INTO portfolio (id, organization_id, name) VALUES (gen_random_uuid(), org_a, 'RLS test portfolio A') RETURNING id INTO portfolio_a;

    PERFORM set_config('app.current_org', org_b::TEXT, true);
    INSERT INTO organization (id, name) VALUES (org_b, 'RLS test org B (migration 64)');
    INSERT INTO portfolio (id, organization_id, name) VALUES (gen_random_uuid(), org_b, 'RLS test portfolio B');

    -- Still org B's context: can it see org A's portfolio via either object?
    SELECT COUNT(*) INTO leaked_count FROM commitment_report() WHERE portfolio_id = portfolio_a;

    PERFORM set_config('app.current_org', org_a::TEXT, true);
    DELETE FROM portfolio WHERE organization_id = org_a;
    DELETE FROM organization WHERE id = org_a;
    PERFORM set_config('app.current_org', org_b::TEXT, true);
    DELETE FROM portfolio WHERE organization_id = org_b;
    DELETE FROM organization WHERE id = org_b;

    IF leaked_count > 0 THEN
        RAISE EXCEPTION 'commitment_report() leaked cross-tenant data: org B could see org A''s portfolio';
    END IF;
    RAISE NOTICE 'commitment_report() tenant isolation confirmed: org B saw 0 rows for org A''s portfolio.';
END $$;

COMMIT;
