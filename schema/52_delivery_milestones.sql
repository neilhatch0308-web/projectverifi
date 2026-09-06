-- 52_delivery_milestones.sql
--
-- The framework's own stated differentiator -- "did this actually
-- happen, and did the promised value show up" -- has had zero routes
-- against it since the pre-RPVF scaffold covering this was dropped in
-- migration 38. This is a deliberately narrow first slice: attestation
-- only (who confirmed it, when, optional notes), not a numeric
-- realized-benefit figure. Where a real "actual benefit" number comes
-- from, who owns it, and whether it's revisable is a separate, bigger
-- design question -- not folded in here.
--
-- Four sequential, one-way milestones, matching exactly how
-- Triage -> Accept -> Assess -> Promote already work in this app:
-- each requires the one before it, and none of them un-happen once
-- set. This is a fixed, known, small set of stages (like RACI's five
-- seats or Annual Plan's three statuses) rather than an open-ended
-- list, so it's modelled as named columns on one row per demand,
-- consistent with demand_assessment and demand_raci -- not a generic
-- polymorphic "one row per milestone type" table.
--
-- Two new permissions: delivery.view and delivery.edit. Deliberately
-- not tied to any named role (PMO, a future PM role, or anyone else)
-- in code -- whoever administers Roles ticks these for whichever
-- role(s) should have them, the same way every other permission in
-- this system already works.

BEGIN;

INSERT INTO permission (key, label, description) VALUES
    ('delivery.view', 'View delivery tracking', 'See delivery/adoption/benefit-realisation milestones on a promoted demand.'),
    ('delivery.edit', 'Record delivery milestones', 'Mark delivery started/complete, adoption measured, and benefit realised. Requires delivery.view to see the panel this acts on.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE demand_delivery (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organization(id),
  demand_id               UUID NOT NULL UNIQUE REFERENCES demand(id),

  delivery_started_at     TIMESTAMPTZ,
  delivery_started_by     UUID REFERENCES app_user(id),

  delivery_completed_at   TIMESTAMPTZ,
  delivery_completed_by   UUID REFERENCES app_user(id),

  adoption_measured_at    TIMESTAMPTZ,
  adoption_measured_by    UUID REFERENCES app_user(id),
  adoption_notes          TEXT,

  benefit_realized_at     TIMESTAMPTZ,
  benefit_realized_by     UUID REFERENCES app_user(id),
  benefit_realized_notes  TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforces the sequence at the database level too, not just in the
  -- API: each milestone can only be set once its predecessor already
  -- is, and none can be un-set once recorded (no UPDATE path clears
  -- a *_at column back to NULL -- the API only ever moves forward).
  CONSTRAINT demand_delivery_sequence CHECK (
    (delivery_completed_at IS NULL OR delivery_started_at IS NOT NULL)
    AND (adoption_measured_at IS NULL OR delivery_completed_at IS NOT NULL)
    AND (benefit_realized_at IS NULL OR adoption_measured_at IS NOT NULL)
  )
);

CREATE INDEX idx_demand_delivery_demand ON demand_delivery (demand_id);

COMMENT ON TABLE demand_delivery IS
  'First slice of Delivery/Adoption/Realisation tracking. One row per demand, created on first milestone. Four sequential, one-way attestation milestones -- who confirmed it and when, not a computed or numeric outcome. Visibility via delivery.view, recording via delivery.edit.';

ALTER TABLE demand_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_delivery FORCE ROW LEVEL SECURITY;

CREATE POLICY demand_delivery_tenant_isolation ON demand_delivery
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

COMMIT;
