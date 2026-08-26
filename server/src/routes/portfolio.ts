import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

// ---------- Parent portfolios only - unchanged behaviour, used for
// raising a demand and for budget lines ----------
router.get('/portfolios', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const portfolios = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, name FROM portfolio WHERE parent_portfolio_id IS NULL ORDER BY name`
      );
      return result.rows;
    });

    res.json(portfolios);
  } catch (err) {
    console.error('Failed to fetch portfolios:', err);
    res.status(500).json({ error: 'Failed to fetch portfolios' });
  }
});

// ---------- Full hierarchy - parents with their sub-portfolios nested,
// for the admin screen ----------
router.get('/portfolios/hierarchy', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const rows = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, name, parent_portfolio_id FROM portfolio ORDER BY parent_portfolio_id NULLS FIRST, name`
      );
      return result.rows;
    });

    const parents = rows.filter((r) => !r.parent_portfolio_id);
    const hierarchy = parents.map((p) => ({
      ...p,
      subPortfolios: rows.filter((r) => r.parent_portfolio_id === p.id),
    }));

    res.json(hierarchy);
  } catch (err) {
    console.error('Failed to fetch portfolio hierarchy:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio hierarchy' });
  }
});

// ---------- Sub-portfolios of one parent - for the delivery-assignment dropdown ----------
router.get('/portfolios/:id/sub-portfolios', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    const subs = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT id, name FROM portfolio WHERE parent_portfolio_id = $1 ORDER BY name`,
        [id]
      );
      return result.rows;
    });

    res.json(subs);
  } catch (err) {
    console.error('Failed to fetch sub-portfolios:', err);
    res.status(500).json({ error: 'Failed to fetch sub-portfolios' });
  }
});

// ---------- Every sub-portfolio, with its parent - for the reassignment
// dropdown on Demand Detail, where the parent may not be the raising one ----------
router.get('/portfolios/sub-portfolios/all', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const subs = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT sub.id, sub.name, parent.id AS parent_id, parent.name AS parent_name
         FROM portfolio sub
         JOIN portfolio parent ON parent.id = sub.parent_portfolio_id
         ORDER BY parent.name, sub.name`
      );
      return result.rows;
    });

    res.json(subs);
  } catch (err) {
    console.error('Failed to fetch all sub-portfolios:', err);
    res.status(500).json({ error: 'Failed to fetch all sub-portfolios' });
  }
});

// ---------- Create a parent portfolio or a sub-portfolio ----------
const createPortfolioSchema = z.object({
  name: z.string().min(1),
  parentPortfolioId: looseUuid().optional(),
});

router.post('/portfolios', requireAuth, async (req, res) => {
  const parsed = createPortfolioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId } = req.user!;
  const { name, parentPortfolioId } = parsed.data;

  try {
    const portfolio = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO portfolio (id, organization_id, name, parent_portfolio_id)
         VALUES (gen_random_uuid(), $1, $2, $3)
         RETURNING id, name, parent_portfolio_id`,
        [organizationId, name, parentPortfolioId ?? null]
      );
      return result.rows[0];
    });

    res.status(201).json(portfolio);
  } catch (err: any) {
    if (err.message?.includes('two levels')) {
      return res.status(409).json({ error: err.message });
    }
    console.error('Failed to create portfolio:', err);
    res.status(500).json({ error: 'Failed to create portfolio' });
  }
});

export default router;
