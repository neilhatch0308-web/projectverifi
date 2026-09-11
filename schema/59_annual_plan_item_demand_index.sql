-- 59_annual_plan_item_demand_index.sql
--
-- Gap found while reviewing scaling risk on the audit trail (migration
-- 55): every other table demand_audit_trail reads from is indexed on
-- demand_id. annual_plan_item is not. It has a composite UNIQUE
-- (plan_id, demand_id) constraint (migration 29), which Postgres backs
-- with a composite index -- but a composite index can only be used for
-- a lookup on its LEADING column (plan_id) or both columns together.
-- A query filtering by demand_id alone -- exactly what
-- demand_audit_trail's annual_plan_placement branch does, once the
-- calling route adds WHERE demand_id = $1 -- cannot use it, and falls
-- back to a sequential scan of the whole table.
--
-- Invisible today at low row counts. Left uncorrected, this is the
-- specific query that gets slow first as Annual Planning accumulates
-- history across more years and portfolios -- worth fixing now, while
-- it costs nothing, rather than once it shows up as a slow endpoint.

CREATE INDEX IF NOT EXISTS idx_plan_item_demand ON annual_plan_item(demand_id);
