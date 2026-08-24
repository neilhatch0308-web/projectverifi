-- ============================================================
-- 22b_backfill_fix.sql
--
-- Fixes a type-cast bug in 22_backfill_seed_demands.sql: demand_id was
-- cast to uuid in the WHERE NOT EXISTS checks but not in the SELECT
-- column list itself, so three INSERT blocks failed with a type
-- mismatch (VALUES produces text columns by default). This re-runs
-- just those three, corrected.
-- ============================================================

-- ---------- Priority scores ----------

INSERT INTO demand_score (id, demand_id, criterion_id, score_awarded, rationale, scored_by)
SELECT gen_random_uuid(), d.demand_id::uuid, sc.id, d.score, d.rationale, '41111111-0000-0000-0000-000000000016'
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

-- ---------- Success measures ----------

INSERT INTO kpi_definition (id, demand_id, name, dimension, kpi_type, unit, baseline_value, target_value, owner_user_id)
SELECT gen_random_uuid(), d.demand_id::uuid, d.name, d.dimension, 'lagging', d.unit, d.baseline, d.target, d.owner_id::uuid
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

-- ---------- RACI for the 6 already-promoted demands ----------

INSERT INTO demand_raci (id, demand_id, accountable_financial_id, accountable_scope_id, accountable_schedule_id, sponsor_id, benefit_owner_id)
SELECT gen_random_uuid(), d.demand_id::uuid, d.fin::uuid, d.scope::uuid, d.sched::uuid, d.sponsor::uuid, d.benefit::uuid
FROM (VALUES
    ('61111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000003', '41111111-0000-0000-0000-000000000004', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000001'),
    ('61111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000011', '41111111-0000-0000-0000-000000000010', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000012'),
    ('61111111-0000-0000-0000-000000000003', '41111111-0000-0000-0000-000000000013', '41111111-0000-0000-0000-000000000003', '41111111-0000-0000-0000-000000000004', '41111111-0000-0000-0000-000000000008', '41111111-0000-0000-0000-000000000012'),
    ('61111111-0000-0000-0000-000000000008', '41111111-0000-0000-0000-000000000014', '41111111-0000-0000-0000-000000000005', '41111111-0000-0000-0000-000000000005', '41111111-0000-0000-0000-000000000008', '41111111-0000-0000-0000-000000000015'),
    ('61111111-0000-0000-0000-000000000009', '41111111-0000-0000-0000-000000000013', '41111111-0000-0000-0000-000000000006', '41111111-0000-0000-0000-000000000009', '41111111-0000-0000-0000-000000000006', '41111111-0000-0000-0000-000000000015'),
    ('61111111-0000-0000-0000-000000000010', '41111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000011', '41111111-0000-0000-0000-000000000010', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000012')
) AS d(demand_id, fin, scope, sched, sponsor, benefit)
WHERE NOT EXISTS (SELECT 1 FROM demand_raci r WHERE r.demand_id = d.demand_id::uuid);