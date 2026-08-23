import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';

const router = Router();

// Divisions (the 'portfolio' table) - needed to populate the raising
// division dropdown on the Raise Demand form.
router.get('/portfolios', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const portfolios = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, name FROM portfolio ORDER BY name`
      );
      return result.rows;
    });

    res.json(portfolios);
  } catch (err) {
    console.error('Failed to fetch portfolios:', err);
    res.status(500).json({ error: 'Failed to fetch portfolios' });
  }
});

export default router;
