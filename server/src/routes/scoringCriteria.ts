import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';

const router = Router();

router.get('/scoring-criteria', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const criteria = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, name, description, max_points, is_fixed
         FROM scoring_criterion
         WHERE active = true
         ORDER BY max_points DESC, name`
      );
      return result.rows;
    });

    res.json(criteria);
  } catch (err) {
    console.error('Failed to fetch scoring criteria:', err);
    res.status(500).json({ error: 'Failed to fetch scoring criteria' });
  }
});

export default router;
