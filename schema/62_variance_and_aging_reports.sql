-- 62_variance_and_aging_reports.sql
--
-- Two named-list reports, complementing the portfolio-level averages
-- in portfolio_report (migrations 60-61). Both views return raw,
-- per-demand data with confidential flags passed through -- neither
-- filters by confidentiality itself, because a view has no user
-- context to check against. The calling route MUST filter with
-- can_view_confidential_demand(demand_id, $user_id) OR confidential =
-- false, same discipline as every other confidential-demand read path
-- in this schema. This is called out explicitly in both view comments
-- so it isn't missed the way it nearly was on Delivery tracking
-- earlier this session.

BEGIN;

-- ========== 1. Variance report: biggest gaps between claimed and actual ==========
--
-- A named list, not an average -- "these specific demands landed
-- furthest from what was claimed, worst first." An aggregate average
-- (portfolio_report) can hide one bad miss inside nine accurate calls;
-- this surfaces the miss by name.
--
-- Only includes demands with at least one ACTUAL figure recorded
-- (delivery completed / benefit realized) -- there is nothing to
-- compare a claim against until something actually happened. This is
-- the honest floor: a demand still in flight has no variance yet, not
-- a variance of zero.
--
-- "Gap" is defined per dimension (cost, benefit) as actual minus
-- claimed, both as an absolute figure and a percentage of the claim.
-- Deliberately NOT collapsed into one blended "how wrong were they"
-- score -- a cost overrun and a benefit shortfall are different
-- failure modes with different owners, and blending them would hide
-- which one actually happened. The route/UI sorts by whichever
-- dimension it's ranking on, or by GREATEST(ABS(%)) across both for a
-- single "worst miss in either direction" ordering.
--
-- Percentage variance is NULL (not divide-by-zero, not infinity) when
-- the claimed figure itself was zero or NULL -- a real, disclosed gap
-- in what can be shown, not a fabricated number.

CREATE VIEW demand_variance_report AS
SELECT
    d.id AS demand_id,
    d.title,
    d.portfolio_id,
    p.name AS portfolio_name,
    d.confidential,

    d.claimed_cost,
    dd.actual_cost,
    (dd.actual_cost - d.claimed_cost) AS cost_variance_abs,
    CASE WHEN d.claimed_cost IS NOT NULL AND d.claimed_cost != 0 AND dd.actual_cost IS NOT NULL
         THEN ROUND(((dd.actual_cost - d.claimed_cost) / d.claimed_cost) * 100, 1)
         ELSE NULL END AS cost_variance_pct,

    d.claimed_benefit,
    dd.actual_benefit_value,
    (dd.actual_benefit_value - d.claimed_benefit) AS benefit_variance_abs,
    CASE WHEN d.claimed_benefit IS NOT NULL AND d.claimed_benefit != 0 AND dd.actual_benefit_value IS NOT NULL
         THEN ROUND(((dd.actual_benefit_value - d.claimed_benefit) / d.claimed_benefit) * 100, 1)
         ELSE NULL END AS benefit_variance_pct,

    dd.delivery_completed_at,
    dd.benefit_realized_at,
    dd.benefit_attribution_confidence

FROM demand d
JOIN demand_delivery dd ON dd.demand_id = d.id
JOIN portfolio p ON p.id = d.portfolio_id
WHERE dd.actual_cost IS NOT NULL OR dd.actual_benefit_value IS NOT NULL;

COMMENT ON VIEW demand_variance_report IS
  'Per-demand claimed (P50) vs actual (P100) cost and benefit, for demands with at least one actual figure recorded. CONFIDENTIALITY IS NOT FILTERED HERE -- the calling route must filter with (confidential = false OR can_view_confidential_demand(demand_id, $user_id)). Percentage columns are NULL, never a fabricated number, when the claimed figure was zero or missing.';

-- ========== 2. Stage aging: work currently sitting longer than usual ==========
--
-- Turns portfolio_report's historical averages from something read
-- once a month into something that flags outliers today: "this demand
-- has been in Triage for 40 days against this portfolio's own
-- historical average of 6." Reuses portfolio_report() as the baseline
-- rather than re-deriving the same AVG a third time (decision 75,
-- "derive rather than duplicate").
--
-- current_stage is derived from demand.status plus which downstream
-- rows exist yet -- deliberately mirrors the same stage boundaries
-- portfolio_report already measures, so a demand's "how long has it
-- been here" is always comparable to the exact historical average for
-- that same transition, never a mismatched or invented boundary.
--
-- Stopped demands are excluded entirely -- they are not "in" an
-- active stage waiting to move, they were deliberately taken off the
-- board. A demand that has fully realized its benefit is also
-- excluded (current_stage is NULL for it) -- it finished its journey,
-- there is nothing left to be "stuck" in.
--
-- portfolio_avg_days and n_baseline are ALWAYS carried alongside
-- days_in_current_stage, same discipline as portfolio_report itself:
-- never judge a demand as "stuck" against a baseline of n=0 or n=1.
-- The view returns every currently-active demand regardless of
-- baseline size; the ROUTE decides the minimum sample size worth
-- flagging against (kept as application policy, not baked into the
-- view, so it can be tuned without a migration).

CREATE VIEW demand_stage_aging AS
WITH stage_calc AS (
    SELECT
        d.id AS demand_id,
        d.title,
        d.portfolio_id,
        d.confidential,
        CASE
            WHEN d.status = 'raised' THEN 'raise'
            WHEN d.status = 'accepted' THEN 'triage'
            WHEN d.status = 'assessed' THEN 'assess'
            WHEN d.status = 'promoted' AND bc.decision_date IS NULL THEN 'promote'
            WHEN d.status = 'promoted' AND bc.decision_date IS NOT NULL AND dd.delivery_started_at IS NULL THEN 'decision'
            WHEN d.status = 'promoted' AND dd.delivery_started_at IS NOT NULL AND dd.delivery_completed_at IS NULL THEN 'delivery'
            WHEN d.status = 'promoted' AND dd.delivery_completed_at IS NOT NULL AND dd.adoption_measured_at IS NULL THEN 'adoption_wait'
            WHEN d.status = 'promoted' AND dd.adoption_measured_at IS NOT NULL AND dd.benefit_realized_at IS NULL THEN 'benefit_wait'
            ELSE NULL
        END AS current_stage,
        CASE
            WHEN d.status = 'raised' THEN EXTRACT(EPOCH FROM (now() - d.created_at)) / 86400.0
            WHEN d.status = 'accepted' THEN EXTRACT(EPOCH FROM (now() - d.triaged_at)) / 86400.0
            WHEN d.status = 'assessed' THEN EXTRACT(EPOCH FROM (now() - da.assessed_at)) / 86400.0
            WHEN d.status = 'promoted' AND bc.decision_date IS NULL THEN EXTRACT(EPOCH FROM (now() - d.accepted_at)) / 86400.0
            WHEN d.status = 'promoted' AND bc.decision_date IS NOT NULL AND dd.delivery_started_at IS NULL THEN EXTRACT(EPOCH FROM (now() - bc.decision_date::TIMESTAMPTZ)) / 86400.0
            WHEN d.status = 'promoted' AND dd.delivery_started_at IS NOT NULL AND dd.delivery_completed_at IS NULL THEN EXTRACT(EPOCH FROM (now() - dd.delivery_started_at)) / 86400.0
            WHEN d.status = 'promoted' AND dd.delivery_completed_at IS NOT NULL AND dd.adoption_measured_at IS NULL THEN EXTRACT(EPOCH FROM (now() - dd.delivery_completed_at)) / 86400.0
            WHEN d.status = 'promoted' AND dd.adoption_measured_at IS NOT NULL AND dd.benefit_realized_at IS NULL THEN EXTRACT(EPOCH FROM (now() - dd.adoption_measured_at)) / 86400.0
            ELSE NULL
        END AS days_in_current_stage
    FROM demand d
    LEFT JOIN demand_assessment da ON da.demand_id = d.id
    LEFT JOIN business_case bc ON bc.demand_id = d.id
    LEFT JOIN demand_delivery dd ON dd.demand_id = d.id
    WHERE d.stopped_at IS NULL
)
SELECT
    sc.demand_id, sc.title, sc.portfolio_id, p.name AS portfolio_name, sc.confidential,
    sc.current_stage, sc.days_in_current_stage,
    CASE sc.current_stage
        WHEN 'raise' THEN pr.avg_days_raise_to_triage
        WHEN 'triage' THEN pr.avg_days_triage_to_assess
        WHEN 'assess' THEN pr.avg_days_assess_to_promote
        WHEN 'promote' THEN pr.avg_days_promote_to_decision
        WHEN 'decision' THEN pr.avg_days_decision_to_delivery_start
        WHEN 'delivery' THEN pr.avg_days_delivery_duration
        WHEN 'adoption_wait' THEN pr.avg_days_complete_to_adoption
        WHEN 'benefit_wait' THEN pr.avg_days_adoption_to_benefit
    END AS portfolio_avg_days,
    CASE sc.current_stage
        WHEN 'raise' THEN pr.n_raise_to_triage
        WHEN 'triage' THEN pr.n_triage_to_assess
        WHEN 'assess' THEN pr.n_assess_to_promote
        WHEN 'promote' THEN pr.n_promote_to_decision
        WHEN 'decision' THEN pr.n_decision_to_delivery_start
        WHEN 'delivery' THEN pr.n_delivery_duration
        WHEN 'adoption_wait' THEN pr.n_complete_to_adoption
        WHEN 'benefit_wait' THEN pr.n_adoption_to_benefit
    END AS n_baseline
FROM stage_calc sc
JOIN portfolio p ON p.id = sc.portfolio_id
LEFT JOIN portfolio_report() pr ON pr.portfolio_id = sc.portfolio_id
WHERE sc.current_stage IS NOT NULL;

COMMENT ON VIEW demand_stage_aging IS
  'Every currently-active demand (not stopped, not fully realized) with how long it has sat in its current stage, alongside that portfolio''s own all-time average for that same transition (via portfolio_report()) and the sample size backing it. CONFIDENTIALITY IS NOT FILTERED HERE -- the calling route must filter with (confidential = false OR can_view_confidential_demand(demand_id, $user_id)). "Flagged as stuck" (days_in_current_stage > portfolio_avg_days, with a minimum n_baseline) is application policy, decided by the route, not baked in here.';

COMMIT;
