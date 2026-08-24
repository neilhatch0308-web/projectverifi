-- ============================================================
-- 22_backfill_seed_demands.sql
--
-- The original 10 demands in 10_seed_dummy_data.sql predate sponsor,
-- need-by date, outcome statement, priority scoring, and the RACI/
-- business-case auto-creation flow. They've been sitting with genuinely
-- empty fields ever since - not a display bug, just incomplete legacy
-- seed data. This backfills all 10 so every demand in the demo dataset
-- looks equally complete, regardless of when it was created.
--
-- For the 6 demands already at 'promoted' status, this also creates the
-- demand_raci, business_case, investment, and a benefit row they'd have
-- gotten automatically had they gone through the real accept flow -
-- since they were seeded directly at 'promoted' rather than genuinely
-- promoted through the app.
-- ============================================================

-- ---------- Sponsor, need-by date, outcome statement (all 10) ----------

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000002', -- L. Ward
    need_by_date = '2026-08-01',
    outcome_statement = 'Automated reconciliation between actuals and forecast, flagging anomalies for review within 24 hours instead of monthly.'
WHERE id = '61111111-0000-0000-0000-000000000001';

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000002', -- L. Ward
    need_by_date = '2026-06-15',
    outcome_statement = 'Field engineers log job completion on a mobile app in real time, replacing paper job sheets and same-day office re-keying.'
WHERE id = '61111111-0000-0000-0000-000000000002';

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000008', -- E. Novak
    need_by_date = '2026-05-01',
    outcome_statement = 'A self-service portal cutting vendor onboarding from 6+ weeks to under 2 weeks, with a single source of truth for vendor status.'
WHERE id = '61111111-0000-0000-0000-000000000003';

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000014', -- G. Adeyemi
    need_by_date = '2026-09-30',
    outcome_statement = 'Legacy CRM fully decommissioned, all live data migrated, halving the ongoing licensing and maintenance cost.'
WHERE id = '61111111-0000-0000-0000-000000000004';

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000008', -- E. Novak
    need_by_date = '2026-10-01',
    outcome_statement = 'Real-time line-level throughput and fault-rate dashboards, giving floor supervisors same-shift visibility instead of next-day reports.'
WHERE id = '61111111-0000-0000-0000-000000000005';

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000006', -- A. Rossi
    need_by_date = '2026-07-15',
    outcome_statement = 'A central rules engine setting regional pricing automatically within approved bands, removing manual per-market pricing decisions.'
WHERE id = '61111111-0000-0000-0000-000000000006';

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000002', -- L. Ward
    need_by_date = '2026-05-30',
    outcome_statement = 'A single, always-current content hub so reps always pull the latest approved collateral, not a locally-saved outdated deck.'
WHERE id = '61111111-0000-0000-0000-000000000007';

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000008', -- E. Novak
    need_by_date = '2026-04-01',
    outcome_statement = 'Continuous sensor monitoring catching near-miss safety events between scheduled walkthroughs, not just at inspection time.'
WHERE id = '61111111-0000-0000-0000-000000000008';

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000006', -- A. Rossi
    need_by_date = '2026-03-01',
    outcome_statement = 'Export paperwork auto-compiled per shipment from existing order data, cutting customs clearance delays caused by manual errors.'
WHERE id = '61111111-0000-0000-0000-000000000009';

UPDATE demand SET
    sponsor_user_id = '41111111-0000-0000-0000-000000000002', -- L. Ward
    need_by_date = '2026-04-30',
    outcome_statement = 'A digital shift-scheduling tool giving real-time coverage visibility, replacing the whiteboard and eliminating last-minute gaps.'
WHERE id = '61111111-0000-0000-0000-000000000010';

-- ---------- Priority scores (2-3 per demand, against the real 5-category model) ----------

INSERT INTO demand_score (id, demand_id, criterion_id, score_awarded, rationale, scored_by)
SELECT gen_random_uuid(), d.demand_id, sc.id, d.score, d.rationale, '41111111-0000-0000-0000-000000000016'
FROM (VALUES
    ('61111111-0000-0000-0000-000000000001', 'Financial / Revenue Impact', 15, 'Moderate cost reduction from fewer manual reconciliation hours'),
    ('61111111-0000-0000-0000-000000000001', 'Cyber / Operational Risk Reduction', 10, 'Reduces risk of undetected forecast anomalies'),
    ('61111111-0000-0000-0000-000000000002', 'Financial / Revenue Impact', 15, 'Significant reduction in re-keying and admin overhead'),
    ('61111111-0000-0000-0000-000000000002', 'Reputational / Customer Impact', 10, 'Faster, more accurate job completion improves customer experience'),
    ('61111111-0000-0000-0000-000000000003', 'Financial / Revenue Impact', 10, 'Moderate cost reduction in onboarding admin time'),
    ('61111111-0000-0000-0000-000000000003', 'Competitive Positioning', 5, 'Slight improvement vs peer onboarding speed'),
    ('61111111-0000-0000-0000-000000000004', 'Financial / Revenue Impact', 15, 'Halves ongoing licensing cost'),
    ('61111111-0000-0000-0000-000000000004', 'Regulatory / Legislative Drivers', 5, 'Recommended best practice, not mandatory'),
    ('61111111-0000-0000-0000-000000000005', 'Cyber / Operational Risk Reduction', 15, 'Addresses high-impact undetected fault risk'),
    ('61111111-0000-0000-0000-000000000005', 'Financial / Revenue Impact', 10, 'Moderate cost avoidance from earlier fault detection'),
    ('61111111-0000-0000-0000-000000000006', 'Financial / Revenue Impact', 20, 'Major revenue protection from consistent pricing'),
    ('61111111-0000-0000-0000-000000000006', 'Competitive Positioning', 15, 'Strong differentiation vs manual peer pricing'),
    ('61111111-0000-0000-0000-000000000007', 'Reputational / Customer Impact', 5, 'Minor improvement to rep-facing experience'),
    ('61111111-0000-0000-0000-000000000008', 'Cyber / Operational Risk Reduction', 20, 'Eliminates a critical safety-incident blind spot'),
    ('61111111-0000-0000-0000-000000000008', 'Regulatory / Legislative Drivers', 15, 'Required for compliance within 12-24 months'),
    ('61111111-0000-0000-0000-000000000009', 'Financial / Revenue Impact', 10, 'Moderate cost reduction from fewer clearance delays'),
    ('61111111-0000-0000-0000-000000000009', 'Reputational / Customer Impact', 10, 'Noticeable improvement to shipment reliability'),
    ('61111111-0000-0000-0000-000000000010', 'Cyber / Operational Risk Reduction', 10, 'Reduces risk of uncovered shifts'),
    ('61111111-0000-0000-0000-000000000010', 'Financial / Revenue Impact', 5, 'Minor efficiency gain in scheduling admin')
) AS d(demand_id, criterion_name, score, rationale)
JOIN scoring_criterion sc ON sc.name = d.criterion_name AND sc.organization_id = '11111111-1111-1111-1111-111111111111'
WHERE NOT EXISTS (
    SELECT 1 FROM demand_score ds WHERE ds.demand_id = d.demand_id::uuid AND ds.criterion_id = sc.id
);

-- ---------- Success measures for demands that never had any (3-10) ----------
-- Demands 1 and 2 already have kpi_definition rows from the original seed file.

INSERT INTO kpi_definition (id, demand_id, name, dimension, kpi_type, unit, baseline_value, target_value, owner_user_id)
SELECT gen_random_uuid(), d.demand_id, d.name, d.dimension, 'lagging', d.unit, d.baseline, d.target, d.owner_id
FROM (VALUES
    ('61111111-0000-0000-0000-000000000003', 'Onboarding cycle time', 'delivery', 'days', 42, 10, '41111111-0000-0000-0000-000000000003'),
    ('61111111-0000-0000-0000-000000000004', 'Legacy system decommission', 'delivery', 'months', 0, 9, '41111111-0000-0000-0000-000000000004'),
    ('61111111-0000-0000-0000-000000000005', 'Line telemetry adoption', 'adoption', '%', 0, 75, '41111111-0000-0000-0000-000000000005'),
    ('61111111-0000-0000-0000-000000000006', 'Pricing consistency', 'business', '%', 60, 95, '41111111-0000-0000-0000-000000000006'),
    ('61111111-0000-0000-0000-000000000007', 'Content hub adoption', 'adoption', '%', 0, 80, '41111111-0000-0000-0000-000000000007'),
    ('61111111-0000-0000-0000-000000000008', 'Near-miss detection rate', 'business', '%', 20, 90, '41111111-0000-0000-0000-000000000008'),
    ('61111111-0000-0000-0000-000000000009', 'Customs clearance delay', 'business', 'days', 5, 1, '41111111-0000-0000-0000-000000000009'),
    ('61111111-0000-0000-0000-000000000010', 'Coverage gap incidents', 'business', 'per month', 6, 1, '41111111-0000-0000-0000-000000000010')
) AS d(demand_id, name, dimension, unit, baseline, target, owner_id)
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_definition kd WHERE kd.demand_id = d.demand_id::uuid
);

-- ---------- Triage assessment (demands already past 'raised': 4, 6, and the 6 promoted ones) ----------

UPDATE demand SET complexity_tier = 'medium', cost_tier = 'low',
    triaged_by = '41111111-0000-0000-0000-000000000016', triaged_at = raised_date + INTERVAL '5 days',
    triage_notes = 'Clear cost benefit, straightforward decommission plan.'
WHERE id = '61111111-0000-0000-0000-000000000004';

UPDATE demand SET complexity_tier = 'high', cost_tier = 'medium',
    triaged_by = '41111111-0000-0000-0000-000000000016', triaged_at = raised_date + INTERVAL '4 days',
    triage_notes = 'Significant integration work across regional pricing systems.'
WHERE id = '61111111-0000-0000-0000-000000000006';

UPDATE demand SET complexity_tier = 'medium', cost_tier = 'medium',
    triaged_by = '41111111-0000-0000-0000-000000000016', triaged_at = raised_date + INTERVAL '3 days',
    triage_notes = 'Approved - clear ROI, moderate integration effort.'
WHERE id IN (
    '61111111-0000-0000-0000-000000000001', '61111111-0000-0000-0000-000000000002',
    '61111111-0000-0000-0000-000000000003', '61111111-0000-0000-0000-000000000008',
    '61111111-0000-0000-0000-000000000009', '61111111-0000-0000-0000-000000000010'
);

-- ---------- RACI, business case, investment, benefit for the 6 already-promoted demands ----------
-- These were seeded directly at 'promoted' status, skipping the real accept
-- flow - so they never got the RACI/business-case rows that flow creates
-- automatically. Backfilling so "View business case" actually has something
-- real to show.

INSERT INTO demand_raci (id, demand_id, accountable_financial_id, accountable_scope_id, accountable_schedule_id, sponsor_id, benefit_owner_id)
SELECT gen_random_uuid(), d.demand_id, d.fin, d.scope, d.sched, d.sponsor, d.benefit
FROM (VALUES
    ('61111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000003', '41111111-0000-0000-0000-000000000004', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000001'),
    ('61111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000011', '41111111-0000-0000-0000-000000000010', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000012'),
    ('61111111-0000-0000-0000-000000000003', '41111111-0000-0000-0000-000000000013', '41111111-0000-0000-0000-000000000003', '41111111-0000-0000-0000-000000000004', '41111111-0000-0000-0000-000000000008', '41111111-0000-0000-0000-000000000012'),
    ('61111111-0000-0000-0000-000000000008', '41111111-0000-0000-0000-000000000014', '41111111-0000-0000-0000-000000000005', '41111111-0000-0000-0000-000000000005', '41111111-0000-0000-0000-000000000008', '41111111-0000-0000-0000-000000000015'),
    ('61111111-0000-0000-0000-000000000009', '41111111-0000-0000-0000-000000000013', '41111111-0000-0000-0000-000000000006', '41111111-0000-0000-0000-000000000009', '41111111-0000-0000-0000-000000000006', '41111111-0000-0000-0000-000000000015'),
    ('61111111-0000-0000-0000-000000000010', '41111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000011', '41111111-0000-0000-0000-000000000010', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000012')
) AS d(demand_id, fin, scope, sched, sponsor, benefit)
WHERE NOT EXISTS (SELECT 1 FROM demand_raci r WHERE r.demand_id = d.demand_id::uuid);

UPDATE demand SET accepted_at = raised_date + INTERVAL '10 days'
WHERE id IN (
    '61111111-0000-0000-0000-000000000001', '61111111-0000-0000-0000-000000000002',
    '61111111-0000-0000-0000-000000000003', '61111111-0000-0000-0000-000000000008',
    '61111111-0000-0000-0000-000000000009', '61111111-0000-0000-0000-000000000010'
) AND accepted_at IS NULL;

INSERT INTO business_case (id, organization_id, portfolio_id, demand_id, title, sponsor_user_id, submitted_by, requested_spend, decision, decision_date)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', d.portfolio_id, d.demand_id, d.title, d.sponsor, d.sponsor, d.spend, 'approved', d.raised_date::date + INTERVAL '14 days'
FROM (
    SELECT dm.id AS demand_id, dm.portfolio_id, dm.title, dm.sponsor_user_id AS sponsor, dm.raised_date,
           CASE dm.id
               WHEN '61111111-0000-0000-0000-000000000001' THEN 120000
               WHEN '61111111-0000-0000-0000-000000000002' THEN 340000
               WHEN '61111111-0000-0000-0000-000000000003' THEN 65000
               WHEN '61111111-0000-0000-0000-000000000008' THEN 45000
               WHEN '61111111-0000-0000-0000-000000000009' THEN 90000
               WHEN '61111111-0000-0000-0000-000000000010' THEN 38000
           END AS spend
    FROM demand dm
    WHERE dm.id IN (
        '61111111-0000-0000-0000-000000000001', '61111111-0000-0000-0000-000000000002',
        '61111111-0000-0000-0000-000000000003', '61111111-0000-0000-0000-000000000008',
        '61111111-0000-0000-0000-000000000009', '61111111-0000-0000-0000-000000000010'
    )
) AS d
WHERE NOT EXISTS (SELECT 1 FROM business_case bc WHERE bc.demand_id = d.demand_id);

INSERT INTO investment (business_case_id, approved_amount, actual_spend_to_date)
SELECT bc.id, bc.requested_spend, ROUND(bc.requested_spend * 0.8)
FROM business_case bc
WHERE bc.demand_id IN (
    '61111111-0000-0000-0000-000000000001', '61111111-0000-0000-0000-000000000002',
    '61111111-0000-0000-0000-000000000003', '61111111-0000-0000-0000-000000000008',
    '61111111-0000-0000-0000-000000000009', '61111111-0000-0000-0000-000000000010'
)
AND NOT EXISTS (SELECT 1 FROM investment i WHERE i.business_case_id = bc.id);

INSERT INTO benefit (id, business_case_id, title, benefit_type, claimed_value, owner_user_id, status)
SELECT gen_random_uuid(), bc.id, d.benefit_title, d.benefit_type, d.claimed_value, bc.sponsor_user_id, 'forecast'
FROM business_case bc
JOIN (VALUES
    ('61111111-0000-0000-0000-000000000001', 'Reduced reconciliation labour', 'efficiency_hours', 55000),
    ('61111111-0000-0000-0000-000000000002', 'Faster job turnaround', 'efficiency_hours', 70000),
    ('61111111-0000-0000-0000-000000000003', 'Onboarding admin reduction', 'cost_saving', 32000),
    ('61111111-0000-0000-0000-000000000008', 'Avoided incident cost', 'risk_reduction', 40000),
    ('61111111-0000-0000-0000-000000000009', 'Reduced clearance penalties', 'cost_saving', 28000),
    ('61111111-0000-0000-0000-000000000010', 'Reduced overtime cover', 'cost_saving', 18000)
) AS d(demand_id, benefit_title, benefit_type, claimed_value) ON bc.demand_id = d.demand_id::uuid
WHERE NOT EXISTS (SELECT 1 FROM benefit b WHERE b.business_case_id = bc.id);
