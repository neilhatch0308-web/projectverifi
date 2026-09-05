-- 49_benefit_recurrence.sql
--
-- A single claimed_value has been ambiguous about what KIND of figure
-- it is: a one-time saving, an annual recurring rate, or a lump sum
-- meant to be realized progressively over several years all look
-- identical in the data today, and summing them together (as the
-- Business Case cost-to-benefit read already does) silently blends
-- incompatible time horizons into one meaningless total.
--
-- Existing rows are left NULL (unclassified) deliberately -- not
-- defaulted to one_time -- since guessing the shape of a benefit
-- already claimed under the old flat model would be exactly the kind
-- of silent assumption this framework avoids elsewhere. Someone with
-- business_case.edit needs to actually look at each one and classify
-- it via the new PATCH endpoint.

BEGIN;

ALTER TABLE benefit
  ADD COLUMN recurrence TEXT CHECK (recurrence IN ('one_time', 'annual', 'multi_year_lump_sum')),
  ADD COLUMN duration_years INT CHECK (duration_years > 0);

-- Enforce the same shape rule the API validates, at the DB level too:
-- one_time has no duration; annual and multi_year_lump_sum both
-- require one (annual: the number of years the per-year rate is
-- expected to recur; multi_year_lump_sum: the period the stated total
-- is realized over, purely descriptive -- NOT multiplied, unlike the
-- annual case). NULL (unclassified) is left unconstrained on purpose.
ALTER TABLE benefit
  ADD CONSTRAINT benefit_duration_matches_recurrence CHECK (
    recurrence IS NULL
    OR (recurrence = 'one_time' AND duration_years IS NULL)
    OR (recurrence IN ('annual', 'multi_year_lump_sum') AND duration_years IS NOT NULL)
  );

COMMENT ON COLUMN benefit.recurrence IS
  'How this claimed figure is shaped over time. one_time: a single flat amount. annual: claimed_value is the PER-YEAR rate, recurring for duration_years. multi_year_lump_sum: claimed_value is already a total, realized progressively over duration_years (not multiplied). NULL means not yet classified -- true for every row that existed before this migration.';
COMMENT ON COLUMN benefit.duration_years IS
  'Required for annual and multi_year_lump_sum, NULL for one_time. Multiplies against claimed_value for annual (to get a total-over-period); purely descriptive context for multi_year_lump_sum, where claimed_value is already the total.';

COMMIT;
