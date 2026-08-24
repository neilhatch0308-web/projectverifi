import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

class IncompleteScoring extends Error {
  constructor(public missingCriteria: string[]) {
    super('Every priority scoring category must be scored before a demand can be raised');
  }
}

// ---------- List ----------
router.get('/demands', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;

  try {
    const demands = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT d.id, d.title, d.status, d.raised_date, d.need_by_date,
                d.complexity_tier, d.cost_tier,
                p.id AS portfolio_id, p.name AS portfolio_name,
                COALESCE(pv.weighted_score, 0) AS weighted_score
         FROM demand d
         JOIN portfolio p ON p.id = d.portfolio_id
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

// ---------- Detail ----------
router.get('/demands/:id', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const demandResult = await client.query(
        `SELECT d.id, d.title, d.description, d.outcome_statement, d.status,
                d.raised_date, d.need_by_date, d.accepted_at, d.adoption_change_type,
                d.complexity_tier, d.cost_tier, d.triaged_at, d.triage_notes,
                p.name AS portfolio_name,
                conceiver.display_name AS raised_by_name,
                sponsor.display_name AS sponsor_name,
                triager.display_name AS triaged_by_name
         FROM demand d
         JOIN portfolio p ON p.id = d.portfolio_id
         LEFT JOIN app_user conceiver ON conceiver.id = d.raised_by
         LEFT JOIN app_user sponsor ON sponsor.id = d.sponsor_user_id
         LEFT JOIN app_user triager ON triager.id = d.triaged_by
         WHERE d.id = $1`,
        [id]
      );

      const demand = demandResult.rows[0];
      if (!demand) return null;

      const criteriaResult = await client.query(
        `SELECT id, name, dimension, unit, baseline_value, target_value
         FROM kpi_definition WHERE demand_id = $1 ORDER BY dimension`,
        [id]
      );

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
        [id]
      );

      const scoresResult = await client.query(
        `SELECT sc.name AS criterion_name, sc.max_points, sc.weight_pct,
                ds.score_awarded, ds.rationale
         FROM demand_score ds
         JOIN scoring_criterion sc ON sc.id = ds.criterion_id
         WHERE ds.demand_id = $1
         ORDER BY sc.weight_pct DESC NULLS LAST`,
        [id]
      );

      const priorityResult = await client.query(
        `SELECT total_score, weighted_score, criteria_scored, criteria_available
         FROM demand_priority_view WHERE demand_id = $1`,
        [id]
      );

      const strategyResult = await client.query(
        `SELECT sg.name AS title, dgl.alignment_notes
         FROM demand_goal_link dgl
         JOIN strategic_goal sg ON sg.id = dgl.strategic_goal_id
         WHERE dgl.demand_id = $1`,
        [id]
      );

      const businessCaseResult = await client.query(
        `SELECT id FROM business_case WHERE demand_id = $1`, [id]
      );

      return {
        ...demand,
        criteria: criteriaResult.rows,
        raci: raciResult.rows[0] ?? null,
        scores: scoresResult.rows,
        priority: priorityResult.rows[0] ?? { total_score: 0, weighted_score: 0, criteria_scored: 0, criteria_available: 0 },
        strategyLinks: strategyResult.rows,
        businessCaseId: businessCaseResult.rows[0]?.id ?? null,
      };
    });

    if (!result) return res.status(404).json({ error: 'Demand not found' });
    res.json(result);
  } catch (err) {
    console.error('Failed to fetch demand:', err);
    res.status(500).json({ error: 'Failed to fetch demand' });
  }
});

// ---------- Create ----------
// Baseline/target must genuinely be numeric - Postgres's numeric type
// accepts the literal value NaN, so Number("42 days") silently stored
// the word "NaN" in the database rather than failing at insert. This
// rejects anything that doesn't parse cleanly, before it ever reaches SQL.
const numericString = z.string().optional().refine(
  (v) => v === undefined || v === '' || (!isNaN(Number(v)) && isFinite(Number(v))),
  'Must be a plain number'
);

const criterionSchema = z.object({
  dimension: z.enum(['delivery', 'adoption', 'business', 'financial']),
  measure: z.string().min(1, 'Describe what success looks like for this measure'),
  baselineValue: numericString,
  targetValue: numericString,
  unit: z.string().optional(),
});

const scoreSchema = z.object({
  criterionId: looseUuid(),
  scoreAwarded: z.number().min(0).max(20),
  rationale: z.string().optional(),
});

const createDemandSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Problem statement is required'),
  outcomeStatement: z.string().min(1, 'Need and output is required'),
  portfolioId: looseUuid('Select a business group / area'),
  sponsorUserId: looseUuid('Select a sponsor'),
  needByDate: z.string().optional(),
  adoptionChangeType: z.enum(['process', 'tool', 'both']).nullable().optional(),
  criteria: z.array(criterionSchema).min(1, 'Add at least one success measure'),
  scores: z.array(scoreSchema).min(1, 'Priority scoring is required'),
  strategicGoalId: looseUuid().optional(),
  alignmentNotes: z.string().optional(),
});

router.post('/demands', requireAuth, async (req, res) => {
  const parsed = createDemandSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const {
    title, description, outcomeStatement, portfolioId, sponsorUserId, needByDate,
    adoptionChangeType, criteria, scores, strategicGoalId, alignmentNotes,
  } = parsed.data;
  const { userId, organizationId } = req.user!;

  try {
    const demand = await withTenantContext(organizationId, async (client) => {
      // Every currently active scoring criterion must be scored - not a
      // hardcoded count, since criteria are tenant-configurable and could
      // change. A demand can't be raised with some categories skipped.
      const activeCriteria = await client.query(
        `SELECT id, name FROM scoring_criterion WHERE organization_id = $1 AND active = true`,
        [organizationId]
      );
      const scoredIds = new Set(scores.map((s) => s.criterionId));
      const missing = activeCriteria.rows.filter((c) => !scoredIds.has(c.id));
      if (missing.length > 0) {
        throw new IncompleteScoring(missing.map((c) => c.name));
      }
      const demandResult = await client.query(
        `INSERT INTO demand
           (id, organization_id, portfolio_id, title, description, outcome_statement,
            raised_by, sponsor_user_id, need_by_date, raised_date, size_tier, status, adoption_change_type)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, 'unsized', 'raised', $9)
         RETURNING id, title, status, raised_date`,
        [organizationId, portfolioId, title, description, outcomeStatement, userId, sponsorUserId, needByDate ?? null, adoptionChangeType ?? null]
      );

      const newDemand = demandResult.rows[0];

      for (const c of criteria) {
        await client.query(
          `INSERT INTO kpi_definition
             (id, demand_id, name, dimension, kpi_type, unit, baseline_value, target_value, owner_user_id)
           VALUES (gen_random_uuid(), $1, $2, $3, 'lagging', $4, $5, $6, $7)`,
          [newDemand.id, c.measure, c.dimension, c.unit ?? null,
           c.baselineValue ? Number(c.baselineValue) : null,
           c.targetValue ? Number(c.targetValue) : null, userId]
        );
      }

      for (const s of scores) {
        await client.query(
          `INSERT INTO demand_score (id, demand_id, criterion_id, score_awarded, rationale, scored_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
          [newDemand.id, s.criterionId, s.scoreAwarded, s.rationale ?? null, userId]
        );
      }

      if (strategicGoalId) {
        await client.query(
          `INSERT INTO demand_goal_link (id, demand_id, strategic_goal_id, alignment_notes, linked_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
          [newDemand.id, strategicGoalId, alignmentNotes ?? null, userId]
        );
      }

      return newDemand;
    });

    res.status(201).json(demand);
  } catch (err) {
    if (err instanceof IncompleteScoring) {
      return res.status(400).json({
        error: `Priority scoring is incomplete - missing: ${err.missingCriteria.join(', ')}`,
      });
    }
    console.error('Failed to create demand:', err);
    res.status(500).json({ error: 'Failed to create demand' });
  }
});

// ---------- Triage decision: Accept or Reject, with required assessment ----------
// Complexity and cost tiers are captured HERE, at the point of decision -
// not before, and not optionally. Both outcomes (accepted/rejected)
// require the assessment to have actually happened, not just a status flip.
const triageDecisionSchema = z.object({
  decision: z.enum(['accepted', 'rejected']),
  complexityTier: z.enum(['high', 'medium', 'low']),
  costTier: z.enum(['high', 'medium', 'low']),
  notes: z.string().optional(),
});

router.post('/demands/:id/triage', requireAuth, async (req, res) => {
  const parsed = triageDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { decision, complexityTier, costTier, notes } = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const check = await client.query(`SELECT status FROM demand WHERE id = $1`, [id]);
      const current = check.rows[0];

      if (!current) return { notFound: true as const };
      if (current.status !== 'raised') {
        return { wrongStatus: true as const, actual: current.status };
      }

      const updated = await client.query(
        `UPDATE demand
         SET status = $1, complexity_tier = $2, cost_tier = $3,
             triaged_by = $4, triaged_at = now(), triage_notes = $5
         WHERE id = $6
         RETURNING id, title, status, complexity_tier, cost_tier`,
        [decision, complexityTier, costTier, userId, notes ?? null, id]
      );

      return { demand: updated.rows[0] };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Demand not found' });
    if ('wrongStatus' in result) {
      return res.status(409).json({ error: `Only a demand still at 'raised' can be triaged (currently: ${result.actual})` });
    }

    res.json(result.demand);
  } catch (err) {
    console.error('Failed to record triage decision:', err);
    res.status(500).json({ error: 'Failed to record triage decision' });
  }
});

// ---------- Acceptance ----------
const acceptDemandSchema = z.object({
  accountableFinancialId: looseUuid(),
  accountableScopeId: looseUuid(),
  accountableScheduleId: looseUuid(),
  sponsorId: looseUuid(),
  benefitOwnerId: looseUuid(),
});

router.post('/demands/:id/accept', requireAuth, async (req, res) => {
  const parsed = acceptDemandSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId } = req.user!;
  const { id } = req.params;
  const seats = parsed.data;

  const { userId } = req.user!;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const demandCheck = await client.query(
        `SELECT status, title, portfolio_id, sponsor_user_id FROM demand WHERE id = $1`, [id]
      );
      const current = demandCheck.rows[0];

      if (!current) return { notFound: true as const };
      if (current.status !== 'accepted') {
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

      // A business case is created automatically the moment RACI naming
      // completes - "promoted" IS "a business case now exists." Nothing
      // for a user to separately click to create one.
      const businessCase = await client.query(
        `INSERT INTO business_case
           (id, organization_id, portfolio_id, demand_id, title, sponsor_user_id, submitted_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [organizationId, current.portfolio_id, id, current.title, current.sponsor_user_id, userId]
      );

      return { demand: updated.rows[0], businessCaseId: businessCase.rows[0].id };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Demand not found' });
    if ('wrongStatus' in result) {
      return res.status(409).json({ error: `Demand must be accepted at triage before RACI naming (currently: ${result.actual})` });
    }

    res.json({ ...result.demand, businessCaseId: result.businessCaseId });
  } catch (err) {
    console.error('Failed to accept demand:', err);
    res.status(500).json({ error: 'Failed to accept demand' });
  }
});

export default router;