import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';

const router = Router();

// ---------- List ----------
router.get('/demands', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const demands = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT d.id, d.title, d.status, d.raised_date,
                COALESCE(pv.total_score, 0) AS total_score
         FROM demand d
         LEFT JOIN demand_priority_view pv ON pv.demand_id = d.id
         ORDER BY d.raised_date DESC`
      );
      return result.rows;
    });

    res.json(demands);
  } catch (err) {
    console.error('Failed to fetch demands:', err);
    res.status(500).json({ error: 'Failed to fetch demands' });
  }
});

// ---------- Detail (includes criteria, RACI, and priority score) ----------
router.get('/demands/:id', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const demandResult = await client.query(
        `SELECT d.id, d.title, d.description, d.status, d.raised_date, d.accepted_at,
                d.adoption_change_type, p.name AS portfolio_name,
                au.display_name AS raised_by_name
         FROM demand d
         JOIN portfolio p ON p.id = d.portfolio_id
         LEFT JOIN app_user au ON au.id = d.raised_by
         WHERE d.id = $1`,
        [id]
      );

      const demand = demandResult.rows[0];
      if (!demand) return null;

      const criteriaResult = await client.query(
        `SELECT id, name, dimension, unit, baseline_value, target_value
         FROM kpi_definition
         WHERE demand_id = $1
         ORDER BY dimension`,
        [id]
      );

      const raciResult = await client.query(
        `SELECT
            fin.display_name AS accountable_financial_name,
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
        [id]
      );

      const scoresResult = await client.query(
        `SELECT sc.name AS criterion_name, sc.max_points, ds.score_awarded, ds.rationale
         FROM demand_score ds
         JOIN scoring_criterion sc ON sc.id = ds.criterion_id
         WHERE ds.demand_id = $1
         ORDER BY sc.max_points DESC`,
        [id]
      );

      const priorityResult = await client.query(
        `SELECT total_score, criteria_scored, criteria_available FROM demand_priority_view WHERE demand_id = $1`,
        [id]
      );

      return {
        ...demand,
        criteria: criteriaResult.rows,
        raci: raciResult.rows[0] ?? null,
        scores: scoresResult.rows,
        priority: priorityResult.rows[0] ?? { total_score: 0, criteria_scored: 0, criteria_available: 0 },
      };
    });

    if (!result) {
      return res.status(404).json({ error: 'Demand not found' });
    }

    res.json(result);
  } catch (err) {
    console.error('Failed to fetch demand:', err);
    res.status(500).json({ error: 'Failed to fetch demand' });
  }
});

// ---------- Create (demand + criteria + priority scores, one transaction) ----------
const criterionSchema = z.object({
  dimension: z.enum(['delivery', 'adoption', 'business', 'financial']),
  measure: z.string().min(1, 'Describe what success looks like for this measure'),
  baselineValue: z.string().optional(),
  targetValue: z.string().optional(),
  unit: z.string().optional(),
});

const scoreSchema = z.object({
  criterionId: z.string().uuid(),
  scoreAwarded: z.number().min(0),
  rationale: z.string().optional(),
});

const createDemandSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  portfolioId: z.string().uuid('Select a division'),
  adoptionChangeType: z.enum(['process', 'tool', 'both']).nullable().optional(),
  criteria: z.array(criterionSchema).min(1, 'Add at least one success measure'),
  scores: z.array(scoreSchema).optional().default([]),
});

router.post('/demands', requireAuth, async (req, res) => {
  const parsed = createDemandSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { title, description, portfolioId, adoptionChangeType, criteria, scores } = parsed.data;
  const { userId, organizationId } = req.user!;

  try {
    const demand = await withTenantContext(organizationId, async (client) => {
      const demandResult = await client.query(
        `INSERT INTO demand
           (id, organization_id, portfolio_id, title, description, raised_by, raised_date, size_tier, status, adoption_change_type)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CURRENT_DATE, 'unsized', 'raised', $6)
         RETURNING id, title, status, raised_date`,
        [organizationId, portfolioId, title, description, userId, adoptionChangeType ?? null]
      );

      const newDemand = demandResult.rows[0];

      for (const c of criteria) {
        await client.query(
          `INSERT INTO kpi_definition
             (id, demand_id, name, dimension, kpi_type, unit, baseline_value, target_value, owner_user_id)
           VALUES (gen_random_uuid(), $1, $2, $3, 'lagging', $4, $5, $6, $7)`,
          [
            newDemand.id,
            c.measure,
            c.dimension,
            c.unit ?? null,
            c.baselineValue ? Number(c.baselineValue) : null,
            c.targetValue ? Number(c.targetValue) : null,
            userId,
          ]
        );
      }

      for (const s of scores) {
        await client.query(
          `INSERT INTO demand_score (id, demand_id, criterion_id, score_awarded, rationale, scored_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
          [newDemand.id, s.criterionId, s.scoreAwarded, s.rationale ?? null, userId]
        );
      }

      return newDemand;
    });

    res.status(201).json(demand);
  } catch (err) {
    console.error('Failed to create demand:', err);
    res.status(500).json({ error: 'Failed to create demand' });
  }
});

// ---------- Status transition (raised<->triaged<->rejected only - NOT promoted, see /accept) ----------
const SIMPLE_STATUSES = ['triaged', 'rejected'] as const;
const updateStatusSchema = z.object({
  status: z.enum(SIMPLE_STATUSES),
});

router.patch('/demands/:id/status', requireAuth, async (req, res) => {
  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { organizationId } = req.user!;
  const { id } = req.params;
  const { status } = parsed.data;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `UPDATE demand SET status = $1 WHERE id = $2 RETURNING id, title, status`,
        [status, id]
      );
      return result.rows[0];
    });

    if (!updated) {
      return res.status(404).json({ error: 'Demand not found' });
    }

    res.json(updated);
  } catch (err) {
    console.error('Failed to update demand status:', err);
    res.status(500).json({ error: 'Failed to update demand status' });
  }
});

// ---------- Acceptance ----------
const acceptDemandSchema = z.object({
  accountableFinancialId: z.string().uuid(),
  accountableScopeId: z.string().uuid(),
  accountableScheduleId: z.string().uuid(),
  sponsorId: z.string().uuid(),
  benefitOwnerId: z.string().uuid(),
});

router.post('/demands/:id/accept', requireAuth, async (req, res) => {
  const parsed = acceptDemandSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { organizationId } = req.user!;
  const { id } = req.params;
  const seats = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const demandCheck = await client.query(`SELECT status FROM demand WHERE id = $1`, [id]);
      const current = demandCheck.rows[0];

      if (!current) return { notFound: true as const };
      if (current.status !== 'triaged') {
        return { wrongStatus: true as const, actual: current.status };
      }

      await client.query(
        `INSERT INTO demand_raci
           (id, demand_id, accountable_financial_id, accountable_scope_id, accountable_schedule_id, sponsor_id, benefit_owner_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [id, seats.accountableFinancialId, seats.accountableScopeId, seats.accountableScheduleId, seats.sponsorId, seats.benefitOwnerId]
      );

      const updated = await client.query(
        `UPDATE demand SET status = 'promoted', accepted_at = now() WHERE id = $1 RETURNING id, title, status, accepted_at`,
        [id]
      );

      return { demand: updated.rows[0] };
    });

    if ('notFound' in result) {
      return res.status(404).json({ error: 'Demand not found' });
    }
    if ('wrongStatus' in result) {
      return res.status(409).json({ error: `Demand must be triaged before acceptance (currently: ${result.actual})` });
    }

    res.json(result.demand);
  } catch (err) {
    console.error('Failed to accept demand:', err);
    res.status(500).json({ error: 'Failed to accept demand' });
  }
});

export default router;
