-- 53_delivery_detail.sql
--
-- Migration 52 shipped delivery tracking as pure attestation: who
-- confirmed each milestone, and when -- the "when" being whatever
-- now() was at the moment someone clicked Record, not a date anyone
-- actually chose. That's not enough to make the anchored-claim story
-- checkable: there was no permanent baseline to measure delivery
-- against, no actual cost, no adoption measure beyond free text, and
-- no benefit figure at all -- so "did the promised value show up"
-- had nothing to compare to.
--
-- This migration adds the minimum needed to close that gap, without
-- changing the four-milestone sequence or the one-way/no-unset rule
-- from migration 52. Two categories of addition:
--
-- 1. Genuinely new inputs, entered once at the milestone they belong
--    to, immutable after (matching claimed_cost/claimed_benefit on
--    demand and baseline_amount on portfolio_budget):
--      - planned_end_date, entered at Delivery Started alongside the
--        existing delivery_started_at. This is the real, permanent
--        baseline -- deliberately NOT inferred from demand.need_by_date,
--        since an inferred snapshot isn't a commitment anyone actually
--        made. Once set, no route ever updates it.
--      - actual_cost, entered at Delivery Completed.
--      - adoption_level, entered at Adoption Measured -- a fixed
--        three-value scale (not_adopted/partial/full) rather than a
--        raw percentage, matching this framework's existing preference
--        for tiered classification (complexity_tier, cost_tier,
--        assessment confidence) over open numbers that invite false
--        precision.
--      - actual_benefit_value and benefit_attribution_confidence,
--        entered at Benefit Realised. Attribution confidence is
--        mandatory here, no opt-out, matching the existing rule that
--        every financial claim in this system carries one.
--
-- 2. Nothing stored for comparison values that already exist
--    elsewhere and can be read live -- "needed by" (demand.need_by_date),
--    "signed-off budget" (investment.approved_amount), and "claimed
--    business case benefit" (sum of benefit.claimed_value) are joined
--    at read time in the API layer, not duplicated onto this table.
--    Same for the two variance figures (delivery date vs. planned end
--    date; actual benefit vs. claimed benefit) -- both are computed
--    from already-immutable inputs, so deriving them on every read
--    costs nothing and can never drift out of sync. This is the same
--    "derive rather than duplicate" instinct already named as a
--    recurring, load-bearing pattern (decision 66, decision 75).
--
-- Deliberately NOT enforced as DB-level CHECK constraints requiring
-- these new columns whenever their milestone's *_at column is set:
-- migration 52 has already been live in production, and existing rows
-- may have delivery_completed_at (etc.) set with no actual_cost behind
-- it, recorded before this migration existed. A CHECK constraint
-- requiring the pairing would break on those rows the moment this
-- migration runs. Required-ness for new records is enforced at the
-- application layer (the advance route) going forward instead --
-- consistent with "retire without deleting" and with the lesson from
-- this same project's migration-46 gap: never assume a constraint is
-- safe against data that already exists in production.

BEGIN;

ALTER TABLE demand_delivery
  ADD COLUMN planned_end_date            DATE,
  ADD COLUMN actual_cost                 NUMERIC(14,2),
  ADD COLUMN adoption_level              TEXT CHECK (adoption_level IN ('not_adopted', 'partial', 'full')),
  ADD COLUMN actual_benefit_value        NUMERIC(14,2),
  ADD COLUMN benefit_attribution_confidence TEXT CHECK (benefit_attribution_confidence IN ('low', 'medium', 'high'));

COMMENT ON COLUMN demand_delivery.planned_end_date IS
  'Entered once, at Delivery Started, alongside delivery_started_at. Permanently immutable -- no update route exists for this column at all, matching claimed_cost/claimed_benefit on demand and baseline_amount on portfolio_budget. This is the baseline date_variance_days (computed at read time) measures against -- deliberately a real commitment entered by the person starting delivery, not inferred from demand.need_by_date.';
COMMENT ON COLUMN demand_delivery.actual_cost IS
  'Entered once, at Delivery Completed. Compared at read time against the business case''s signed-off budget (investment.approved_amount), which is read live via join, not duplicated here.';
COMMENT ON COLUMN demand_delivery.adoption_level IS
  'Entered once, at Adoption Measured. Fixed three-value scale rather than a raw percentage -- coarse by design, matching complexity_tier/cost_tier elsewhere in this schema.';
COMMENT ON COLUMN demand_delivery.actual_benefit_value IS
  'Entered once, at Benefit Realised. The figure the anchored-claim chain was missing: P50 (demand.claimed_benefit) -> P75 (demand_assessment.assessed_benefit) -> claimed at business case (sum of benefit.claimed_value) -> this. Compared at read time against the business case''s claimed benefit total, read live via join, not duplicated here.';
COMMENT ON COLUMN demand_delivery.benefit_attribution_confidence IS
  'Mandatory alongside actual_benefit_value, no opt-out -- matches the existing rule that every financial claim in this system carries an attribution confidence.';

COMMIT;
