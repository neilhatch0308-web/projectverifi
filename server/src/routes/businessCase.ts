import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

// ---------- Detail ----------
// RACI is read via the linked demand (demand_raci) - not a separate
// business_case_raci naming step. See 21_business_case.sql.
router.get('/business-cases/:id', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const bcResult = await client.query(
        `SELECT bc.id, bc.title, bc.requested_spend, bc.decision, bc.decision_date,
                bc.demand_id, p.name AS portfolio_name,
                sponsor.display_name AS sponsor_name,
                submitter.display_name AS submitted_by_name
         FROM business_case bc
         JOIN portfolio p ON p.id = bc.portfolio_id
         LEFT JOIN app_user sponsor ON sponsor.id = bc.sponsor_user_id
         LEFT JOIN app_user submitter ON submitter.id = bc.submitted_by
         WHERE bc.id = $1`,
        [id]
      );

      const businessCase = bcResult.rows[0];
      if (!businessCase) return null;

      const raciResult = await client.query(
        `SELECT fin.display_name AS accountable_financial_name,
                scope.display_name AS accountable_scope_name,
                sched.display_name AS accountable_schedule_name,
                sponsor.display_name AS sponsor_name,
                benefit.display_name AS benefit_owner_name
         FROM demand_raci r
         JOIN app_user fin ON fin.id = r.accountable_financial_id
         JOIN app_user scope ON scope.id = r.accountable_scope_id
         JOIN app_user sched ON sched.id = r.accountable_schedule_id
         JOIN app_user sponsor ON sponsor.id = r.sponsor_id
         JOIN app_user benefit ON benefit.id = r.benefit_owner_id
         WHERE r.demand_id = $1`,
        [businessCase.demand_id]
      );

      const investmentResult = await client.query(
        `SELECT approved_amount, actual_spend_to_date FROM investment WHERE business_case_id = $1`,
        [id]
      );

      const benefitsResult = await client.query(
        `SELECT b.id, b.title, b.benefit_type, b.claimed_value, b.status, owner.display_name AS owner_name
         FROM benefit b
         LEFT JOIN app_user owner ON owner.id = b.owner_user_id
         WHERE b.business_case_id = $1
         ORDER BY b.title`,
        [id]
      );

      return {
        ...businessCase,
        raci: raciResult.rows[0] ?? null,
        investment: investmentResult.rows[0] ?? null,
        benefits: benefitsResult.rows,
      };
    });

    if (!result) return res.status(404).json({ error: 'Business case not found' });
    res.json(result);
  } catch (err) {
    console.error('Failed to fetch business case:', err);
    res.status(500).json({ error: 'Failed to fetch business case' });
  }
});

// ---------- Set requested spend ----------
const requestedSpendSchema = z.object({ requestedSpend: z.number().min(0) });

router.patch('/business-cases/:id/requested-spend', requireAuth, async (req, res) => {
  const parsed = requestedSpendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE business_case SET requested_spend = $1 WHERE id = $2 RETURNING id, requested_spend`,
        [parsed.data.requestedSpend, id]
      );
      return result.rows[0];
    });

    if (!updated) return res.status(404).json({ error: 'Business case not found' });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update requested spend:', err);
    res.status(500).json({ error: 'Failed to update requested spend' });
  }
});

// ---------- Investment (approved amount / actual spend to date) - upsert ----------
const investmentSchema = z.object({
  approvedAmount: z.number().min(0).optional(),
  actualSpendToDate: z.number().min(0).optional(),
});

router.put('/business-cases/:id/investment', requireAuth, async (req, res) => {
  const parsed = investmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId } = req.user!;
  const { id } = req.params;
  const { approvedAmount, actualSpendToDate } = parsed.data;

  try {
    const investment = await withTenantContext(organizationId, async (client) => {
      const existing = await client.query(`SELECT business_case_id FROM investment WHERE business_case_id = $1`, [id]);

      if (existing.rows.length > 0) {
        const result = await client.query(
          `UPDATE investment SET
             approved_amount = COALESCE($1, approved_amount),
             actual_spend_to_date = COALESCE($2, actual_spend_to_date)
           WHERE business_case_id = $3
           RETURNING approved_amount, actual_spend_to_date`,
          [approvedAmount ?? null, actualSpendToDate ?? null, id]
        );
        return result.rows[0];
      }

      const result = await client.query(
        `INSERT INTO investment (business_case_id, approved_amount, actual_spend_to_date)
         VALUES ($1, $2, $3)
         RETURNING approved_amount, actual_spend_to_date`,
        [id, approvedAmount ?? 0, actualSpendToDate ?? 0]
      );
      return result.rows[0];
    });

    res.json(investment);
  } catch (err) {
    console.error('Failed to update investment:', err);
    res.status(500).json({ error: 'Failed to update investment' });
  }
});

// ---------- Add a benefit line ----------
const addBenefitSchema = z.object({
  title: z.string().min(1),
  benefitType: z.string().min(1),
  claimedValue: z.number().optional(),
  ownerUserId: looseUuid(),
});

router.post('/business-cases/:id/benefits', requireAuth, async (req, res) => {
  const parsed = addBenefitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId } = req.user!;
  const { id } = req.params;
  const { title, benefitType, claimedValue, ownerUserId } = parsed.data;

  try {
    const benefit = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO benefit (id, business_case_id, title, benefit_type, claimed_value, owner_user_id, status)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'forecast')
         RETURNING id, title, benefit_type, claimed_value, status`,
        [id, title, benefitType, claimedValue ?? null, ownerUserId]
      );
      return result.rows[0];
    });

    res.status(201).json(benefit);
  } catch (err) {
    console.error('Failed to add benefit:', err);
    res.status(500).json({ error: 'Failed to add benefit' });
  }
});

// ---------- Decision: approve or decline the requested spend ----------
// A DIFFERENT question from the earlier triage accept/reject - that was
// "is this idea worth pursuing." This is "is this specific spend approved."
const decisionSchema = z.object({ decision: z.enum(['approved', 'declined']) });

router.post('/business-cases/:id/decision', requireAuth, async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE business_case SET decision = $1, decision_date = CURRENT_DATE
         WHERE id = $2 RETURNING id, decision, decision_date`,
        [parsed.data.decision, id]
      );
      return result.rows[0];
    });

    if (!updated) return res.status(404).json({ error: 'Business case not found' });
    res.json(updated);
  } catch (err) {
    console.error('Failed to record decision:', err);
    res.status(500).json({ error: 'Failed to record decision' });
  }
});

export default router;
