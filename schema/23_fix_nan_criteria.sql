-- ============================================================
-- 23_fix_nan_criteria.sql
--
-- Postgres's numeric type accepts the literal value NaN (unlike most
-- databases). Before validation was tightened, typing something like
-- "42 days" into a baseline/target field produced Number("42 days") =
-- NaN in JavaScript, which the pg driver happily bound and Postgres
-- happily stored as the literal NaN - no error at insert, just a
-- silently corrupted value that then displayed as the text "NaN" on
-- the detail page.
--
-- This finds and nulls out any such rows. NULL is the correct state for
-- "no baseline/target value was really given" - which is what actually
-- happened here, since the words typed were never a real number.
-- ============================================================

UPDATE kpi_definition
SET baseline_value = NULL
WHERE baseline_value::text = 'NaN';

UPDATE kpi_definition
SET target_value = NULL
WHERE target_value::text = 'NaN';