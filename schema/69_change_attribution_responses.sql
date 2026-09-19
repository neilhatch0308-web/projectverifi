-- 69_change_attribution_responses.sql
--
-- Post-approval change control, step 4 of 5: the named decider responds.
--
-- WHY. Attestation is unchecked: anyone with business_case.edit can
-- write "Sponsor X decided this". Step 2 records the claim; this step
-- lets the person it is attributed to see it and answer for it.
--
-- THE RULES (agreed):
--   - Confirm: logged with the responder and date.
--   - Dispute: a reason is required. It flags the change in history
--     and reports. It does NOT reverse the change -- a human resolves
--     it, same "platform surfaces, human resolves" rule as everywhere.
--   - Do nothing: it stays 'unconfirmed', and the age of that is itself
--     a signal (derived from the attestation date, never stored).
--
-- A response belongs to ONE attestation. Attestations are insert-only
-- and the latest is effective (step 2), so re-attributing a change to
-- someone else naturally retires the earlier person's response: it
-- stays in the record but no longer speaks for the current attribution.
-- Responses are insert-only too; a person who changes their mind adds a
-- later row, and the latest for that attestation is effective. Nothing
-- is overwritten.
--
-- WHO CAN RESPOND. Only the user named on the effective attestation,
-- enforced in the route. Deliberately NOT gated on business_case.edit:
-- a Sponsor named as decider may hold no edit permission at all, and
-- being named should be enough to be heard. They can only see a change
-- that has actually been applied, on a demand they can see (a held
-- change is invisible to them by design, see 68).
--
-- Outside names have no login, so they can never respond; those stay
-- flagged 'unverifiable attribution' (step 2).

BEGIN;

CREATE TABLE change_attribution_response (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organization(id),
  change_request_id UUID NOT NULL REFERENCES change_request(id),
  attestation_id    UUID NOT NULL REFERENCES change_attestation(id),
  responder_user_id UUID NOT NULL REFERENCES app_user(id),
  response          TEXT NOT NULL CHECK (response IN ('confirmed', 'disputed')),
  reason            TEXT,
  responded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT change_attribution_dispute_needs_reason CHECK (
    response = 'confirmed' OR length(btrim(COALESCE(reason, ''))) > 0
  )
);
CREATE INDEX idx_change_attribution_response_att ON change_attribution_response (attestation_id, responded_at DESC);
CREATE INDEX idx_change_attribution_response_cr ON change_attribution_response (change_request_id);

CREATE TRIGGER trg_change_attribution_response_immutable BEFORE UPDATE OR DELETE ON change_attribution_response
  FOR EACH ROW EXECUTE FUNCTION block_change_control_mutation();

ALTER TABLE change_attribution_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_attribution_response FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_change_attribution_response ON change_attribution_response
  USING (organization_id = current_setting('app.current_org', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);

SELECT assert_rls_coverage();

COMMIT;
