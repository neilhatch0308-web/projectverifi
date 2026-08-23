import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { pool } from '../db/pool';

if (!getApps().length) {
  initializeApp();
}

// Verifies the Firebase ID token, then resolves organization_id via the
// resolve_app_user_by_firebase_uid() SQL function - a narrow, deliberate
// hole in RLS for this one identity lookup only (see 14_auth_lookup_function.sql
// for why a plain query here doesn't work once RLS is forced). Every
// other query in the app goes through withTenantContext and stays fully
// RLS-scoped; this is the one exception, and it's as narrow as possible.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const idToken = authHeader.slice('Bearer '.length);

  let decoded: DecodedIdToken;
  try {
    decoded = await getAuth().verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM resolve_app_user_by_firebase_uid($1)`,
      [decoded.uid]
    );

    const appUser = result.rows[0];

    if (!appUser) {
      return res.status(403).json({ error: 'No account found for this identity' });
    }

    if (!appUser.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    req.user = {
      firebaseUid: decoded.uid,
      userId: appUser.id,
      organizationId: appUser.organization_id,
      displayName: appUser.display_name,
      email: appUser.email,
    };

    next();
  } catch (err) {
    console.error('Auth middleware DB lookup failed:', err);
    res.status(500).json({ error: 'Authentication check failed' });
  }
}