import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

class IncompleteScoring extends Error {
  constructor(public missingCriteria: string[]) {
    super('Every priority scoring category must be scored before a demand can be raised');
  }
}

// A permission check (or a validation rule) that only exists in the UI
// isn't a rule at all (decision 76) - the same applies to business
// rules, not just access control. This has to be enforced here, not
// just in RaiseDemand.tsx, or a direct API call bypasses it entirely.
class MissingFinancialMeasure extends Error {
  constructor(public criterionName: string, public scoreAwarded: number) {
    super(`A financial success measure is required when ${criterionName} is scored ${scoreAwarded}`);
  }
}

// ---------- Confidentiality guard for WRITE actions on a demand ----------
// Read paths (List, Detail, board, horizon, active-initiatives) already
// filter on can_view_confidential_demand(). This closes the matching gap
// on write actions: role-wide permissions like demand.triage/demand.assess/
// org.manage previously let anyone holding them act on a confidential
// demand by ID, even though they can't see it in any list. Returns true
// if the demand doesn't exist at all too - callers should fall through to
// their normal 404 in that case (this function isn't the existence check,
// just the visibility one on top of it).
async function assertCanAccessDemand(client: any, demandId: string | string[], userId: string): Promise<boolean> {
  const idParam = Array.isArray(demandId) ? demandId[0] : demandId;
  const result = await client.query(
    `SELECT (confidential = false OR can_view_confidential_demand(id, $2)) AS can_view
       FROM demand WHERE id = $1`,
    [idParam, userId]
  );
  const row = result.rows[0];
  if (!row) return true; // no row - let the caller's own existence check produce the 404
  return row.can_view;
}

// ---------- List ----------
router.get('/demands', requireAuth, async (req, res) => {
  const { organizationId, userId } = req.user!;

  try {
    const demands = await withTenantContext(organizationId, async (client) => {
      const result = await client.query(
        `SELECT d.id, d.title, d.status, d.raised_date, d.need_by_date,
                d.complexity_tier, d.cost_tier, d.date_driver_type,
                d.claimed_cost, d.claimed_benefit,
                d.stopped_at, d.confidential, d.raised_by,
                d.assigned_assessor_id, assessor.display_name AS assigned_assessor_name,
                a.assessed_cost, a.assessed_benefit,
                p.id AS portfolio_id, p.name AS portfolio_name,
                sub.id AS delivering_sub_portfolio_id, sub.name AS delivering_sub_portfolio_name,
                COALESCE(pv.weighted_score, 0) AS weighted_score,
                bc.id AS business_case_id, bc.decision AS business_case_decision,
                CASE
                  WHEN dd.benefit_realized_at IS NOT NULL THEN 'benefit_realized'
                  WHEN dd.adoption_measured_at IS NOT NULL THEN 'adoption_measured'
                  WHEN dd.delivery_completed_at IS NOT NULL THEN 'delivery_completed'
                  WHEN dd.delivery_started_at IS NOT NULL THEN 'delivery_started'
                  ELSE NULL
                END AS delivery_stage
         FROM demand d
         JOIN portfolio p ON p.id = d.portfolio_id
         LEFT JOIN portfolio sub ON sub.id = d.delivering_sub_portfolio_id
         LEFT JOIN demand_priority_view pv ON pv.demand_id = d.id
         LEFT JOIN demand_assessment a ON a.demand_id = d.id
         LEFT JOIN business_case bc ON bc.demand_id = d.id
         LEFT JOIN app_user assessor ON assessor.id = d.assigned_assessor_id
         LEFT JOIN demand_delivery dd ON dd.demand_id = d.id
         WHERE d.confidential = false OR can_view_confidential_demand(d.id, $1)
         ORDER BY d.raised_date DESC`,
        [userId]
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
// Fire-and-forget logging of a confidential-demand view. Deliberately
// runs in its OWN tenant context / connection, started only after the
// response has already been sent - a logging failure must never delay
// or fail the read it's logging (see demand_confidential_access_log's
// table comment in migration 55).
function logConfidentialAccess(organizationId: string, demandId: string | string[], userId: string) {
  const idParam = Array.isArray(demandId) ? demandId[0] : demandId;
  withTenantContext(organizationId, async (client) => {
    const basis = await client.query(
      `SELECT CASE
         WHEN EXISTS (SELECT 1 FROM demand WHERE id = $1 AND raised_by = $2) THEN 'raiser'
         WHEN EXISTS (SELECT 1 FROM demand_confidential_viewer WHERE demand_id = $1 AND user_id = $2) THEN 'named_viewer'
         WHEN EXISTS (SELECT 1 FROM demand WHERE id = $1 AND assigned_assessor_id = $2) THEN 'assessor'
         WHEN EXISTS (
           SELECT 1 FROM demand_raci r WHERE r.demand_id = $1
             AND $2 IN (r.accountable_financial_id, r.accountable_scope_id, r.accountable_schedule_id, r.sponsor_id, r.benefit_owner_id)
         ) THEN 'raci'
         WHEN EXISTS (
           SELECT 1 FROM business_case bc WHERE bc.demand_id = $1 AND $2 IN (bc.sponsor_user_id, bc.submitted_by)
         ) THEN 'business_case'
         ELSE 'unknown'
       END AS basis`,
      [idParam, userId]
    );
    await client.query(
      `INSERT INTO demand_confidential_access_log (id, organization_id, demand_id, viewed_by, access_basis)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [organizationId, idParam, userId, basis.rows[0].basis]
    );
  }).catch((err) => console.error('Failed to log confidential demand access (non-fatal):', err));
}

router.get('/demands/:id', requireAuth, async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const demandResult = await client.query(
        `SELECT d.id, d.title, d.description, d.outcome_statement, d.status,
                d.raised_date, d.need_by_date, d.accepted_at, d.adoption_change_type,
                d.complexity_tier, d.cost_tier, d.triaged_at, d.triage_notes,
                d.stop_reason, d.stopped_at,
                d.date_driver_type, d.date_driver_detail,
                d.claimed_cost, d.claimed_benefit,
                d.confidential, d.raised_by,
                d.target_start_year, d.target_start_quarter,
                d.target_end_year, d.target_end_quarter,
                EXISTS (
                  SELECT 1 FROM annual_plan_item api
                  JOIN annual_plan ap ON ap.id = api.plan_id
                  WHERE api.demand_id = d.id AND ap.status = 'agreed'
                ) AS target_year_locked_agreed,
                d.assigned_assessor_id, assigned_assessor.display_name AS assigned_assessor_name,
                p.id AS portfolio_id, p.name AS portfolio_name,
                sub.name AS delivering_sub_portfolio_name,
                subparent.name AS delivering_parent_portfolio_name,
                d.delivering_sub_portfolio_id,
                conceiver.display_name AS raised_by_name,
                sponsor.display_name AS sponsor_name,
                triager.display_name AS triaged_by_name,
                stopper.display_name AS stopped_by_name
         FROM demand d
         JOIN portfolio p ON p.id = d.portfolio_id
         LEFT JOIN portfolio sub ON sub.id = d.delivering_sub_portfolio_id
         LEFT JOIN portfolio subparent ON subparent.id = sub.parent_portfolio_id
         LEFT JOIN app_user assigned_assessor ON assigned_assessor.id = d.assigned_assessor_id
         LEFT JOIN app_user conceiver ON conceiver.id = d.raised_by
         LEFT JOIN app_user sponsor ON sponsor.id = d.sponsor_user_id
         LEFT JOIN app_user triager ON triager.id = d.triaged_by
         LEFT JOIN app_user stopper ON stopper.id = d.stopped_by
         WHERE d.id = $1`,
        [id]
      );

      const demand = demandResult.rows[0];
      if (!demand) return null;

      // Confidential demand is invisible to anyone who can't see it -
      // 404, not 403, so a lookup doesn't even confirm the demand
      // exists to someone who shouldn't see it.
      const canView = !demand.confidential || (await client.query(
        `SELECT can_view_confidential_demand($1, $2) AS can_view`,
        [id, userId]
      )).rows[0].can_view;
      if (!canView) return null;

      const criteriaResult = await client.query(
        `SELECT kd.id, kd.name, kd.dimension, kd.unit, kd.baseline_value, kd.target_value,
                ko.status AS outcome_status, ko.actual_value AS outcome_actual_value,
                ko.notes AS outcome_notes, ko.recorded_at AS outcome_recorded_at,
                ou.display_name AS outcome_recorded_by_name
           FROM kpi_definition kd
           LEFT JOIN kpi_outcome ko ON ko.kpi_definition_id = kd.id
           LEFT JOIN app_user ou ON ou.id = ko.recorded_by
          WHERE kd.demand_id = $1
          ORDER BY kd.dimension`,
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
        `SELECT sg.id AS strategic_goal_id, sg.name AS title, dgl.alignment_notes
         FROM demand_goal_link dgl
         JOIN strategic_goal sg ON sg.id = dgl.strategic_goal_id
         WHERE dgl.demand_id = $1`,
        [id]
      );

      const businessCaseResult = await client.query(
        `SELECT id FROM business_case WHERE demand_id = $1`, [id]
      );

      const assessmentResult = await client.query(
        `SELECT a.assessed_cost, a.assessed_benefit, a.cost_confidence, a.benefit_confidence,
                a.assessment_narrative, a.assessor_capacity, a.assessor_detail,
                a.recommendation, a.assessed_at,
                u.display_name AS assessed_by_name
         FROM demand_assessment a
         LEFT JOIN app_user u ON u.id = a.assessed_by
         WHERE a.demand_id = $1`,
        [id]
      );

      return {
        ...demand,
        criteria: criteriaResult.rows,
        raci: raciResult.rows[0] ?? null,
        scores: scoresResult.rows,
        priority: priorityResult.rows[0] ?? { total_score: 0, weighted_score: 0, criteria_scored: 0, criteria_available: 0 },
        strategyLinks: strategyResult.rows,
        businessCaseId: businessCaseResult.rows[0]?.id ?? null,
        assessment: assessmentResult.rows[0] ?? null,
      };
    });

    if (!result) return res.status(404).json({ error: 'Demand not found' });
    res.json(result);
    if (result.confidential) logConfidentialAccess(organizationId, id, userId);
  } catch (err) {
    console.error('Failed to fetch demand:', err);
    res.status(500).json({ error: 'Failed to fetch demand' });
  }
});

// ---------- Audit trail ----------
// Single chronological feed across every live audit source for this
// demand (demand_audit_trail, migration 55). Same visibility rule as
// every other confidential-demand read: if you can't see the demand,
// you can't see its history either - including the fact that history
// exists, hence 404 rather than 403.
router.get('/demands/:id/audit-trail', requireAuth, async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const canView = await assertCanAccessDemand(client, id, userId);
      if (!canView) return null;

      const exists = await client.query(`SELECT id FROM demand WHERE id = $1`, [id]);
      if (exists.rows.length === 0) return null;

      const trail = await client.query(
        `SELECT t.event_at, t.event_type, t.reference_id, t.prior_value, t.new_value, t.reason,
                u.display_name AS actor_name
           FROM demand_audit_trail t
           LEFT JOIN app_user u ON u.id = t.actor_id
          WHERE t.demand_id = $1
          ORDER BY t.event_at ASC`,
        [id]
      );
      return trail.rows;
    });

    if (result === null) return res.status(404).json({ error: 'Demand not found' });
    res.json(result);
  } catch (err) {
    console.error('Failed to fetch audit trail:', err);
    res.status(500).json({ error: 'Failed to fetch audit trail' });
  }
});

// ---------- Assign or reassign the delivering sub-portfolio ----------
// Not required at raise - assigned later, typically at assessment, and
// changeable up to planning. Every change is logged, consistent with
// budget transfers being recorded events rather than silent edits.
//
// Gated on demand.assess: this was previously open to ANY authenticated
// user regardless of role or the demand's stage - a real gap, since
// reassigning who delivers something is exactly the kind of call the
// Submitter baseline shouldn't be able to make on someone else's demand.
const assignSubPortfolioSchema = z.object({
  subPortfolioId: looseUuid().nullable(),
  reason: z.string().optional(),
});

// ---------- Shared: keep annual plan placement aligned with whoever
// currently owns delivery ----------
// Whenever the raising portfolio or delivering sub-portfolio changes,
// the demand's committed budget should move with it -- Front Office
// may have raised something that Back Office later took ownership of
// delivering, and it's Back Office's envelope that should carry the
// cost from that point on.
//
// Only moves items sitting in a DRAFT plan. An item in a Locked or
// Agreed plan is left where it is and stays visible with a
// portfolio_mismatch flag on the board (see /annual-plans/:id/board) --
// moving spend out from under an already-locked or agreed commitment
// is a bigger governance decision than a routine reassignment, and
// belongs to a human via mid-year revision, not an automatic side
// effect of changing a dropdown.
async function syncPlanPlacementToOwningPortfolio(
  client: any,
  organizationId: string,
  demandId: string,
  changedBy: string
) {
  const demandRow = await client.query(
    `SELECT d.portfolio_id, d.delivering_sub_portfolio_id, sub.parent_portfolio_id AS sub_parent_id
       FROM demand d
       LEFT JOIN portfolio sub ON sub.id = d.delivering_sub_portfolio_id
      WHERE d.id = $1`,
    [demandId]
  );
  if (demandRow.rows.length === 0) return;
  const { portfolio_id: raisingPortfolioId, sub_parent_id: subParentId } = demandRow.rows[0];
  const owningPortfolioId = subParentId ?? raisingPortfolioId;

  const staleItems = await client.query(
    `SELECT pi.id, pi.plan_id, pi.column_placement, pi.reason,
            ap.financial_year, ap.status, ap.portfolio_id AS plan_portfolio_id
       FROM annual_plan_item pi
       JOIN annual_plan ap ON ap.id = pi.plan_id
      WHERE pi.demand_id = $1
        AND ap.portfolio_id <> $2
        AND ap.status = 'draft'`,
    [demandId, owningPortfolioId]
  );

  for (const item of staleItems.rows) {
    let targetPlan = await client.query(
      `SELECT id FROM annual_plan
        WHERE portfolio_id = $1 AND financial_year = $2
        ORDER BY version DESC LIMIT 1`,
      [owningPortfolioId, item.financial_year]
    );
    let targetPlanId: string;
    if (targetPlan.rows.length > 0) {
      targetPlanId = targetPlan.rows[0].id;
    } else {
      const created = await client.query(
        `INSERT INTO annual_plan (id, organization_id, portfolio_id, financial_year, version, status, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, 1, 'draft', $4)
         RETURNING id`,
        [organizationId, owningPortfolioId, item.financial_year, changedBy]
      );
      targetPlanId = created.rows[0].id;
    }

    await client.query(
      `INSERT INTO annual_plan_item (id, plan_id, demand_id, column_placement, reason, moved_by, moved_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())
       ON CONFLICT (plan_id, demand_id)
       DO UPDATE SET column_placement = EXCLUDED.column_placement, reason = EXCLUDED.reason,
                      moved_by = EXCLUDED.moved_by, moved_at = now()`,
      [targetPlanId, demandId, item.column_placement, item.reason, changedBy]
    );

    await client.query(`DELETE FROM annual_plan_item WHERE id = $1`, [item.id]);
  }
}

router.patch('/demands/:id/delivering-sub-portfolio', requireAuth, requirePermission('demand.assess'), async (req, res) => {
  const parsed = assignSubPortfolioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { subPortfolioId, reason } = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const current = await client.query(
        `SELECT delivering_sub_portfolio_id FROM demand WHERE id = $1`, [id]
      );
      if (current.rows.length === 0) return null;
      if (!(await assertCanAccessDemand(client, id, userId))) return null;

      const previousSubPortfolioId = current.rows[0].delivering_sub_portfolio_id;

      const updated = await client.query(
        `UPDATE demand SET delivering_sub_portfolio_id = $1 WHERE id = $2
         RETURNING id, delivering_sub_portfolio_id`,
        [subPortfolioId, id]
      );

      await client.query(
        `INSERT INTO demand_portfolio_assignment_history
           (id, demand_id, from_sub_portfolio_id, to_sub_portfolio_id, reason, changed_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [id, previousSubPortfolioId, subPortfolioId, reason ?? null, userId]
      );

      await syncPlanPlacementToOwningPortfolio(client, organizationId, String(id), userId);

      return updated.rows[0];
    });

    if (!result) return res.status(404).json({ error: 'Demand not found' });
    res.json(result);
  } catch (err) {
    console.error('Failed to assign delivering sub-portfolio:', err);
    res.status(500).json({ error: 'Failed to assign delivering sub-portfolio' });
  }
});

// ---------- Reassign the raising portfolio ----------
// Distinct from delivering sub-portfolio reassignment above: this
// changes WHERE a demand was conceived (a parent portfolio), not who
// delivers it. Historically fixed at raise; made reassignable
// specifically so a portfolio being retired/deleted can have its
// demand moved elsewhere first, rather than being permanently
// undeletable. Gated on org.manage rather than demand.assess - this is
// portfolio administration, not demand triage/assessment work.
const reassignRaisingPortfolioSchema = z.object({
  portfolioId: looseUuid(),
  reason: z.string().optional(),
});

router.patch('/demands/:id/raising-portfolio', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const parsed = reassignRaisingPortfolioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { portfolioId, reason } = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const target = await client.query(`SELECT parent_portfolio_id FROM portfolio WHERE id = $1`, [portfolioId]);
      if (target.rows.length === 0) return { notFound: true as const };
      if (target.rows[0].parent_portfolio_id !== null) {
        return { wrongLevel: true as const };
      }

      const current = await client.query(`SELECT portfolio_id FROM demand WHERE id = $1`, [id]);
      if (current.rows.length === 0) return { notFound: true as const };
      // org.manage is deliberately NOT a confidential-demand override
      // (decision 74) - a portfolio being retired still can't be used
      // as a back door to move a confidential demand blind.
      if (!(await assertCanAccessDemand(client, id, userId))) return { notFound: true as const };
      const previousPortfolioId = current.rows[0].portfolio_id;

      const updated = await client.query(
        `UPDATE demand SET portfolio_id = $1 WHERE id = $2 RETURNING id, portfolio_id`,
        [portfolioId, id]
      );

      await client.query(
        `INSERT INTO demand_raising_portfolio_reassignment
           (id, demand_id, from_portfolio_id, to_portfolio_id, reason, changed_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [id, previousPortfolioId, portfolioId, reason ?? null, userId]
      );

      await syncPlanPlacementToOwningPortfolio(client, organizationId, String(id), userId);

      return { demand: updated.rows[0] };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Demand or portfolio not found' });
    if ('wrongLevel' in result) return res.status(400).json({ error: 'Raising portfolio must be a parent portfolio, not a sub-portfolio' });
    res.json(result.demand);
  } catch (err) {
    console.error('Failed to reassign raising portfolio:', err);
    res.status(500).json({ error: 'Failed to reassign raising portfolio' });
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
  portfolioId: looseUuid('Select the raising portfolio'),
  deliveringSubPortfolioId: looseUuid().optional(),
  sponsorUserId: looseUuid('Select a sponsor'),
  needByDate: z.string().optional(),
  adoptionChangeType: z.enum(['process', 'tool', 'both']).nullable().optional(),
  dateDriverType: z.enum(['regulatory', 'audit_finding', 'contractual', 'product_launch', 'none']).optional(),
  dateDriverDetail: z.string().optional(),
  claimedCost: z.number().min(0, 'Give your best estimate of cost'),
  claimedBenefit: z.number().min(0, 'Give your best estimate of benefit'),
  confidential: z.boolean().optional().default(false),
  confidentialViewerIds: z.array(looseUuid()).optional(),
  criteria: z.array(criterionSchema).min(1, 'Add at least one success measure'),
  scores: z.array(scoreSchema).min(1, 'Priority scoring is required'),
  strategicGoalId: looseUuid().optional(),
  alignmentNotes: z.string().optional(),
  targetStartYear: z.number().int().optional(),
  targetStartQuarter: z.number().int().min(1).max(4).nullable().optional(),
});

router.post('/demands', requireAuth, async (req, res) => {
  const parsed = createDemandSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const {
    title, description, outcomeStatement, portfolioId, deliveringSubPortfolioId, sponsorUserId, needByDate,
    adoptionChangeType, dateDriverType, dateDriverDetail, claimedCost, claimedBenefit,
    confidential, confidentialViewerIds, criteria, scores, strategicGoalId, alignmentNotes,
    targetStartYear, targetStartQuarter,
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

      // A high Financial/Revenue Impact score means the financial case
      // for this demand matters enough that it must have its own
      // measurable success criterion, not just be implied by whichever
      // dimension(s) the raiser happened to pick. Matched by NAME, not a
      // fixed criterion id, since scoring criteria are tenant-configurable
      // (same acknowledged trade-off as the Finance Impact Assessment
      // trigger on governance_tier.added_documents - a case-insensitive
      // string match, not a first-class flag. If the criterion is ever
      // renamed to drop "financial"/"revenue" entirely, this silently
      // stops firing - worth a real flag column if that becomes a problem).
      const financialTrigger = activeCriteria.rows.find((c) => /financial|revenue/i.test(c.name));
      if (financialTrigger) {
        const financialScore = scores.find((s) => s.criterionId === financialTrigger.id);
        if (financialScore && financialScore.scoreAwarded >= 15) {
          const hasFinancialMeasure = criteria.some((c) => c.dimension === 'financial');
          if (!hasFinancialMeasure) {
            throw new MissingFinancialMeasure(financialTrigger.name, financialScore.scoreAwarded);
          }
        }
      }
      const demandResult = await client.query(
        `INSERT INTO demand
           (id, organization_id, portfolio_id, delivering_sub_portfolio_id, title, description, outcome_statement,
            raised_by, sponsor_user_id, need_by_date, raised_date, status,
            adoption_change_type, date_driver_type, date_driver_detail,
            claimed_cost, claimed_benefit, confidential,
            target_start_year, target_start_quarter, target_end_year, target_end_quarter,
            target_year_set_by, target_year_set_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, 'raised', $10, $11, $12, $13, $14, $15,
                 $16, $17, $16, $17,
                 CASE WHEN $16::int IS NOT NULL THEN $7::uuid ELSE NULL::uuid END,
                 CASE WHEN $16::int IS NOT NULL THEN now() ELSE NULL::timestamptz END)
         RETURNING id, title, status, raised_date`,
        [organizationId, portfolioId, deliveringSubPortfolioId ?? null, title, description, outcomeStatement, userId, sponsorUserId,
         needByDate ?? null, adoptionChangeType ?? null, dateDriverType ?? 'none', dateDriverDetail ?? null,
         claimedCost, claimedBenefit, confidential,
         targetStartYear ?? null, targetStartQuarter ?? null]
      );

      const newDemand = demandResult.rows[0];

      if (confidential && confidentialViewerIds && confidentialViewerIds.length > 0) {
        for (const viewerId of confidentialViewerIds) {
          if (viewerId === userId) continue; // raiser already has visibility structurally, no need for a row
          await client.query(
            `INSERT INTO demand_confidential_viewer (id, organization_id, demand_id, user_id, added_by)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)
             ON CONFLICT (demand_id, user_id) DO NOTHING`,
            [organizationId, newDemand.id, viewerId, userId]
          );
        }
      }

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
    if (err instanceof MissingFinancialMeasure) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Failed to create demand:', err);
    res.status(500).json({ error: 'Failed to create demand' });
  }
});

// ---------- Triage decision: Accept or Reject, with required assessment ----------
// Complexity and cost tiers are captured HERE, at the point of accepting -
// not before, and not optionally. Triage now only ever moves a demand
// forward to 'accepted' - killing a demand, at any stage, goes through
// the separate /stop action below instead. Sizing something you've
// decided not to do never made sense as a required field anyway.
const triageDecisionSchema = z.object({
  complexityTier: z.enum(['high', 'medium', 'low']),
  costTier: z.enum(['high', 'medium', 'low']),
  notes: z.string().optional(),
  assignedAssessorId: looseUuid().optional(),
});

router.post('/demands/:id/triage', requireAuth, requirePermission('demand.triage'), async (req, res) => {
  const parsed = triageDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { complexityTier, costTier, notes, assignedAssessorId } = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const check = await client.query(`SELECT status FROM demand WHERE id = $1`, [id]);
      const current = check.rows[0];

      if (!current) return { notFound: true as const };
      if (!(await assertCanAccessDemand(client, id, userId))) return { notFound: true as const };
      if (current.status !== 'raised') {
        return { wrongStatus: true as const, actual: current.status };
      }

      const updated = await client.query(
        `UPDATE demand
         SET status = 'accepted', complexity_tier = $1, cost_tier = $2,
             triaged_by = $3, triaged_at = now(), triage_notes = $4,
             assigned_assessor_id = $5
         WHERE id = $6
         RETURNING id, title, status, complexity_tier, cost_tier, assigned_assessor_id`,
        [complexityTier, costTier, userId, notes ?? null, assignedAssessorId ?? null, id]
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

// ---------- Reassign the tagged assessor ----------
// Independent of triage - lets PMO retag who should run the P75
// assessment without re-triaging the whole demand. Null clears the
// tag, making it open to anyone with demand.assess again.
const assignAssessorSchema = z.object({ assessorId: looseUuid().nullable() });

router.patch('/demands/:id/assessor', requireAuth, requirePermission('demand.triage'), async (req, res) => {
  const parsed = assignAssessorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const exists = await client.query(`SELECT id FROM demand WHERE id = $1`, [id]);
      if (exists.rows.length === 0) return { notFound: true as const };
      if (!(await assertCanAccessDemand(client, id, userId))) return { notFound: true as const };

      const updated = await client.query(
        `UPDATE demand SET assigned_assessor_id = $1 WHERE id = $2
         RETURNING id, assigned_assessor_id`,
        [parsed.data.assessorId, id]
      );
      return { demand: updated.rows[0] };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Demand not found' });
    res.json(result.demand);
  } catch (err) {
    console.error('Failed to reassign assessor:', err);
    res.status(500).json({ error: 'Failed to reassign assessor' });
  }
});

// ---------- Assessment (P75) ----------
// Every accepted demand goes through this - no threshold, no skipping.
// The assessor states their own figures ALONGSIDE the preserved claim;
// the original is never overwritten. The delta is the artifact.
const assessmentSchema = z.object({
  assessedCost: z.number().min(0),
  assessedBenefit: z.number().min(0),
  costConfidence: z.enum(['low', 'medium', 'high']),
  benefitConfidence: z.enum(['low', 'medium', 'high']),
  assessmentNarrative: z.string().min(1, 'Explain what changed from the claim, or why it stands'),
  assessorCapacity: z.enum(['portfolio_lead', 'business_analyst', 'technical_consultant', 'project_manager', 'third_party', 'other']),
  assessorDetail: z.string().optional(),
  recommendation: z.enum(['proceed', 'stop', 'no_recommendation']),
});

router.post('/demands/:id/assessment', requireAuth, requirePermission('demand.assess'), async (req, res) => {
  const parsed = assessmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const a = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const check = await client.query(`SELECT status FROM demand WHERE id = $1`, [id]);
      const current = check.rows[0];

      if (!current) return { notFound: true as const };
      if (!(await assertCanAccessDemand(client, id, userId))) return { notFound: true as const };
      if (current.status !== 'accepted') {
        return { wrongStatus: true as const, actual: current.status };
      }

      await client.query(
        `INSERT INTO demand_assessment
           (id, demand_id, assessed_cost, assessed_benefit, cost_confidence, benefit_confidence,
            assessment_narrative, assessed_by, assessor_capacity, assessor_detail, recommendation)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, a.assessedCost, a.assessedBenefit, a.costConfidence, a.benefitConfidence,
         a.assessmentNarrative, userId, a.assessorCapacity, a.assessorDetail ?? null, a.recommendation]
      );

      const updated = await client.query(
        `UPDATE demand SET status = 'assessed' WHERE id = $1 RETURNING id, title, status`,
        [id]
      );

      return { demand: updated.rows[0] };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Demand not found' });
    if ('wrongStatus' in result) {
      return res.status(409).json({ error: `Only an accepted demand can be assessed (currently: ${result.actual})` });
    }

    res.json(result.demand);
  } catch (err) {
    console.error('Failed to record assessment:', err);
    res.status(500).json({ error: 'Failed to record assessment' });
  }
});

// ---------- Stop a demand ----------
// Reachable from ANY pre-promotion stage - raised, accepted, or
// assessed. This is now the single kill action for demand that hasn't
// reached a business case yet; the previous 'rejected' (triage-only)
// status is gone. The distinction that used to live in the status word
// now lives in the reason: "not the right time" and "economics don't
// work" are both just a stop_reason, not different statuses.
const stopSchema = z.object({ reason: z.string().min(1, 'A reason is required to stop a demand') });

router.post('/demands/:id/stop', requireAuth, requirePermission('demand.triage'), async (req, res) => {
  const parsed = stopSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const exists = await client.query(`SELECT id FROM demand WHERE id = $1`, [id]);
      if (exists.rows.length === 0) return { notFound: true as const };
      if (!(await assertCanAccessDemand(client, id, userId))) return { notFound: true as const };

      const updated = await client.query(
        `UPDATE demand SET status = 'stopped', stop_reason = $1, stopped_by = $2, stopped_at = now()
         WHERE id = $3 AND status IN ('raised', 'accepted', 'assessed')
         RETURNING id, title, status`,
        [parsed.data.reason, userId, id]
      );
      if (!updated.rows[0]) return { wrongStatus: true as const };
      return { demand: updated.rows[0] };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Demand not found' });
    if ('wrongStatus' in result) return res.status(409).json({ error: 'This demand cannot be stopped from its current status' });
    res.json(result.demand);
  } catch (err) {
    console.error('Failed to stop demand:', err);
    res.status(500).json({ error: 'Failed to stop demand' });
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

router.post('/demands/:id/accept', requireAuth, requirePermission('demand.triage'), async (req, res) => {
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
      if (!(await assertCanAccessDemand(client, id, userId))) return { notFound: true as const };
      if (current.status !== 'assessed') {
        return { wrongStatus: true as const, actual: current.status };
      }

      await client.query(
        `INSERT INTO demand_raci
           (id, demand_id, accountable_financial_id, accountable_scope_id, accountable_schedule_id, sponsor_id, benefit_owner_id, set_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [id, seats.accountableFinancialId, seats.accountableScopeId, seats.accountableScheduleId, seats.sponsorId, seats.benefitOwnerId, userId]
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
      return res.status(409).json({ error: `Demand must be assessed before RACI naming (currently: ${result.actual})` });
    }

    res.json({ ...result.demand, businessCaseId: result.businessCaseId });
  } catch (err) {
    console.error('Failed to accept demand:', err);
    res.status(500).json({ error: 'Failed to accept demand' });
  }
});

// ---------- Confidential demand named viewers ----------
// Only someone who can already see the demand may view, add to, or
// remove from its named-viewer list - the same rule as seeing the
// demand itself, since the list of who's trusted is part of what's
// being protected. Structural access (raiser, tagged assessor, RACI
// seats, business case sponsor/submitter) is shown for transparency
// but can't be removed here - that's a consequence of reassigning the
// underlying role, not a row in this table.
router.get('/demands/:id/confidential-viewers', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { organizationId, userId } = req.user!;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const demandRow = await client.query(`SELECT confidential, raised_by FROM demand WHERE id = $1`, [id]);
      if (demandRow.rows.length === 0) return { notFound: true as const };
      const demand = demandRow.rows[0];

      if (demand.confidential) {
        const canView = (await client.query(`SELECT can_view_confidential_demand($1, $2) AS can_view`, [id, userId])).rows[0].can_view;
        if (!canView) return { notFound: true as const }; // 404, not 403 - don't confirm it exists
      }

      const named = await client.query(
        `SELECT v.user_id, u.display_name, v.added_at, adder.display_name AS added_by_name
           FROM demand_confidential_viewer v
           JOIN app_user u ON u.id = v.user_id
           LEFT JOIN app_user adder ON adder.id = v.added_by
          WHERE v.demand_id = $1
          ORDER BY v.added_at`,
        [id]
      );

      const structural = await client.query(
        `SELECT r.accountable_financial_id, r.accountable_scope_id, r.accountable_schedule_id,
                r.sponsor_id, r.benefit_owner_id
           FROM demand_raci r WHERE r.demand_id = $1`,
        [id]
      );

      return { demand, named: named.rows, raci: structural.rows[0] ?? null };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Demand not found' });
    res.json(result);
  } catch (err) {
    console.error('Failed to fetch confidential viewers:', err);
    res.status(500).json({ error: 'Failed to fetch confidential viewers' });
  }
});

const addViewerSchema = z.object({ userId: looseUuid() });

router.post('/demands/:id/confidential-viewers', requireAuth, async (req, res) => {
  const { id } = req.params;
  const parsed = addViewerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const demandRow = await client.query(`SELECT confidential FROM demand WHERE id = $1`, [id]);
      if (demandRow.rows.length === 0) return { notFound: true as const };

      const canView = (await client.query(`SELECT can_view_confidential_demand($1, $2) AS can_view`, [id, userId])).rows[0].can_view;
      if (!canView) return { notFound: true as const };

      await client.query(
        `INSERT INTO demand_confidential_viewer (id, organization_id, demand_id, user_id, added_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         ON CONFLICT (demand_id, user_id) DO NOTHING`,
        [organizationId, id, parsed.data.userId, userId]
      );
      return { ok: true as const };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Demand not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to add confidential viewer:', err);
    res.status(500).json({ error: 'Failed to add confidential viewer' });
  }
});

router.delete('/demands/:id/confidential-viewers/:userId', requireAuth, async (req, res) => {
  const { id, userId: targetUserId } = req.params;
  const { organizationId, userId } = req.user!;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const demandRow = await client.query(`SELECT confidential FROM demand WHERE id = $1`, [id]);
      if (demandRow.rows.length === 0) return { notFound: true as const };

      const canView = (await client.query(`SELECT can_view_confidential_demand($1, $2) AS can_view`, [id, userId])).rows[0].can_view;
      if (!canView) return { notFound: true as const };

      // Capture the grant before it's gone -- demand_confidential_viewer_
      // revocation exists precisely so "this person was once trusted with
      // this demand" survives the delete, not just "they aren't now".
      const grant = await client.query(
        `DELETE FROM demand_confidential_viewer WHERE demand_id = $1 AND user_id = $2
         RETURNING added_by, added_at`,
        [id, targetUserId]
      );
      if (grant.rows.length > 0) {
        await client.query(
          `INSERT INTO demand_confidential_viewer_revocation
             (id, organization_id, demand_id, user_id, originally_added_by, originally_added_at, revoked_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
          [organizationId, id, targetUserId, grant.rows[0].added_by, grant.rows[0].added_at, userId]
        );
      }
      return { ok: true as const };
    });

    if ('notFound' in result) return res.status(404).json({ error: 'Demand not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to remove confidential viewer:', err);
    res.status(500).json({ error: 'Failed to remove confidential viewer' });
  }
});

export default router;

// ---------- Editing optional-at-raise fields, while still raised ----------
// Date driver, strategic goal alignment, and adoption change type are all
// optional at raise - someone might not know the goal link yet, or
// whether this is externally date-driven, at the moment they first
// write the demand up. Every other field on this app is either locked
// immediately (claimed_cost, target years' first value) or locked once
// a specific gate fires (kpi_definition after acceptance, via
// trg_block_criterion_edit). These three had no edit path at all -
// frozen the instant they were raised, stricter than intended.
//
// This opens a genuine, bounded editing window: settable/changeable
// right up until triage moves the demand to 'accepted', then locked -
// matching "optional at raise, refinable before anyone's acted on it,
// closed once the process moves on". Gated to the raiser themselves
// (the Submitter baseline's "view/edit own", the implicit floor every
// user already has) or anyone holding demand.triage, who may want to
// tidy these up just before triaging it themselves.
const editRaiseDetailsSchema = z.object({
  adoptionChangeType: z.enum(['process', 'tool', 'both']).nullable().optional(),
  dateDriverType: z.enum(['regulatory', 'audit_finding', 'contractual', 'product_launch', 'none']).optional(),
  dateDriverDetail: z.string().nullable().optional(),
  strategicGoalId: looseUuid().nullable().optional(),
  alignmentNotes: z.string().nullable().optional(),
});

router.patch('/demands/:id/raise-details', requireAuth, async (req, res) => {
  const parsed = editRaiseDetailsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { adoptionChangeType, dateDriverType, dateDriverDetail, strategicGoalId, alignmentNotes } = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const existing = await client.query(`SELECT status, raised_by FROM demand WHERE id = $1`, [id]);
      if (existing.rows.length === 0) return { status: 404 as const };
      if (!(await assertCanAccessDemand(client, id, userId))) return { status: 404 as const };

      const { status, raised_by } = existing.rows[0];
      const permissions = req.user!.permissions ?? [];
      const isRaiser = raised_by === userId;
      if (!isRaiser && !permissions.includes('demand.triage')) {
        return { status: 403 as const };
      }
      if (status !== 'raised') {
        return { status: 409 as const, error: `These fields can only be changed while a demand is still Raised (currently: ${status})` };
      }

      if (adoptionChangeType !== undefined || dateDriverType !== undefined || dateDriverDetail !== undefined) {
        await client.query(
          `UPDATE demand SET
             adoption_change_type = COALESCE($1, adoption_change_type),
             date_driver_type = COALESCE($2, date_driver_type),
             date_driver_detail = CASE WHEN $3::text IS NOT NULL THEN NULLIF($3, '') ELSE date_driver_detail END
           WHERE id = $4`,
          [adoptionChangeType ?? null, dateDriverType ?? null, dateDriverDetail ?? null, id]
        );
      }

      // Strategic goal link is a single optional row (demand_goal_link
      // has a UNIQUE demand_id) - replacing it means delete-then-insert
      // rather than update-in-place, same as how the raise route treats
      // it as create-only today.
      if (strategicGoalId !== undefined) {
        await client.query(`DELETE FROM demand_goal_link WHERE demand_id = $1`, [id]);
        if (strategicGoalId) {
          await client.query(
            `INSERT INTO demand_goal_link (id, demand_id, strategic_goal_id, alignment_notes, linked_by)
             VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
            [id, strategicGoalId, alignmentNotes ?? null, userId]
          );
        }
      } else if (alignmentNotes !== undefined) {
        await client.query(`UPDATE demand_goal_link SET alignment_notes = $1 WHERE demand_id = $2`, [alignmentNotes, id]);
      }

      return { status: 200 as const };
    });

    if (result.status === 404) return res.status(404).json({ error: 'Demand not found' });
    if (result.status === 403) return res.status(403).json({ error: 'Only the raiser or someone who can triage may edit these fields' });
    if (result.status === 409) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to update raise details:', err);
    res.status(500).json({ error: 'Failed to update raise details' });
  }
});

// ---------- Success measure outcomes: was it met? ----------
// One row per kpi_definition (kpi_outcome, migration 63). First
// recording needs no reason (no prior judgement to justify a change
// from) - changing an EXISTING recorded outcome does, logged to
// kpi_outcome_revision, same anchored-claim-with-gated-rebase shape
// used everywhere else in this schema.
const kpiOutcomeSchema = z.object({
  status: z.enum(['met', 'partially_met', 'not_met']),
  actualValue: z.number().optional(),
  notes: z.string().optional(),
  reason: z.string().optional(),
});

router.put('/kpi-definitions/:id/outcome', requireAuth, requirePermission('delivery.edit'), async (req, res) => {
  const parsed = kpiOutcomeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { status, actualValue, notes, reason } = parsed.data;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      // Resolve the owning demand (directly, or via the business case
      // this KPI was carried forward onto at promotion) so the usual
      // confidentiality check applies here exactly as everywhere else.
      const owner = await client.query(
        `SELECT COALESCE(kd.demand_id, bc.demand_id) AS demand_id
           FROM kpi_definition kd
           LEFT JOIN business_case bc ON bc.id = kd.business_case_id
          WHERE kd.id = $1`,
        [id]
      );
      if (owner.rows.length === 0 || !owner.rows[0].demand_id) return { status: 404 as const };
      const demandId = owner.rows[0].demand_id;
      if (!(await assertCanAccessDemand(client, demandId, userId))) return { status: 404 as const };

      const existing = await client.query(
        `SELECT id, status, actual_value FROM kpi_outcome WHERE kpi_definition_id = $1`,
        [id]
      );

      if (existing.rows.length === 0) {
        const inserted = await client.query(
          `INSERT INTO kpi_outcome (id, organization_id, kpi_definition_id, status, actual_value, notes, recorded_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
           RETURNING id, status, actual_value, notes, recorded_at`,
          [organizationId, id, status, actualValue ?? null, notes ?? null, userId]
        );
        return { status: 200 as const, row: inserted.rows[0] };
      }

      const prior = existing.rows[0];
      // NaN !== NaN is always true in JS, so comparing via Number(x ?? NaN)
      // would wrongly report "changed" every time actualValue is left
      // empty on both the old and new save. Normalize to null instead.
      const priorActual = prior.actual_value === null ? null : Number(prior.actual_value);
      const newActual = actualValue === undefined ? null : Number(actualValue);
      const changed = prior.status !== status || priorActual !== newActual;
      if (changed && (!reason || !reason.trim())) {
        return { status: 400 as const, error: 'A reason is required to change a previously recorded outcome, and it will be logged.' };
      }

      if (changed) {
        await client.query(
          `INSERT INTO kpi_outcome_revision
             (id, organization_id, kpi_outcome_id, prior_status, new_status, prior_actual_value, new_actual_value, reason, changed_by)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
          [organizationId, prior.id, prior.status, status, prior.actual_value, actualValue ?? null, reason, userId]
        );
      }

      const updated = await client.query(
        `UPDATE kpi_outcome SET status = $1, actual_value = $2, notes = $3, recorded_by = $4, recorded_at = now()
          WHERE id = $5
          RETURNING id, status, actual_value, notes, recorded_at`,
        [status, actualValue ?? null, notes ?? null, userId, prior.id]
      );
      return { status: 200 as const, row: updated.rows[0] };
    });

    if (result.status === 404) return res.status(404).json({ error: 'Success measure not found' });
    if (result.status === 400) return res.status(400).json({ error: result.error });
    res.json(result.row);
  } catch (err) {
    console.error('Failed to record success measure outcome:', err);
    res.status(500).json({ error: 'Failed to record success measure outcome' });
  }
});