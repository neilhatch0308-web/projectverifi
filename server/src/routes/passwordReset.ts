// server/src/routes/passwordReset.ts
//
// Password reset for projects.we-verifi.co.uk (Ledger), ported from
// certs.we-verifi.co.uk's server.js OTP flow. Same two-step shape:
//   1. POST /api/auth/password-reset-request  { email } -> { resetToken }
//   2. POST /api/auth/password-reset-confirm  { resetToken, code, newPassword } -> { success }
//
// Differences from the certs.we-verifi.co.uk version, since Ledger's stack
// is Postgres + Firebase Admin (no Firestore):
//   - reset tokens are stored in a new `password_reset` table instead of a
//     Firestore `passwordResets` collection
//   - no multi-tenant org resolution needed — this runs before auth entirely
//   - you'll need to plug in your own mail sender; the certs app uses
//     lib/emailSender.js (Resend/Brevo) — reuse the same one here if you
//     have it, or swap sendResetEmail() below for whatever you use.
//
// Required migration (run once):
//
//   CREATE TABLE password_reset (
//     id            TEXT PRIMARY KEY,           -- secureToken('pwreset')
//     firebase_uid  TEXT,                       -- NULL if no account was found
//     email         TEXT NOT NULL,
//     code          TEXT NOT NULL,
//     attempts      INT NOT NULL DEFAULT 0,
//     sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
//     expires_at    TIMESTAMPTZ NOT NULL
//   );
//   CREATE INDEX idx_password_reset_email_sent ON password_reset (email, sent_at);
//
// This table is NOT tenant-scoped and has no RLS — the whole point of this
// flow is that the caller isn't authenticated yet, so there's no
// app.current_org to set. Row lifetime is short (10 min expiry, deleted on
// use); add a cron/scheduled job to purge rows past expires_at if you want
// a backstop against abandoned requests, matching the Firestore TTL used
// on certs.we-verifi.co.uk.

import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import crypto from 'crypto';
import { getAuth } from 'firebase-admin/auth';
import { pool } from '../db/pool'; // adjust to your actual pg pool export
// import { sendEmail } from '../lib/emailSender'; // wire up your own mailer

const router = Router();

// ---------------------------------------------------------------------------
// Same security-bearing random helpers as certs.we-verifi.co.uk's server.js.
// Math.random() is not safe for tokens/codes an attacker could brute-force
// or predict from observed outputs — use crypto throughout.
// ---------------------------------------------------------------------------
function secureToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
}

function secureOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

function codesMatch(a: unknown, b: unknown): boolean {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Brevo transactional email — plain REST call to /v3/smtp/email, no SDK
// dependency needed. Never throws on a send failure; returns { sent: false }
// so the caller can fail closed without leaking whether the account exists.
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@we-verifi.co.uk';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Project Verifi';

async function sendResetEmail(to: string, code: string): Promise<{ sent: boolean }> {
  if (!BREVO_API_KEY) {
    console.error('[passwordReset] BREVO_API_KEY not set — cannot send reset email');
    return { sent: false };
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { email: EMAIL_FROM, name: EMAIL_FROM_NAME },
        to: [{ email: to }],
        subject: 'Reset your password — Project Verifi',
        htmlContent: `
          <p>Hi,</p>
          <p>Someone requested a password reset for this account. Your reset code is:</p>
          <h2 style="font-family: monospace; letter-spacing: 2px;">${code}</h2>
          <p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email — your password won't be changed.</p>
          <p>— Project Verifi</p>
        `,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[passwordReset] Brevo send failed', { status: res.status, body });
      return { sent: false };
    }

    return { sent: true };
  } catch (err: any) {
    console.error('[passwordReset] Brevo send error', { error: err?.message });
    return { sent: false };
  }
}

// Password reset requests are unauthenticated, so rate-limit by IP as well
// as by email (per-email limit enforced separately below) — mirrors
// certs.we-verifi.co.uk's passwordResetLimiter.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
});

// =========================================================================
// POST /api/auth/password-reset-request
// Body: { email }. Always responds 200 with a resetToken (or without one,
// if send failed) — never reveals whether the account exists.
// =========================================================================
router.post('/api/auth/password-reset-request', passwordResetLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'invalid_email', detail: 'Enter a valid email address.' });
    }

    // Per-email limit, independent of the per-IP limiter above — stops one
    // IP being used to spam a single victim's inbox with reset codes.
    const oneHourAgo = new Date(Date.now() - 3600000);
    const { rows: recentRows } = await pool.query(
      `SELECT count(*)::int AS n FROM password_reset WHERE email = $1 AND sent_at > $2`,
      [email, oneHourAgo]
    );
    if (recentRows[0].n >= 3) {
      // Same generic response as success — don't reveal whether this limit
      // was hit because the account exists and is under attack, or the
      // account doesn't exist at all.
      return res.status(200).json({ message: 'If an account exists for that email, a reset code has been sent.' });
    }

    let uid: string | null = null;
    try {
      const userRecord = await getAuth().getUserByEmail(email);
      uid = userRecord.uid;
    } catch (err: any) {
      if (err?.code !== 'auth/user-not-found') {
        console.error('[passwordReset] lookup error', { email, error: err?.message });
      }
      // Fall through with uid = null either way — see doc comment above.
    }

    const code = secureOtpCode();
    const expiresAt = new Date(Date.now() + 600000); // 10 minutes
    const resetId = secureToken('pwreset');

    await pool.query(
      `INSERT INTO password_reset (id, firebase_uid, email, code, attempts, sent_at, expires_at)
       VALUES ($1, $2, $3, $4, 0, now(), $5)`,
      [resetId, uid, email, code, expiresAt]
    );

    // Only actually send an email if a real account was found — a
    // non-existent email never receives anything, but the HTTP response is
    // identical either way (enumeration protection).
    if (uid) {
      const emailResult = await sendResetEmail(email, code);
      if (!emailResult.sent) {
        console.error('[passwordReset] email send failed', { email });
        await pool.query(`DELETE FROM password_reset WHERE id = $1`, [resetId]).catch(() => {});
        return res.status(200).json({ message: 'If an account exists for that email, a reset code has been sent.' });
      }
    }

    return res.status(200).json({
      message: 'If an account exists for that email, a reset code has been sent.',
      resetToken: resetId,
    });
  } catch (err: any) {
    console.error('[passwordReset] request error', { error: err?.message });
    return res.status(500).json({ error: 'server_error' });
  }
});

// =========================================================================
// POST /api/auth/password-reset-confirm
// Body: { resetToken, code, newPassword }.
// =========================================================================
router.post('/api/auth/password-reset-confirm', passwordResetLimiter, async (req, res) => {
  try {
    const { resetToken, code, newPassword } = req.body || {};
    if (!resetToken || !code || !newPassword) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'weak_password', detail: 'Password must be at least 8 characters.' });
    }

    const genericError = () =>
      res.status(400).json({ error: 'invalid_or_expired_code', detail: 'That code is invalid or has expired. Request a new one.' });

    const { rows } = await pool.query(`SELECT * FROM password_reset WHERE id = $1`, [resetToken]);
    if (rows.length === 0) return genericError();
    const reset = rows[0];

    if (new Date(reset.expires_at).getTime() < Date.now()) {
      await pool.query(`DELETE FROM password_reset WHERE id = $1`, [resetToken]);
      return genericError();
    }

    if (reset.attempts >= 5) {
      // Block further attempts on this token — request a fresh one. Never
      // deletes the Firebase account (unlike a signup OTP lockout would).
      await pool.query(`DELETE FROM password_reset WHERE id = $1`, [resetToken]);
      console.warn('[passwordReset] locked', { email: reset.email });
      return res.status(429).json({ error: 'too_many_attempts', detail: 'Too many incorrect attempts. Request a new code.' });
    }

    if (!codesMatch(code, reset.code)) {
      await pool.query(`UPDATE password_reset SET attempts = attempts + 1 WHERE id = $1`, [resetToken]);
      console.warn('[passwordReset] wrong code', { email: reset.email, attempt: reset.attempts + 1 });
      return genericError();
    }

    if (!reset.firebase_uid) {
      // This token's email never matched a real account — handle the same
      // generic way regardless.
      await pool.query(`DELETE FROM password_reset WHERE id = $1`, [resetToken]);
      return genericError();
    }

    await getAuth().updateUser(reset.firebase_uid, { password: newPassword });
    // Invalidate every existing session for this account — if the reset
    // was triggered by a compromise, leaving an attacker's session alive
    // defeats the point.
    await getAuth().revokeRefreshTokens(reset.firebase_uid);
    await pool.query(`DELETE FROM password_reset WHERE id = $1`, [resetToken]);

    console.info('[passwordReset] completed', { uid: reset.firebase_uid, email: reset.email });

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('[passwordReset] confirm error', { error: err?.message });
    return res.status(500).json({ error: 'server_error' });
  }
});

export default router;