-- 43_clean_stale_agreed_fields.sql
--
-- Migration 40 corrected the Annual Plan lifecycle (Draft -> Locked ->
-- Agreed, not the reverse order first documented). Rows created under
-- the OLD lifecycle -- where Agree was the first heavy step -- can
-- still carry agreed_by/agreed_at from that era even though their
-- status now reads 'draft' or 'locked' under the corrected model.
-- That produces a real, visible contradiction: a plan badged DRAFT
-- while its detail text says "agreed by X on <date>".
--
-- agreed_by/agreed_at should only ever be non-null when status =
-- 'agreed'. This clears the stale pair everywhere else. Locked_by/
-- locked_at are untouched -- those are legitimately independent of
-- status under the corrected model (a plan can be Draft again after
-- an Unlock while still correctly retaining who last locked it).

BEGIN;

UPDATE annual_plan
SET agreed_by = NULL,
    agreed_at = NULL
WHERE status <> 'agreed'
  AND (agreed_by IS NOT NULL OR agreed_at IS NOT NULL);

COMMIT;
