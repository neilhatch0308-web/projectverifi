-- ============================================================
-- 33_unify_stop_status.sql
--
-- Consolidates 'rejected' and 'stopped' into a single status: 'stopped'.
--
-- The two-word split (rejected at triage / stopped after assessment)
-- was a deliberate distinction earlier in the build, but in practice
-- "rejected" reads as a harder, more final word than the reality often
-- is - a demand not taken forward now may still be a good idea, just
-- not the right time, not yet resourced, or superseded by something
-- else. "Stopped" carries that more honestly, and the WHY belongs in
-- the reason/narrative, not in which of two status words was used.
--
-- This also fixes a real gap: 'rejected' was only reachable from
-- 'raised' via triage. A demand already accepted or assessed had no
-- path back to a kill state except the narrower 'stopped' meaning
-- ("economics collapsed"). Now a single Stop action is available from
-- any of raised / accepted / assessed - the WHY is what varies, not
-- which status field gets set.
--
-- Dedicated audit columns replace the previous behaviour of appending
-- a stop reason onto triage_notes (a field that's really about triage
-- sizing, not about why something stopped).
-- ============================================================

ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS stop_reason  TEXT,
    ADD COLUMN IF NOT EXISTS stopped_by   UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS stopped_at   TIMESTAMPTZ;

COMMENT ON COLUMN demand.stop_reason IS 'Why this demand stopped moving forward - may be "not the right time" as easily as "not viable." Required whenever status is set to stopped.';

-- Migrate existing 'rejected' rows, carrying over whatever triage audit
-- trail already exists so nothing is lost - just relabelled.
UPDATE demand
SET status = 'stopped',
    stop_reason = COALESCE(triage_notes, 'Not taken forward at triage (migrated from "rejected")'),
    stopped_by = triaged_by,
    stopped_at = triaged_at
WHERE status = 'rejected';
