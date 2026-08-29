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
//
// Also resolves the user's EFFECTIVE PERMISSION SET here - the union of
// every permission granted by every role they hold (34_roles_and_
// permissions.sql). Every authenticated user has the implicit Submitter
// baseline (raise demand, view/edit their own) regardless of what's in
// this set - permissions here only gate the ADDITIONAL capabilities
// layered on top by roles.
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

    const permResult = await pool.query(
      `SELECT DISTINCT rp.permission_key
       FROM app_user_role ur
       JOIN role_permission rp ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1`,
      [appUser.id]
    );

    req.user = {
      firebaseUid: decoded.uid,
      userId: appUser.id,
      organizationId: appUser.organization_id,
      displayName: appUser.display_name,
      email: appUser.email,
      permissions: permResult.rows.map((r) => r.permission_key as string),
    };

    next();
  } catch (err) {
    console.error('Auth middleware DB lookup failed:', err);
    res.status(500).json({ error: 'Authentication check failed' });
  }
}

// Gate for the ADDITIONAL capabilities roles grant on top of the
// Submitter baseline. Use after requireAuth. A missing permission is a
// 403, not a 404 - the resource exists, the caller just isn't allowed
// to act on it, and hiding that distinction doesn't help anyone.
export function requirePermission(key: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.permissions?.includes(key)) {
      return res.status(403).json({ error: `Missing permission: ${key}` });
    }
    next();
  };
}