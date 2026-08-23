-- ============================================================
-- 18_triage_decision.sql
--
-- Renames the triage decision outcome from 'triaged' to 'accepted' -
-- matching the real business process labels (Accepted / Rejected),
-- rather than the placeholder 'triaged' status this build started with.
-- 'promoted' is unchanged and stays reserved for after RACI naming -
-- a separate, later step, deliberately not built out further this pass.
--
-- Adds complexity_tier and cost_tier - the assessment PMO/portfolio
-- leads make AT the point of the accept/reject decision, not before.
-- Both are required by the app layer on that transition; nullable in
-- the DB since a demand sitting at 'raised' hasn't been assessed yet.
--
-- Deliberately deferred (per direction - human process before AI):
--   - duplicate / in-flight detection surfaced to the triage reviewer
--   - any use of ai_similarity_check at this stage
-- ============================================================

ALTER TABLE demand
    ADD COLUMN IF NOT EXISTS complexity_tier TEXT CHECK (complexity_tier IN ('high','medium','low')),
    ADD COLUMN IF NOT EXISTS cost_tier TEXT CHECK (cost_tier IN ('high','medium','low')),
    ADD COLUMN IF NOT EXISTS triaged_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS triage_notes TEXT;

-- Fix any rows already sitting in the old 'triaged' status from earlier
-- testing, so the RACI-acceptance endpoint's precondition (which now
-- checks for 'accepted') still finds them correctly.
UPDATE demand SET status = 'accepted' WHERE status = 'triaged';
