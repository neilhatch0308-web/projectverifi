import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';

const router = Router();

router.get('/strategic-goals', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const goals = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, name, description, goal_year, declared_at
         FROM strategic_goal
         ORDER BY goal_year DESC, declared_at ASC`
      );
      return result.rows;
    });

    res.json(goals);
  } catch (err) {
    console.error('Failed to fetch strategic goals:', err);
    res.status(500).json({ error: 'Failed to fetch strategic goals' });
  }
});

export default router;
