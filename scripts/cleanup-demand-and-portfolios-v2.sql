-- ============================================================
-- cleanup-demand-and-portfolios.sql (v2)
--
-- Wipes ALL demand (every status), ALL portfolios and sub-portfolios,
-- and ALL budgets/transfers/adjustments/plans/audit-history tied to
-- them - a full reset so you can build a clean demand and portfolio
-- set-up via the UI. Does NOT touch: organization, app_user,
-- roles/permissions, strategic goals, governance tiers, scoring
-- criteria. Those are your org's standing configuration, not
-- per-portfolio/per-demand data.
--
-- WHAT CHANGED IN v2 - found by auditing the original against every
-- REFERENCES demand(id)/business_case(id)/kpi_definition(id) in the
-- schema, not just the tables it happened to already know about:
--
--   Missing entirely, all with hard FK constraints that would have
--   made the original script FAIL partway through (transaction-safe,
--   so no partial damage - but it would not have completed):
--     - kpi_outcome, kpi_outcome_revision (FK -> kpi_definition, which
--       the original deletes - WILL fail here if even one outcome has
--       been recorded)
--     - business_case_revision (FK -> business_case, which the
--       original deletes - WILL fail here given the revision testing
--       already done this session)
--     - demand_delivery, demand_dependency, demand_target_year_reassignment,
--       form_draft, demand_confidential_viewer,
--       demand_confidential_viewer_revocation, demand_confidential_access_log,
--       demand_field_revision, demand_score_revision - all FK -> demand
--
--   Also unresolved by file inspection alone: several tables the
--   original explicitly deletes from (adoption_measurement,
--   kpi_measurement, project_delivery, dis_benefit, cost_benefit_flag,
--   benefit_owner_handover, kpi_definition_revision, demand_owner,
--   demand_action, demand_link, demand_raise_event,
--   demand_duplicate_prompt, business_case_raci, benefit_link,
--   business_case_goal_link, realization_check, outcome_questionnaire,
--   adoption_survey_question) were supposed to be DROPPED entirely by
--   migration 38. Whether that actually ran against every real
--   environment can't be confirmed from the schema files alone - only
--   from the live database. Rather than guess either way, v2 checks
--   for existence before touching ANYTHING, table by table.
--
-- This is now a DEFENSIVE, ORDER-DRIVEN script: each table is only
-- touched if to_regclass() confirms it currently exists, via a DO
-- block that walks an explicit dependency-safe list. This means it
-- stays correct as the schema keeps evolving (new audit/history
-- tables like migration 63's kpi_outcome won't silently break a future
-- run the way the original script's fixed, manually-maintained list
-- eventually would) - you add a name to the list below when a new
-- demand/business-case-linked table is built, not re-derive the whole
-- ordering from scratch.
--
-- THIS IS IRREVERSIBLE. Run inside a transaction (already wrapped
-- below) so a mistake rolls back cleanly rather than partially
-- applying. Row counts print before and after so you can see exactly
-- what happened. COMMIT is commented out at the end on purpose -
-- review the AFTER counts, then run it yourself.
-- ============================================================

SELECT set_config('app.current_org', '11111111-1111-1111-1111-111111111111', false);

BEGIN;

-- ---------- Before counts, for the record ----------
SELECT 'BEFORE' AS stage, 'demand' AS table_name, COUNT(*) FROM demand
UNION ALL SELECT 'BEFORE', 'business_case', COUNT(*) FROM business_case
UNION ALL SELECT 'BEFORE', 'portfolio', COUNT(*) FROM portfolio
UNION ALL SELECT 'BEFORE', 'portfolio_budget', COUNT(*) FROM portfolio_budget
UNION ALL SELECT 'BEFORE', 'kpi_outcome', COUNT(*) FROM kpi_outcome
UNION ALL SELECT 'BEFORE', 'demand_delivery', COUNT(*) FROM demand_delivery;

-- ---------- Step 0: break the demand <-> business_case cycle ----------
-- demand.promoted_business_case_id is the DORMANT direction (nothing
-- in the live app reads or writes it - the real link is business_case.
-- demand_id, the other way round). Safe to null out unconditionally.
UPDATE demand SET promoted_business_case_id = NULL WHERE promoted_business_case_id IS NOT NULL;

-- ---------- Defensive, dependency-ordered wipe ----------
-- Each entry only runs if the table currently exists. Order matters -
-- every table here is listed AFTER anything that references it and
-- BEFORE anything it itself references, so this can run top-to-bottom
-- with no FK violations regardless of which pre-RPVF scaffold tables
-- happen to still exist in this particular environment.
DO $$
DECLARE
    tbl TEXT;
    tables_in_order TEXT[] := ARRAY[
        -- Tier 0: dead pre-RPVF scaffold (may or may not still exist -
        -- migration 38 was supposed to drop these; checked, not assumed)
        'demand_raise_event', 'demand_link', 'demand_strategy_link', 'demand_owner',
        'demand_duplicate_prompt', 'demand_action', 'project_delivery',
        'business_case_goal_link', 'business_case_raci', 'cost_benefit_flag',
        'dis_benefit', 'adoption_survey_question', 'adoption_measurement',
        'outcome_questionnaire', 'benefit_link', 'realization_check',
        'benefit_owner_handover', 'kpi_measurement', 'kpi_definition_revision',

        -- Tier 1: audit/history/tracking tables added since (all FK -> demand,
        -- kpi_definition, or business_case - must go before their parents)
        'kpi_outcome_revision', 'kpi_outcome',
        'business_case_revision',
        'demand_confidential_viewer_revocation', 'demand_confidential_access_log',
        'demand_confidential_viewer',
        'demand_field_revision', 'demand_score_revision',
        'demand_target_year_reassignment', 'demand_dependency',
        'form_draft', 'demand_delivery',

        -- Tier 2: live tables referencing demand, business_case, benefit,
        -- kpi_definition, or annual_plan
        'demand_score', 'demand_raci', 'demand_assessment', 'demand_goal_link',
        'demand_portfolio_assignment_history', 'demand_raising_portfolio_reassignment',
        'annual_plan_item',      -- references BOTH demand and annual_plan
        'kpi_definition',        -- references demand, business_case, AND benefit
        'business_case_risk', 'finance_impact_assessment', 'investment', 'benefit',
        'portfolio_budget_transfer'  -- MUST precede demand delete - related_demand_id references it
    ];
BEGIN
    FOREACH tbl IN ARRAY tables_in_order LOOP
        IF to_regclass('public.' || tbl) IS NOT NULL THEN
            EXECUTE format('DELETE FROM %I', tbl);
            RAISE NOTICE 'Cleared %', tbl;
        ELSE
            RAISE NOTICE 'Skipped % (does not exist in this database)', tbl;
        END IF;
    END LOOP;
END $$;

-- ---------- Tier 3: business_case and annual_plan are now safe ----------
DELETE FROM business_case;
DELETE FROM annual_plan;

-- ---------- Tier 4: demand is now safe (all children, business_case,
-- and portfolio_budget_transfer cleared) ----------
DELETE FROM demand;

-- ---------- Tier 5: remaining portfolio-level budget tables ----------
DELETE FROM portfolio_budget;
DELETE FROM portfolio_budget_adjustment;

-- ---------- Tier 6: portfolio itself - sub-portfolios before parents,
-- since portfolio.parent_portfolio_id is self-referential ----------
DELETE FROM portfolio WHERE parent_portfolio_id IS NOT NULL;
DELETE FROM portfolio WHERE parent_portfolio_id IS NULL;

-- ---------- After counts ----------
SELECT 'AFTER' AS stage, 'demand' AS table_name, COUNT(*) FROM demand
UNION ALL SELECT 'AFTER', 'business_case', COUNT(*) FROM business_case
UNION ALL SELECT 'AFTER', 'portfolio', COUNT(*) FROM portfolio
UNION ALL SELECT 'AFTER', 'portfolio_budget', COUNT(*) FROM portfolio_budget
UNION ALL SELECT 'AFTER', 'kpi_outcome', COUNT(*) FROM kpi_outcome
UNION ALL SELECT 'AFTER', 'demand_delivery', COUNT(*) FROM demand_delivery;

-- Review the NOTICEs and the output above. If everything reads 0 in
-- the AFTER block, run COMMIT. If anything looks wrong, run ROLLBACK
-- instead - nothing is permanent until you explicitly commit.
--
-- COMMIT;
