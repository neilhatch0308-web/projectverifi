-- ============================================================
-- 20_consolidate_strategy_tables.sql
--
-- Retires strategy_objective / demand_strategy_link as the thing new
-- demands link against. They came from the original build
-- (03_demand_scoring_matrix.sql) and overlapped, unintentionally, with
-- strategic_goal - the fully governed version (capped 5/year, locked
-- once declared, lifecycle-managed) built later against the RPVF
-- framework doc. Going forward, a demand links to strategic_goal only.
--
-- Deliberately NOT dropping strategy_objective or demand_strategy_link -
-- any rows already written there stay as an audit trail of what existed
-- during the period both tables were live. New code just stops writing
-- to them.
--
-- New link table: demand_goal_link, mirroring demand_strategy_link's
-- shape but pointing at strategic_goal. Same optional, opportunistic
-- pattern as before - a demand can link to zero or one goal.
-- ============================================================

CREATE TABLE IF NOT EXISTS demand_goal_link (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demand_id           UUID NOT NULL UNIQUE REFERENCES demand(id),
    strategic_goal_id   UUID NOT NULL REFERENCES strategic_goal(id),
    alignment_notes     TEXT,
    linked_by           UUID REFERENCES app_user(id),
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demand_goal_link_demand ON demand_goal_link(demand_id);

COMMENT ON TABLE strategy_objective IS 'DEPRECATED as of 20_consolidate_strategy_tables.sql - superseded by strategic_goal. Rows preserved for audit only; do not write new data here.';
COMMENT ON TABLE demand_strategy_link IS 'DEPRECATED as of 20_consolidate_strategy_tables.sql - superseded by demand_goal_link. Rows preserved for audit only; do not write new data here.';
