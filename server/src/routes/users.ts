import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';

const router = Router();

// For RACI seat dropdowns - every active user in the org, real login or
// placeholder alike. Placeholders (no firebase_uid) are indistinguishable
// here from real accounts by design; the seat just needs a named person.
router.get('/users', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const users = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, display_name, email, role FROM app_user WHERE is_active = true ORDER BY display_name`
      );
      return result.rows;
    });

    res.json(users);
  } catch (err) {
    console.error('Failed to fetch users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export default router;
