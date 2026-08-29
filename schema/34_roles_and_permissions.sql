-- ============================================================
-- 34_roles_and_permissions.sql
--
-- Role-based access control. Previously there was none: requireAuth
-- verified identity and resolved org membership, but every authenticated
-- org member could do everything - flagged explicitly as a deferred gap
-- in users.ts (SENIOR_ROLES comment) and in HANDOFF's known-gaps list.
--
-- MODEL
-- - Every user is a Submitter by default - raise demand, view/edit their
--   own demand, see reference data (portfolios, goals) needed to raise.
--   This is the floor, not a tickable role - nothing to configure.
-- - Additional capability comes from ROLES, which are tenant-defined and
--   tick-assigned to users (many-to-many, stackable - a user can hold
--   several roles at once, same "cumulative" spirit as governance tiers).
-- - A ROLE is just a named bundle of PERMISSIONs, itself tick-configured
--   by an org admin. Permissions are a FIXED catalog (they correspond to
--   actual gates in the code, so they're seeded, not tenant-invented) -
--   but which permissions a given role grants, and which roles a given
--   user holds, are both fully tenant-configurable.
--
-- This mirrors the same pattern already used for governance_tier:
-- fixed spine (the permission keys / the RPVF stages), tenant-owned
-- configuration on top (which tiers/roles exist and what they grant).
-- ============================================================

CREATE TABLE IF NOT EXISTS permission (
    key         TEXT PRIMARY KEY,      -- e.g. 'business_case.edit' - stable, referenced in code
    label       TEXT NOT NULL,
    description TEXT
);

INSERT INTO permission (key, label, description) VALUES
    ('demand.triage',      'Triage & stop demand',        'Accept a raised demand at triage, or stop a demand at any pre-promotion stage.'),
    ('demand.assess',      'Run P75 assessments',         'Submit the assessment stage for an accepted demand.'),
    ('business_case.view', 'View business cases',         'See business case detail - narrative, financials, RACI, risks.'),
    ('business_case.edit', 'Edit business cases',         'Edit executive summary, risks, Finance Impact Assessment, investment figures.'),
    ('business_case.decide','Approve or decline business cases', 'Record the approve/decline decision on requested spend.'),
    ('planning.edit',      'Edit the annual planning board', 'Place demand into budget/deferred, agree or revise a plan.'),
    ('budgets.manage',     'Manage portfolio budgets',    'Set/adjust portfolio allocations, record transfers.'),
    ('org.manage',         'Manage organisation config',  'Portfolios, strategic goals, governance tiers.'),
    ('users.manage',       'Manage users & roles',        'Define roles, assign roles to users, deactivate users.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS role (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organization(id),
    name            TEXT NOT NULL,
    description     TEXT,
    created_by      UUID REFERENCES app_user(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permission (
    role_id         UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    permission_key  TEXT NOT NULL REFERENCES permission(key),
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS app_user_role (
    user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    granted_by  UUID REFERENCES app_user(id),
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_role_user ON app_user_role(user_id);

COMMENT ON TABLE role IS 'Tenant-defined, tick-configured bundles of permissions. Stackable - a user can hold several.';
COMMENT ON TABLE app_user_role IS 'Which roles each user holds. Every user also has an implicit, non-tickable Submitter baseline not represented here.';

-- ---------- Starter roles for Acme Holdings ----------
-- Matches the worked PMO example from design: submit (baseline) +
-- triage + org management + read-only business case visibility.
-- Fully editable/deletable via the Roles admin screen afterwards.

INSERT INTO role (id, organization_id, name, description) VALUES
    ('34111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'PMO',
     'Triages and assesses demand, reads business cases, manages the operating model (portfolios, goals, governance tiers). Does not edit business cases or approve spend.'),
    ('34111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Portfolio Lead',
     'Assesses demand and runs the annual planning board for their portfolio. Reads business cases.'),
    ('34111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Finance',
     'Edits business case financials and the Finance Impact Assessment, manages portfolio budgets.'),
    ('34111111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Approver',
     'Reads business cases and records the approve/decline decision.'),
    ('34111111-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Org Admin',
     'Full access, including user and role management.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permission (role_id, permission_key) VALUES
    ('34111111-0000-0000-0000-000000000001', 'demand.triage'),
    ('34111111-0000-0000-0000-000000000001', 'demand.assess'),
    ('34111111-0000-0000-0000-000000000001', 'business_case.view'),
    ('34111111-0000-0000-0000-000000000001', 'org.manage'),

    ('34111111-0000-0000-0000-000000000002', 'demand.assess'),
    ('34111111-0000-0000-0000-000000000002', 'business_case.view'),
    ('34111111-0000-0000-0000-000000000002', 'planning.edit'),

    ('34111111-0000-0000-0000-000000000003', 'business_case.view'),
    ('34111111-0000-0000-0000-000000000003', 'business_case.edit'),
    ('34111111-0000-0000-0000-000000000003', 'budgets.manage'),

    ('34111111-0000-0000-0000-000000000004', 'business_case.view'),
    ('34111111-0000-0000-0000-000000000004', 'business_case.decide'),

    ('34111111-0000-0000-0000-000000000005', 'demand.triage'),
    ('34111111-0000-0000-0000-000000000005', 'demand.assess'),
    ('34111111-0000-0000-0000-000000000005', 'business_case.view'),
    ('34111111-0000-0000-0000-000000000005', 'business_case.edit'),
    ('34111111-0000-0000-0000-000000000005', 'business_case.decide'),
    ('34111111-0000-0000-0000-000000000005', 'planning.edit'),
    ('34111111-0000-0000-0000-000000000005', 'budgets.manage'),
    ('34111111-0000-0000-0000-000000000005', 'org.manage'),
    ('34111111-0000-0000-0000-000000000005', 'users.manage')
ON CONFLICT DO NOTHING;
