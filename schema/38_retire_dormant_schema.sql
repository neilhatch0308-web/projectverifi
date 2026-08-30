-- ============================================================
-- 38_retire_dormant_schema.sql
--
-- Drops every table/view confirmed dormant in DATABASE_SCHEMA_
-- REFERENCE.md (verified against real route usage, not guessed) -
-- mostly the original pre-RPVF benefits-tracker build, still
-- physically present but never touched by any route. Also drops dead
-- columns on LIVE tables (superseded fields that were never cleaned
-- up when their replacement landed) and one genuinely dead index.
--
-- TWO ITEMS DELIBERATELY KEPT, NOT DROPPED - flagging rather than
-- silently deciding for you:
--   - subportfolio_cost_breakdown and uncategorised_demand_by_portfolio
--     (views, migration 28) are dormant but describe real, still-useful
--     capability - the v0.8 framework doc talks about them as if live.
--     They're cheap to keep and easy to wire up later. If you want them
--     gone too, add two DROP VIEW lines - the exact CREATE VIEW SQL is
--     in schema/28_portfolio_hierarchy.sql if you ever want them back.
--
-- Paired code change: demand.size_tier is dropped here, so
-- server/src/routes/demand.ts's INSERT statement needs the
-- corresponding edit removing it (see accompanying diff/README) -
-- apply that BEFORE this migration, or the app will error on the next
-- demand raise until both land together.
-- ============================================================

-- ---------- Dormant tables: Delivery/Adoption/Realisation stages ----------
-- (already flagged as schema-only in HANDOFF.md)
-- adoption_survey_question BEFORE adoption_measurement - it references
-- adoption_measurement(id), same ordering rule as everywhere else in
-- this file.
DROP TABLE IF EXISTS project_delivery;
DROP TABLE IF EXISTS kpi_measurement;
DROP TABLE IF EXISTS adoption_survey_question;
DROP TABLE IF EXISTS adoption_measurement;
DROP TABLE IF EXISTS outcome_questionnaire;
DROP TABLE IF EXISTS realization_check;
DROP TABLE IF EXISTS dis_benefit;
DROP TABLE IF EXISTS cost_benefit_flag;
DROP TABLE IF EXISTS benefit_owner_handover;
DROP TABLE IF EXISTS dimension_weighting;
DROP TABLE IF EXISTS kpi_definition_revision;

-- ---------- Dormant tables: old demand-idea-management scaffold ----------
DROP TABLE IF EXISTS demand_owner;
DROP TABLE IF EXISTS demand_action;
DROP TABLE IF EXISTS demand_link;
DROP TABLE IF EXISTS demand_raise_event;
DROP TABLE IF EXISTS demand_duplicate_prompt;
DROP TABLE IF EXISTS ai_similarity_check;

-- ---------- Dormant tables: deprecated, explicitly noted in HANDOFF.md ----------
-- demand_strategy_link FIRST - it references strategy_objective(id),
-- so dropping the parent first would fail the same way role/
-- app_user_role did in migration 36.
DROP TABLE IF EXISTS demand_strategy_link;
DROP TABLE IF EXISTS strategy_objective;
DROP TABLE IF EXISTS business_case_raci;

-- ---------- Dormant tables: old generic RBAC/workflow scaffold ----------
-- (predates the RPVF-specific stage gates actually built)
DROP TABLE IF EXISTS stage_approval_reason;
DROP TABLE IF EXISTS stage_approval;
DROP TABLE IF EXISTS decision_reason;
DROP TABLE IF EXISTS workflow_stage;

-- ---------- Dead columns on demand: superseded, unused ----------
-- (next_review_date/review_trigger genuinely could be useful for
-- "resurface a stopped idea later" - dropped anyway since nothing
-- reads them today; re-add properly with real UI if that gets built)
ALTER TABLE demand
    DROP COLUMN IF EXISTS estimated_cost,
    DROP COLUMN IF EXISTS benefit_hypothesis,
    DROP COLUMN IF EXISTS next_review_date,
    DROP COLUMN IF EXISTS review_trigger,
    DROP COLUMN IF EXISTS promoted_business_case_id,
    DROP COLUMN IF EXISTS resolution_notes,
    DROP COLUMN IF EXISTS size_tier;   -- pair with the demand.ts code edit - see header

-- ---------- Dead columns on business_case: superseded, unused ----------
-- MUST run before dropping the programme table below - business_case.
-- programme_id holds the foreign key TO programme, so the table can't
-- go until this column (and its FK) is gone first. Same class of
-- ordering mistake as the strategy_objective one above - caught here
-- before it could repeat.
ALTER TABLE business_case
    DROP COLUMN IF EXISTS summary,          -- superseded by executive_summary
    DROP COLUMN IF EXISTS source_doc_url,
    DROP COLUMN IF EXISTS sensitivity_level, -- from the same dead RBAC design retired in migration 36
    DROP COLUMN IF EXISTS programme_id;

-- ---------- Dormant tables: programme layer, never adopted ----------
-- Now safe - both FKs into programme (programme_goal_link and
-- business_case.programme_id) are gone.
DROP TABLE IF EXISTS programme_goal_link;
DROP TABLE IF EXISTS programme;

-- ---------- Dormant tables: other ----------
DROP TABLE IF EXISTS benefit_link;
DROP TABLE IF EXISTS business_case_goal_link;
DROP TABLE IF EXISTS audit_log;

-- ---------- Dormant views (excluding the two kept above) ----------
DROP VIEW IF EXISTS adoption_perception_reality_gap;
DROP VIEW IF EXISTS portfolio_value_by_goal;
DROP VIEW IF EXISTS portfolio_value_by_division;
DROP VIEW IF EXISTS outcome_class_distribution;
DROP VIEW IF EXISTS programme_rollup;
DROP VIEW IF EXISTS programme_outcome_distribution;

-- ---------- Dead index: on a column dropped back in migration 03 ----------
DROP INDEX IF EXISTS idx_demand_priority;

-- ---------- Stale column comments, corrected to match reality ----------
COMMENT ON COLUMN demand.status IS 'Live values: raised | accepted | assessed | promoted | stopped.';
COMMENT ON COLUMN business_case.decision IS 'Live values: approved | declined only (set via POST /business-cases/:id/decision).';
