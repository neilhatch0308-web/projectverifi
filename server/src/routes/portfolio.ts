import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
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

router.post('/portfolios', requireAuth, requirePermission('org.manage'), async (req, res) => {
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

// ---------- Rename a portfolio (parent or sub) ----------
const renamePortfolioSchema = z.object({ name: z.string().min(1) });

router.patch('/portfolios/:id', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const parsed = renamePortfolioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    const portfolio = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE portfolio SET name = $1 WHERE id = $2 RETURNING id, name, parent_portfolio_id`,
        [parsed.data.name, id]
      );
      return result.rows[0];
    });

    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' });
    res.json(portfolio);
  } catch (err) {
    console.error('Failed to rename portfolio:', err);
    res.status(500).json({ error: 'Failed to rename portfolio' });
  }
});

// ---------- Delete a portfolio - only if genuinely unused ----------
// A portfolio can accumulate references across nearly every part of the
// app: demand raised against it or delivered by it, business cases,
// budget lines, annual plans, and immutable audit trails (transfers,
// adjustments, reassignment history). Deleting a portfolio with any of
// that on record would either silently orphan real data or force a
// cascading delete through audit history that's supposed to be
// permanent - neither is acceptable. So this checks every real
// reference first and refuses with a specific, itemised reason rather
// than either a cryptic FK error or a silent success that breaks
// something else.
router.delete('/portfolios/:id', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const usage = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM demand WHERE portfolio_id = $1) AS raised_demand,
           (SELECT COUNT(*) FROM demand WHERE delivering_sub_portfolio_id = $1) AS delivering_demand,
           (SELECT COUNT(*) FROM demand WHERE delivering_portfolio_id = $1) AS legacy_delivering_demand,
           (SELECT COUNT(*) FROM business_case WHERE portfolio_id = $1) AS business_cases,
           (SELECT COUNT(*) FROM portfolio_budget WHERE portfolio_id = $1) AS budgets,
           (SELECT COUNT(*) FROM annual_plan WHERE portfolio_id = $1) AS plans,
           (SELECT COUNT(*) FROM portfolio_budget_transfer WHERE from_portfolio_id = $1 OR to_portfolio_id = $1) AS transfers,
           (SELECT COUNT(*) FROM portfolio_budget_adjustment WHERE portfolio_id = $1) AS adjustments,
           (SELECT COUNT(*) FROM demand_portfolio_assignment_history WHERE from_sub_portfolio_id = $1 OR to_sub_portfolio_id = $1) AS reassignment_history,
           (SELECT COUNT(*) FROM portfolio WHERE parent_portfolio_id = $1) AS sub_portfolios`,
        [id]
      );

      const u = usage.rows[0];
      const blockers: string[] = [];
      if (Number(u.raised_demand) > 0) blockers.push(`${u.raised_demand} demand raised against it`);
      if (Number(u.delivering_demand) > 0) blockers.push(`${u.delivering_demand} demand delivered by it`);
      if (Number(u.legacy_delivering_demand) > 0) blockers.push(`${u.legacy_delivering_demand} demand (legacy field)`);
      if (Number(u.business_cases) > 0) blockers.push(`${u.business_cases} business case(s)`);
      if (Number(u.budgets) > 0) blockers.push(`${u.budgets} budget line(s)`);
      if (Number(u.plans) > 0) blockers.push(`${u.plans} annual plan(s)`);
      if (Number(u.transfers) > 0) blockers.push(`${u.transfers} budget transfer(s) in its history`);
      if (Number(u.adjustments) > 0) blockers.push(`${u.adjustments} budget adjustment(s) in its history`);
      if (Number(u.reassignment_history) > 0) blockers.push(`${u.reassignment_history} demand reassignment(s) in its history`);
      if (Number(u.sub_portfolios) > 0) blockers.push(`${u.sub_portfolios} sub-portfolio(s) under it`);

      if (blockers.length > 0) {
        return { blocked: true as const, blockers };
      }

      const deleted = await client.query(`DELETE FROM portfolio WHERE id = $1 RETURNING id`, [id]);
      return { blocked: false as const, deleted: deleted.rows[0] };
    });

    if (result.blocked) {
      return res.status(409).json({
        error: `Cannot delete - this portfolio has real usage: ${result.blockers.join(', ')}. Reassign or resolve these first.`,
      });
    }
    if (!result.deleted) return res.status(404).json({ error: 'Portfolio not found' });

    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete portfolio:', err);
    res.status(500).json({ error: 'Failed to delete portfolio' });
  }
});

export default router;