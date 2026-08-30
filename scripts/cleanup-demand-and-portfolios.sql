-- ============================================================
-- cleanup-demand-and-portfolios.sql
--
-- Wipes ALL demand (every status), ALL portfolios and sub-portfolios,
-- and ALL budgets/transfers/adjustments/plans tied to them - a full
-- reset so you can build a clean demand and portfolio set-up via the
-- UI. Does NOT touch: organization, app_user, roles/permissions,
-- strategic goals, governance tiers, scoring criteria. Those are your
-- org's standing configuration, not per-portfolio/per-demand data.
--
-- ORDER MATTERS - and this went through three corrections before
-- landing here, each caught by an actual failed run rather than
-- assumed away:
--   1. adoption_survey_question references adoption_measurement(id) -
--      missing from the first version entirely.
--   2. demand.promoted_business_case_id and business_case.demand_id
--      form a genuine CIRCULAR reference - each table holds a live FK
--      into the other. Neither can be deleted first. Broken below with
--      an explicit UPDATE that nulls the dormant side of the cycle
--      before either table is touched.
--   3. portfolio_budget_transfer.related_demand_id also points at
--      demand - it was scheduled AFTER the demand delete, backwards.
--      Moved earlier.
--
-- Every "REFERENCES demand(id)" and "REFERENCES business_case(id)"
-- in the schema has now been individually re-verified against this
-- exact ordering, not just spot-checked.
--
-- THIS IS IRREVERSIBLE. Run inside a transaction (already wrapped
-- below) so a mistake rolls back cleanly rather than partially
-- applying. Row counts print before and after so you can see exactly
-- what happened.
-- ============================================================

SELECT set_config('app.current_org', '11111111-1111-1111-1111-111111111111', false);

BEGIN;

-- ---------- Before counts, for the record ----------
SELECT 'BEFORE' AS stage, 'demand' AS table_name, COUNT(*) FROM demand
UNION ALL SELECT 'BEFORE', 'business_case', COUNT(*) FROM business_case
UNION ALL SELECT 'BEFORE', 'portfolio', COUNT(*) FROM portfolio
UNION ALL SELECT 'BEFORE', 'portfolio_budget', COUNT(*) FROM portfolio_budget;

-- ---------- Step 0: break the demand <-> business_case cycle ----------
-- demand.promoted_business_case_id is the DORMANT direction (nothing
-- in the live app reads or writes it - the real link is business_case.
-- demand_id, the other way round). Safe to null out unconditionally.
UPDATE demand SET promoted_business_case_id = NULL WHERE promoted_business_case_id IS NOT NULL;

-- ---------- Tier 1: dormant tables with real FK constraints on
-- demand / business_case / benefit / kpi_definition. Confirmed NOT
-- always empty in practice. ----------
DELETE FROM demand_raise_event;
DELETE FROM demand_link;
DELETE FROM demand_strategy_link;
DELETE FROM demand_owner;
DELETE FROM demand_duplicate_prompt;
DELETE FROM demand_action;
DELETE FROM project_delivery;
DELETE FROM business_case_goal_link;
DELETE FROM business_case_raci;
DELETE FROM cost_benefit_flag;
DELETE FROM dis_benefit;
DELETE FROM adoption_survey_question;   -- MUST precede adoption_measurement - references it
DELETE FROM adoption_measurement;
DELETE FROM outcome_questionnaire;
DELETE FROM benefit_link;
DELETE FROM realization_check;
DELETE FROM benefit_owner_handover;
DELETE FROM kpi_measurement;
DELETE FROM kpi_definition_revision;

-- ---------- Tier 2: live tables referencing demand, business_case,
-- benefit, or annual_plan ----------
DELETE FROM demand_score;
DELETE FROM demand_raci;
DELETE FROM demand_assessment;
DELETE FROM demand_goal_link;
DELETE FROM demand_portfolio_assignment_history;
DELETE FROM demand_raising_portfolio_reassignment;
DELETE FROM annual_plan_item;         -- references BOTH demand and annual_plan
DELETE FROM kpi_definition;           -- references demand, business_case, AND benefit
DELETE FROM business_case_risk;
DELETE FROM finance_impact_assessment;
DELETE FROM investment;
DELETE FROM benefit;
DELETE FROM portfolio_budget_transfer;   -- MUST precede demand delete - related_demand_id references it

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
UNION ALL SELECT 'AFTER', 'portfolio_budget', COUNT(*) FROM portfolio_budget;

-- Review the output above. If everything reads 0 in the AFTER block,
-- run COMMIT. If anything looks wrong, run ROLLBACK instead - nothing
-- is permanent until you explicitly commit.
--
-- COMMIT;