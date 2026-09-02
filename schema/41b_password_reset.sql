-- Migration 42: password_reset
--
-- Backs the OTP-based password reset flow on projects.we-verifi.co.uk
-- (server/src/routes/passwordReset.ts), ported from the equivalent
-- Firestore-based flow on certs.we-verifi.co.uk.
--
-- Deliberately NOT tenant-scoped and carries no RLS policy: this table is
-- read/written before the caller is authenticated at all, so there is no
-- app.current_org to enforce yet (see withTenantContext in
-- server/src/db/pool.ts for where that pattern normally applies).
--
-- Row lifetime is short by design — 10-minute expiry, deleted on
-- successful reset or on lockout after 5 wrong attempts. No scheduled
-- purge job exists yet for abandoned requests (a code requested and never
-- used); add one if that turns out to matter operationally.

CREATE TABLE password_reset (
  id            TEXT PRIMARY KEY,           -- secureToken('pwreset')
  firebase_uid  TEXT,                       -- NULL if no matching account was found
  email         TEXT NOT NULL,
  code          TEXT NOT NULL,
  attempts      INT NOT NULL DEFAULT 0,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_password_reset_email_sent ON password_reset (email, sent_at);