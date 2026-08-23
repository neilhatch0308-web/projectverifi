-- ============================================================
-- 10_seed_dummy_data.sql
--
-- Dummy data for local/dev use, deliberately matching the content shown
-- in the earlier UI mockups (Acme Holdings, the four demand examples,
-- the strategic goals, the RACI names) so the real UI looks like the
-- mockups did on first connect.
--
-- Apply AFTER 01-09, on a fresh dev database only. Not for production.
-- ============================================================

-- ---------- Organization ----------
INSERT INTO organization (id, name) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Acme Holdings');

-- ---------- Divisions (portfolio table) ----------
INSERT INTO portfolio (id, organization_id, name) VALUES
    ('21111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Operations'),
    ('21111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Manufacturing'),
    ('21111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Sales'),
    ('21111111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'International Sales'),
    ('21111111-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Finance'),
    ('21111111-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'IT');

-- ---------- Roles (seed defaults, from 08's suggested set) ----------
INSERT INTO role (id, code, name, description, is_system_role) VALUES
    ('31111111-0000-0000-0000-000000000001', 'org_admin', 'Org Admin', 'Full manage on everything within the organization', true),
    ('31111111-0000-0000-0000-000000000002', 'pmo', 'PMO', 'Demand create/read/score, similarity review gatekeeper', true),
    ('31111111-0000-0000-0000-000000000003', 'sponsor', 'Sponsor', 'Accept/reject demand within own portfolio', true),
    ('31111111-0000-0000-0000-000000000004', 'finance', 'Finance', 'Edit financials, manage investment', true),
    ('31111111-0000-0000-0000-000000000005', 'benefit_owner', 'Benefit Owner', 'Update benefit status, record KPI measurements', true),
    ('31111111-0000-0000-0000-000000000006', 'auditor', 'Auditor', 'Read-only across all entities plus audit_log', true),
    ('31111111-0000-0000-0000-000000000007', 'contributor', 'Contributor', 'Create/read own demand submissions', true);

-- ---------- Users ----------
INSERT INTO app_user (id, organization_id, email, display_name, role) VALUES
    ('41111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'r.okafor@acme-holdings.example', 'R. Okafor', 'finance'),
    ('41111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'l.ward@acme-holdings.example', 'L. Ward', 'sponsor'),
    ('41111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'n.iqbal@acme-holdings.example', 'N. Iqbal', 'contributor'),
    ('41111111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'h.barros@acme-holdings.example', 'H. Barros', 'contributor'),
    ('41111111-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'f.lindqvist@acme-holdings.example', 'F. Lindqvist', 'sponsor'),
    ('41111111-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a.rossi@acme-holdings.example', 'A. Rossi', 'sponsor'),
    ('41111111-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'p.yoon@acme-holdings.example', 'P. Yoon', 'contributor'),
    ('41111111-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'e.novak@acme-holdings.example', 'E. Novak', 'sponsor'),
    ('41111111-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'k.nilsson@acme-holdings.example', 'K. Nilsson', 'contributor'),
    ('41111111-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'd.patel@acme-holdings.example', 'D. Patel', 'contributor'),
    ('41111111-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'm.chen@acme-holdings.example', 'M. Chen', 'contributor'),
    ('41111111-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 's.ahmed@acme-holdings.example', 'S. Ahmed', 'benefit_owner'),
    ('41111111-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'j.osei@acme-holdings.example', 'J. Osei', 'finance'),
    ('41111111-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'g.adeyemi@acme-holdings.example', 'G. Adeyemi', 'finance'),
    ('41111111-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 't.brooks@acme-holdings.example', 'T. Brooks', 'benefit_owner'),
    ('41111111-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'admin@acme-holdings.example', 'System Admin', 'org_admin');

-- ---------- Strategic goals (2026, corporate, capped 5) ----------
INSERT INTO strategic_goal (id, organization_id, name, description, goal_year, declared_by, declared_at) VALUES
    ('51111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Grow Latin America market', 'Expand revenue and presence across LATAM territories', 2026, '41111111-0000-0000-0000-000000000016', '2026-01-14'),
    ('51111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Operational resilience', 'Reduce single points of failure across core operations', 2026, '41111111-0000-0000-0000-000000000016', '2026-01-14'),
    ('51111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Platform consolidation', 'Reduce legacy system count and integration overhead', 2026, '41111111-0000-0000-0000-000000000016', '2026-01-20');
-- Deliberately only 3 of 5 declared — mirrors the "2 open slots" mockup

-- ---------- Demand ----------
INSERT INTO demand (id, organization_id, portfolio_id, title, description, raised_by, raised_date, size_tier, status, adoption_change_type) VALUES
    ('61111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000005',
     'Regional forecast automation', 'Regional actuals are manually mapped against forecast monthly, missing ~8% of genuine anomalies.',
     '41111111-0000-0000-0000-000000000001', '2026-02-01', 'needs_case', 'promoted', 'tool'),

    ('61111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000001',
     'Field service mobile rollout', 'Field engineers rely on paper job sheets, causing delayed reporting and lost data.',
     '41111111-0000-0000-0000-000000000002', '2026-01-20', 'needs_case', 'promoted', 'both'),

    ('61111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000005',
     'Vendor onboarding portal', 'Vendor onboarding takes 6+ weeks via email chains and spreadsheets.',
     '41111111-0000-0000-0000-000000000003', '2025-11-05', 'needs_case', 'promoted', 'tool'),

    ('61111111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000006',
     'Legacy CRM decommission', 'Legacy CRM duplicates data held in the newer platform, doubling maintenance cost.',
     '41111111-0000-0000-0000-000000000004', '2026-03-10', 'needs_case', 'triaged', NULL),

    ('61111111-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000002',
     'Factory line telemetry pilot', 'No real-time visibility into line-level throughput or fault rates.',
     '41111111-0000-0000-0000-000000000005', '2026-04-02', 'unsized', 'raised', 'tool'),

    ('61111111-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000004',
     'International pricing engine', 'Regional pricing is set manually per market with no central rules engine.',
     '41111111-0000-0000-0000-000000000006', '2026-02-18', 'needs_case', 'triaged', 'tool'),

    ('61111111-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000003',
     'Sales enablement content hub', 'Reps can''t find current product collateral, defaulting to outdated decks.',
     '41111111-0000-0000-0000-000000000007', '2026-04-15', 'quick_win', 'raised', 'process'),

    ('61111111-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000002',
     'Warehouse safety sensors', 'Manual safety checks miss near-miss incidents between scheduled walkthroughs.',
     '41111111-0000-0000-0000-000000000008', '2025-12-01', 'needs_case', 'promoted', NULL),

    ('61111111-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000004',
     'Export documentation automation', 'Export paperwork is compiled manually per shipment, delaying customs clearance.',
     '41111111-0000-0000-0000-000000000009', '2025-10-14', 'needs_case', 'promoted', 'tool'),

    ('61111111-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000001',
     'Ops shift scheduling rework', 'Shift scheduling is done on whiteboards, causing coverage gaps.',
     '41111111-0000-0000-0000-000000000010', '2026-01-08', 'needs_case', 'promoted', 'process');

-- ---------- Success criteria (kpi_definition, tagged by dimension) ----------
INSERT INTO kpi_definition (id, demand_id, name, dimension, kpi_type, unit, baseline_value, target_value, owner_user_id) VALUES
    ('71111111-0000-0000-0000-000000000001', '61111111-0000-0000-0000-000000000001', 'Forecast accuracy', 'business', 'lagging', '%', 87, 94, '41111111-0000-0000-0000-000000000001'),
    ('71111111-0000-0000-0000-000000000002', '61111111-0000-0000-0000-000000000001', 'Regional team adoption', 'adoption', 'lagging', '%', 0, 80, '41111111-0000-0000-0000-000000000001'),
    ('71111111-0000-0000-0000-000000000003', '61111111-0000-0000-0000-000000000001', 'Delivery timeline', 'delivery', 'leading', 'months', 0, 6, '41111111-0000-0000-0000-000000000001'),

    ('71111111-0000-0000-0000-000000000004', '61111111-0000-0000-0000-000000000002', 'Mobile app adoption', 'adoption', 'lagging', '%', 0, 80, '41111111-0000-0000-0000-000000000002'),
    ('71111111-0000-0000-0000-000000000005', '61111111-0000-0000-0000-000000000002', 'Job completion time', 'business', 'lagging', 'hours', 4.5, 2.5, '41111111-0000-0000-0000-000000000002'),
    ('71111111-0000-0000-0000-000000000006', '61111111-0000-0000-0000-000000000002', 'Annual saving', 'financial', 'lagging', 'GBP', 0, 50000, '41111111-0000-0000-0000-000000000002');

-- ---------- Programmes (group one or more projects) ----------
INSERT INTO programme (id, organization_id, name, description, sponsor_user_id, status) VALUES
    ('c1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
     'Operational Resilience Programme', 'Reduces single points of failure across field and warehouse operations.',
     '41111111-0000-0000-0000-000000000002', 'active'),
    ('c1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
     'Finance Systems Modernisation', 'Consolidates manual finance and vendor processes onto shared tooling.',
     '41111111-0000-0000-0000-000000000001', 'active');
-- Deliberately only 2 programmes seeded, and 2 of the 5 business cases
-- (International pricing engine's demand, and Export documentation
-- automation) stay unassigned — mirrors the "no goal linked" pattern:
-- not every project needs to sit inside a programme.

INSERT INTO programme_goal_link (programme_id, strategic_goal_id) VALUES
    ('c1111111-0000-0000-0000-000000000001', '51111111-0000-0000-0000-000000000002');  -- Op Resilience Programme -> Operational resilience goal

-- ---------- Business cases (promoted demands only) ----------
INSERT INTO business_case (id, organization_id, portfolio_id, title, sponsor_user_id, submitted_by, requested_spend, decision, decision_date) VALUES
    ('81111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000005', 'Regional forecast automation', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000001', 120000, 'approved', '2026-02-20'),
    ('81111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000001', 'Field service mobile rollout', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000002', 340000, 'approved', '2026-02-05'),
    ('81111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000005', 'Vendor onboarding portal', '41111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000003', 65000, 'approved', '2025-11-25'),
    ('81111111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000002', 'Warehouse safety sensors', '41111111-0000-0000-0000-000000000008', '41111111-0000-0000-0000-000000000008', 45000, 'approved', '2025-12-15'),
    ('81111111-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '21111111-0000-0000-0000-000000000004', 'Export documentation automation', '41111111-0000-0000-0000-000000000006', '41111111-0000-0000-0000-000000000009', 90000, 'approved', '2025-10-30');

-- Assign two projects into the Operational Resilience Programme —
-- field service rollout (Operations) and warehouse safety sensors
-- (Manufacturing) span divisions but share the same programme, which is
-- exactly the case a programme layer exists for.
UPDATE business_case SET programme_id = 'c1111111-0000-0000-0000-000000000001'
    WHERE id IN ('81111111-0000-0000-0000-000000000002', '81111111-0000-0000-0000-000000000004');

-- Vendor onboarding portal sits in the Finance Systems programme alone for now
UPDATE business_case SET programme_id = 'c1111111-0000-0000-0000-000000000002'
    WHERE id = '81111111-0000-0000-0000-000000000003';

-- Link demand -> promoted business_case
UPDATE demand SET promoted_business_case_id = '81111111-0000-0000-0000-000000000001' WHERE id = '61111111-0000-0000-0000-000000000001';
UPDATE demand SET promoted_business_case_id = '81111111-0000-0000-0000-000000000002' WHERE id = '61111111-0000-0000-0000-000000000002';
UPDATE demand SET promoted_business_case_id = '81111111-0000-0000-0000-000000000003' WHERE id = '61111111-0000-0000-0000-000000000003';
UPDATE demand SET promoted_business_case_id = '81111111-0000-0000-0000-000000000004' WHERE id = '61111111-0000-0000-0000-000000000008';
UPDATE demand SET promoted_business_case_id = '81111111-0000-0000-0000-000000000005' WHERE id = '61111111-0000-0000-0000-000000000009';

-- ---------- RACI seats (5 named per business_case) ----------
INSERT INTO business_case_raci (business_case_id, accountable_financial_id, accountable_scope_id, accountable_schedule_id, sponsor_id, benefit_owner_id) VALUES
    ('81111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000003', '41111111-0000-0000-0000-000000000004', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000001'),
    ('81111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000001', '41111111-0000-0000-0000-000000000011', '41111111-0000-0000-0000-000000000010', '41111111-0000-0000-0000-000000000002', '41111111-0000-0000-0000-000000000012');

-- ---------- Strategic goal links (optional, opportunistic) ----------
INSERT INTO business_case_goal_link (business_case_id, strategic_goal_id) VALUES
    ('81111111-0000-0000-0000-000000000001', '51111111-0000-0000-0000-000000000001'),  -- forecast automation -> Grow LATAM
    ('81111111-0000-0000-0000-000000000002', '51111111-0000-0000-0000-000000000002'),  -- field service -> Operational resilience
    ('81111111-0000-0000-0000-000000000004', '51111111-0000-0000-0000-000000000002');  -- warehouse safety -> Operational resilience
-- Note: Vendor onboarding portal and Export docs automation deliberately
-- have NO goal link — mirrors the "no goal linked" state in the mockups.

-- ---------- Investment (approved vs actual spend) ----------
INSERT INTO investment (business_case_id, approved_amount, actual_spend_to_date) VALUES
    ('81111111-0000-0000-0000-000000000001', 120000, 95000),
    ('81111111-0000-0000-0000-000000000002', 340000, 310000),   -- close to tripping cost/benefit flag
    ('81111111-0000-0000-0000-000000000003', 65000, 60000),
    ('81111111-0000-0000-0000-000000000004', 45000, 40000),
    ('81111111-0000-0000-0000-000000000005', 90000, 88000);

-- ---------- Cost-to-benefit flag (mirrors the "flagged" mockup rows) ----------
INSERT INTO cost_benefit_flag (business_case_id, remaining_spend, remaining_benefit, confidence, status) VALUES
    ('81111111-0000-0000-0000-000000000002', 30000, 18000, 'medium', 'standing');

-- ---------- Adoption measurement + one sample survey question ----------
INSERT INTO adoption_measurement (id, business_case_id, change_type, measurement_method) VALUES
    ('91111111-0000-0000-0000-000000000001', '81111111-0000-0000-0000-000000000002', 'both', 'telemetry');

INSERT INTO adoption_survey_question (adoption_measurement_id, ai_drafted_text, confirmed_text, confirmed_by, changed_from_baseline) VALUES
    ('91111111-0000-0000-0000-000000000001',
     'Since the mobile app rollout, how often do you use it to log completed jobs?',
     'Since the mobile app rollout, how often do you use it to log completed jobs?',
     '41111111-0000-0000-0000-000000000002', false);

-- ---------- Realisation checks (criteria_match equivalent) ----------
INSERT INTO realization_check (benefit_id, scheduled_date, performed_date, performed_by, actual_value, outcome, outcome_classification, attribution_confidence)
SELECT b.id, '2026-08-01', '2026-08-05', '41111111-0000-0000-0000-000000000003', 55000, 'realized', 'met', 'direct'
FROM benefit b WHERE b.business_case_id = '81111111-0000-0000-0000-000000000003' LIMIT 1;
-- Note: `benefit` rows aren't seeded above in bulk — add a couple manually
-- if you want more realization_check examples; this shows the pattern.

INSERT INTO benefit (id, business_case_id, title, benefit_type, claimed_value, owner_user_id, status)
VALUES ('a1111111-0000-0000-0000-000000000001', '81111111-0000-0000-0000-000000000003', 'Onboarding time reduction', 'efficiency_hours', 32000, '41111111-0000-0000-0000-000000000003', 'realized');

-- ============================================================
-- After loading: sanity-check counts
-- SELECT 'organization' t, count(*) FROM organization
-- UNION ALL SELECT 'demand', count(*) FROM demand
-- UNION ALL SELECT 'business_case', count(*) FROM business_case
-- UNION ALL SELECT 'programme', count(*) FROM programme
-- UNION ALL SELECT 'strategic_goal', count(*) FROM strategic_goal
-- UNION ALL SELECT 'app_user', count(*) FROM app_user;
--
-- Check the programme rollup renders sensibly:
-- SELECT * FROM programme_rollup;
-- ============================================================
