-- 48_demand_dependency.sql
--
-- A directed "must happen before" link between two demands, purely a
-- visualisation/planning aid on the Five-Year Horizon -- it does not
-- gate or block anything (matches "platform surfaces, human resolves"
-- already used throughout this framework). depends_on_id is the
-- prerequisite; demand_id is the one that depends on it. The arrow on
-- screen points FROM depends_on_id TO demand_id.

BEGIN;

CREATE TABLE demand_dependency (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organization(id),
  demand_id       UUID NOT NULL REFERENCES demand(id),
  depends_on_id   UUID NOT NULL REFERENCES demand(id),
  created_by      UUID NOT NULL REFERENCES app_user(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT demand_dependency_not_self CHECK (demand_id <> depends_on_id),
  UNIQUE (demand_id, depends_on_id)
);

CREATE INDEX idx_demand_dependency_demand ON demand_dependency (demand_id);
CREATE INDEX idx_demand_dependency_depends_on ON demand_dependency (depends_on_id);

COMMENT ON TABLE demand_dependency IS
  'Directed "must happen before" link between two demands, shown as a connecting arrow on the Five-Year Horizon. depends_on_id is the prerequisite. Purely informational -- does not block or gate either demand''s progress. No cycle detection beyond preventing an exact A-depends-on-B plus B-depends-on-A pair; a longer cycle (A->B->C->A) is possible and, if it happens, is a signal for a human to resolve, not something the system silently prevents.';

ALTER TABLE demand_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_dependency FORCE ROW LEVEL SECURITY;

CREATE POLICY demand_dependency_tenant_isolation ON demand_dependency
  USING (organization_id = current_setting('app.current_org')::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org')::uuid);

COMMIT;
