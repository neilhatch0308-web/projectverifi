import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

// ---------- Budgets for a financial year, with transfers applied ----------
router.get('/portfolio-budgets', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  try {
    const budgets = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT portfolio_budget_id, portfolio_id, portfolio_name, financial_year,
                allocated_amount, transferred_in, transferred_out, effective_amount
         FROM portfolio_effective_budget
         WHERE financial_year = $1
         ORDER BY portfolio_name`,
        [year]
      );
      return result.rows;
    });

    res.json(budgets);
  } catch (err) {
    console.error('Failed to fetch portfolio budgets:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio budgets' });
  }
});

// ---------- Set or update a portfolio's allocation ----------
const setBudgetSchema = z.object({
  portfolioId: looseUuid(),
  financialYear: z.number().int(),
  allocatedAmount: z.number().min(0),
});

router.put('/portfolio-budgets', requireAuth, async (req, res) => {
  const parsed = setBudgetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { portfolioId, financialYear, allocatedAmount } = parsed.data;

  try {
    const budget = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO portfolio_budget (id, organization_id, portfolio_id, financial_year, allocated_amount, set_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
         ON CONFLICT (portfolio_id, financial_year)
         DO UPDATE SET allocated_amount = EXCLUDED.allocated_amount, set_by = EXCLUDED.set_by, set_at = now()
         RETURNING id, portfolio_id, financial_year, allocated_amount`,
        [organizationId, portfolioId, financialYear, allocatedAmount, userId]
      );
      return result.rows[0];
    });

    res.json(budget);
  } catch (err) {
    console.error('Failed to set portfolio budget:', err);
    res.status(500).json({ error: 'Failed to set portfolio budget' });
  }
});

// ---------- Record a transfer between portfolio lines ----------
// Deliberately an event with a reason and approver, not two numbers
// quietly edited - a transfer six months ago is invisible otherwise.
const transferSchema = z.object({
  financialYear: z.number().int(),
  fromPortfolioId: looseUuid(),
  toPortfolioId: looseUuid(),
  amount: z.number().positive('Transfer amount must be greater than zero'),
  reason: z.string().min(1, 'A reason is required for a budget transfer'),
  relatedDemandId: looseUuid().optional(),
}).refine((d) => d.fromPortfolioId !== d.toPortfolioId, {
  message: 'Cannot transfer budget to the same portfolio',
});

router.post('/portfolio-budgets/transfers', requireAuth, async (req, res) => {
  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const t = parsed.data;

  try {
    const transfer = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO portfolio_budget_transfer
           (id, organization_id, financial_year, from_portfolio_id, to_portfolio_id,
            amount, reason, related_demand_id, approved_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, amount, reason, transferred_at`,
        [organizationId, t.financialYear, t.fromPortfolioId, t.toPortfolioId,
         t.amount, t.reason, t.relatedDemandId ?? null, userId]
      );
      return result.rows[0];
    });

    res.status(201).json(transfer);
  } catch (err) {
    console.error('Failed to record budget transfer:', err);
    res.status(500).json({ error: 'Failed to record budget transfer' });
  }
});

// ---------- Transfer history for a year ----------
router.get('/portfolio-budgets/transfers', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();

  try {
    const transfers = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT t.id, t.amount, t.reason, t.transferred_at,
                fp.name AS from_portfolio_name, tp.name AS to_portfolio_name,
                d.title AS related_demand_title,
                u.display_name AS approved_by_name
         FROM portfolio_budget_transfer t
         JOIN portfolio fp ON fp.id = t.from_portfolio_id
         JOIN portfolio tp ON tp.id = t.to_portfolio_id
         LEFT JOIN demand d ON d.id = t.related_demand_id
         LEFT JOIN app_user u ON u.id = t.approved_by
         WHERE t.financial_year = $1
         ORDER BY t.transferred_at DESC`,
        [year]
      );
      return result.rows;
    });

    res.json(transfers);
  } catch (err) {
    console.error('Failed to fetch budget transfers:', err);
    res.status(500).json({ error: 'Failed to fetch budget transfers' });
  }
});

export default router;
