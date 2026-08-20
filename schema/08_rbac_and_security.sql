-- ============================================================
-- RBAC, Scoped Access & API Credential Management
-- Roles are accountable-to-a-function (not a named person), scoped
-- to organization AND optionally portfolio, so a sponsor only sees
-- what's theirs. External API access uses separate, revocable,
-- rate-limited credentials — never the same trust boundary as UI users.
-- Depends on: organization, app_user, portfolio, demand
-- ============================================================

-- ---------- Roles — system-defined, not editable per org except naming ----------
CREATE TABLE role (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,   -- 'org_admin','pmo','sponsor','benefit_owner','finance','contributor','auditor'
    name            TEXT NOT NULL,
    description     TEXT,
    is_system_role  BOOLEAN NOT NULL DEFAULT true
);

-- ---------- Permissions — fine-grained, resource:action pairs ----------
CREATE TABLE permission (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,   -- 'demand:create', 'demand:score', 'demand:accept_reject'
    resource        TEXT NOT NULL,          -- 'demand' | 'business_case' | 'benefit' | 'kpi' | 'user' | 'audit'
    action          TEXT NOT NULL,          -- 'create' | 'read' | 'update' | 'approve' | 'manage'
    description     TEXT
);

CREATE TABLE role_permission (
    role_id         UUID NOT NULL REFERENCES role(id),
    permission_id   UUID NOT NULL REFERENCES permission(id),
    PRIMARY KEY (role_id, permission_id)
);

-- ---------- Assigning a role to a user, scoped to org and optionally portfolio ----------
-- Scoping to portfolio means a sponsor of "Academic Division" doesn't
-- see or approve demands raised against "ELT Division" by default.
CREATE TABLE user_role_assignment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES app_user(id),
    role_id         UUID NOT NULL REFERENCES role(id),
    organization_id UUID NOT NULL REFERENCES organization(id),
    portfolio_id    UUID REFERENCES portfolio(id),   -- null = org-wide scope for this role
    granted_by      UUID REFERENCES app_user(id),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,     -- time-bound access, e.g. a temporary reviewer or contractor
    revoked_at      TIMESTAMPTZ
);

-- ---------- Sensitivity classification on the records that matter most ----------
ALTER TABLE business_case ADD COLUMN IF NOT EXISTS sensitivity_level TEXT NOT NULL DEFAULT 'standard';
    -- standard | restricted  (restricted = requires 'business_case:view_restricted' permission,
    -- e.g. cases involving M&A-adjacent, headcount, or highly sensitive commercial terms)

-- ---------- External / API access — a SEPARATE trust boundary from UI users ----------
-- Service accounts and integrations never reuse a human user's session.
-- Each credential is scoped, rate-limited, and independently revocable.
CREATE TABLE api_credential (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organization(id),
    name                TEXT NOT NULL,          -- 'Power BI reporting connector', 'Finance nightly export'
    client_id           TEXT NOT NULL UNIQUE,
    hashed_secret        TEXT NOT NULL,          -- never store plaintext; app layer hashes on issue
    scopes               TEXT[] NOT NULL,        -- e.g. ARRAY['benefit:read','kpi:read'] — least privilege, read-heavy by default
    rate_limit_per_minute SMALLINT NOT NULL DEFAULT 60,
    allowed_ip_ranges     TEXT[],                -- optional CIDR allowlist for service-to-service calls
    created_by            UUID REFERENCES app_user(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at            TIMESTAMPTZ,
    expires_at               TIMESTAMPTZ,           -- credentials should always have a lifetime, even if long
    revoked_at                TIMESTAMPTZ
);

-- ---------- Raw access log — distinct from audit_log (business changes) ----------
-- This is for security monitoring: every authenticated call, successful
-- or not, so anomaly detection (unusual volume, new IP, off-hours bulk
-- reads) has something to work from.
CREATE TABLE api_access_log (
    id              BIGSERIAL PRIMARY KEY,
    credential_id   UUID REFERENCES api_credential(id),   -- null if a human UI session, use user_id instead
    user_id         UUID REFERENCES app_user(id),
    endpoint        TEXT NOT NULL,
    method          TEXT NOT NULL,
    ip_address      INET,
    status_code     SMALLINT,
    response_row_count INTEGER,     -- flags over-exposure: a single call returning thousands of rows is a signal
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Gate: unresolved AI similarity flags block sponsor acceptance ----------
CREATE VIEW demand_pending_similarity_review AS
SELECT
    d.id AS demand_id,
    COUNT(*) AS unresolved_high_similarity_flags
FROM demand d
JOIN ai_similarity_check ac
    ON ac.source_entity_type = 'demand' AND ac.source_entity_id = d.id
WHERE ac.review_outcome = 'unreviewed'
  AND ac.similarity_score >= 0.75
GROUP BY d.id;
-- App layer: before allowing a 'demand:accept_reject' action, check this view —
-- if the demand has rows here, surface the flagged matches in the drawer for
-- the sponsor (or PMO) to confirm/dismiss BEFORE the accept/reject buttons unlock.

-- ---------- Indexes ----------
CREATE INDEX idx_role_assignment_user ON user_role_assignment(user_id);
CREATE INDEX idx_role_assignment_org_portfolio ON user_role_assignment(organization_id, portfolio_id);
CREATE INDEX idx_credential_org ON api_credential(organization_id);
CREATE INDEX idx_access_log_credential ON api_access_log(credential_id, occurred_at);
CREATE INDEX idx_access_log_user ON api_access_log(user_id, occurred_at);

-- ---------- Suggested role/permission seed (illustrative, not exhaustive) ----------
-- role: org_admin      -> full manage on everything within their organization
-- role: pmo            -> demand:create/read/score, business_case:read, similarity:review, cannot approve
-- role: sponsor        -> demand:accept_reject (own portfolio only), business_case:read
-- role: finance        -> business_case:edit_financials, investment:manage, benefit:read
-- role: benefit_owner  -> benefit:update_status, kpi:record_measurement, realization_check:perform
-- role: auditor        -> read-only across all entities + full audit_log access, zero write permissions
-- role: contributor    -> demand:create, demand:read (own submissions + assigned tasks only)

-- ============================================================
-- Design notes on the SECURITY layer this schema alone can't provide —
-- these need to sit in infrastructure/application config, not the DB:
--
-- 1. AUTHENTICATION: SSO via OIDC/SAML against your identity provider,
--    with MFA enforced for any role above 'contributor'. Never build
--    a bespoke password system for an internal tool holding financial
--    and strategic data.
-- 2. ROW-LEVEL SECURITY: enforce portfolio scoping with Postgres RLS
--    policies (not just app-layer WHERE clauses) keyed off a session
--    variable set at connection time — e.g.
--    `CREATE POLICY sponsor_scope ON demand USING (portfolio_id IN (
--       SELECT portfolio_id FROM user_role_assignment
--       WHERE user_id = current_setting('app.current_user_id')::uuid))`
--    — this means even a bug in application code can't leak
--    cross-portfolio data, because the database itself won't return it.
-- 3. API EXPOSURE: put the API behind a gateway that does rate limiting,
--    request size limits, and schema validation BEFORE it reaches your
--    application — reject malformed/oversized requests at the edge.
--    Never expose the Postgres instance directly; all access goes
--    through the application's authorization layer.
-- 4. LEAST PRIVILEGE BY DEFAULT: api_credential.scopes should default
--    to read-only, narrow scopes. Anything issuing broad write access
--    (e.g. a data migration script) should be short-lived, expiring
--    within hours, not a permanent credential.
-- 5. SECRETS: hashed_secret is hashed at rest; the plaintext secret is
--    shown to the creator exactly once at issue time and never stored
--    or logged anywhere, including in api_access_log.
-- 6. MONITORING: alert on api_access_log patterns — a credential
--    suddenly pulling high response_row_count, calling from a new
--    ip_address, or operating outside normal hours — rather than
--    relying on someone noticing manually.
-- 7. ENCRYPTION: TLS 1.2+ in transit (non-negotiable), encryption at
--    rest for the database and any backups, and field-level encryption
--    or masking for anything in `business_case.sensitivity_level =
--    'restricted'` if it ever needs to leave the primary datastore
--    (e.g. in exports or the AI similarity embedding pipeline).
-- 8. REGULAR ACCESS REVIEW: `user_role_assignment.expires_at` should
--    be enforced, not just present — a quarterly access recertification
--    (PMO or org_admin reviews who has what) catches accumulated
--    over-privilege that individual grants never do on their own.
-- ============================================================
