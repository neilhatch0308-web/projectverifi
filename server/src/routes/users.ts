import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';

const router = Router();

// Roles considered "senior" for sponsor-selection purposes - a UI nudge,
// not enforcement. Anyone can still technically be picked; this just
// sorts and labels them so a mismatched pick is visible before submission.
// Full role-based enforcement (who's ALLOWED to hold which governance
// seat) is deferred - same open gap as requireRole() in auth middleware,
// worth solving once for all governance roles rather than patching this
// one field in isolation.
const SENIOR_ROLES = ['org_admin', 'sponsor', 'finance'];

router.get('/users', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const users = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, display_name, email, role FROM app_user WHERE is_active = true ORDER BY display_name`
      );
      return result.rows.map((u) => ({ ...u, is_senior: SENIOR_ROLES.includes(u.role) }));
    });

    res.json(users);
  } catch (err) {
    console.error('Failed to fetch users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export default router;
