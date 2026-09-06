import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';

const router = Router();

// ---------- Confidentiality guard, shared by every endpoint below ----------
// A business case inherits its demand's confidentiality. Someone who
// holds business_case.edit/view/decide generally but isn't on the
// linked demand's viewer list must not be able to read OR write it -
// otherwise a coarse business-case permission would be a silent
// bypass of the restricted viewer list this was built for. Returns
// null (caller should 404) if the business case doesn't exist or the
// requester can't see the demand it belongs to.
async function assertCanAccessBusinessCase(client: any, businessCaseId: string | string[], userId: string): Promise<string | null> {
  const idParam = Array.isArray(businessCaseId) ? businessCaseId[0] : businessCaseId;
  const result = await client.query(
    `SELECT bc.demand_id, d.confidential,
            (d.confidential = false OR can_view_confidential_demand(d.id, $2)) AS can_view
       FROM business_case bc
       JOIN demand d ON d.id = bc.demand_id
      WHERE bc.id = $1`,
    [idParam, userId]
  );
  const row = result.rows[0];
  if (!row || !row.can_view) return null;
  return row.demand_id;
}

// ---------- Post-approval revision logging ----------
// Once a business case is decided (approved), requested_spend,
// approved_amount, the benefit register, and new risks stop being
// freely editable -- see 54_business_case_revision.sql. This doesn't
// block the change; it requires a reason and logs it. Returns the
// business case's current decision so callers can branch on it, and
// throws a typed error the route handlers turn into a 400 if a reason
// was required but missing.
class RevisionReasonRequiredError extends Error {}

async function getBusinessCaseDecision(client: any, businessCaseId: string | string[]): Promise<string> {
  const idParam = Array.isArray(businessCaseId) ? businessCaseId[0] : businessCaseId;
  const result = await client.query(`SELECT decision FROM business_case WHERE id = $1`, [idParam]);
  return result.rows[0]?.decision ?? 'pending';
}

async function logRevisionIfApproved(
  client: any,
  organizationId: string,
  businessCaseId: string | string[],
  userId: string,
  field: 'requested_spend' | 'approved_amount' | 'benefit_added' | 'benefit_edited' | 'risk_added',
  reason: string | undefined,
  priorValue: unknown,
  newValue: unknown,
  referenceId?: string
): Promise<void> {
  const idParam = Array.isArray(businessCaseId) ? businessCaseId[0] : businessCaseId;
  const decision = await getBusinessCaseDecision(client, idParam);
  if (decision !== 'approved') return; // Still being built -- free editing, nothing to log.

  if (!reason || !reason.trim()) {
    throw new RevisionReasonRequiredError(
      'This business case is approved. A reason is required to make this change, and it will be logged.'
    );
  }

  await client.query(
    `INSERT INTO business_case_revision
       (id, organization_id, business_case_id, field, reference_id, prior_value, new_value, reason, changed_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [organizationId, idParam, field, referenceId ?? null, JSON.stringify(priorValue), JSON.stringify(newValue), reason, userId]
  );
}

// ---------- Governance requirements (cumulative, cost-tiered) ----------
// Every tier whose min_threshold <= spend contributes its added_approvers
// and added_documents to the effective set - see 31_governance_tiers_and_
// finance_impact.sql for the cumulative model this implements. Shared by
// both the JSON detail endpoint and the PDF export so they can never drift.
async function computeGovernanceRequirements(client: any, organizationId: string, spend: number | null) {
  const effectiveSpend = spend ?? 0;

  const result = await client.query(
    `WITH applicable AS (
       SELECT * FROM governance_tier
       WHERE organization_id = $1 AND min_threshold <= $2
     )
     SELECT
       (SELECT COALESCE(array_agg(DISTINCT a ORDER BY a), '{}') FROM applicable, unnest(added_approvers) AS a) AS required_approvers,
       (SELECT COALESCE(array_agg(DISTINCT d ORDER BY d), '{}') FROM applicable, unnest(added_documents) AS d) AS required_documents,
       (SELECT name FROM applicable ORDER BY min_threshold DESC LIMIT 1) AS highest_tier_name,
       (SELECT min_threshold FROM applicable ORDER BY min_threshold DESC LIMIT 1) AS highest_tier_threshold`,
    [organizationId, effectiveSpend]
  );

  const row = result.rows[0] ?? { required_approvers: [], required_documents: [], highest_tier_name: null, highest_tier_threshold: null };

  const requiresFinanceImpactAssessment = (row.required_documents ?? []).some(
    (d: string) => d.toLowerCase().includes('finance impact assessment')
  );

  return { ...row, requiresFinanceImpactAssessment };
}

// ---------- Detail ----------
// RACI is read via the linked demand (demand_raci) - not a separate
// business_case_raci naming step. See 21_business_case.sql.
router.get('/business-cases/:id', requireAuth, requirePermission('business_case.view'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const canView = await assertCanAccessBusinessCase(client, id, userId);
      if (!canView) return null; // 404, not 403 - matches the demand's own confidentiality behavior

      const bcResult = await client.query(
        `SELECT bc.id, bc.title, bc.requested_spend, bc.decision, bc.decision_date,
                bc.demand_id, bc.executive_summary, bc.problem_statement,
                p.name AS portfolio_name,
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
        `SELECT b.id, b.title, b.benefit_type, b.claimed_value, b.status,
                b.recurrence, b.duration_years, owner.display_name AS owner_name
         FROM benefit b
         LEFT JOIN app_user owner ON owner.id = b.owner_user_id
         WHERE b.business_case_id = $1
         ORDER BY b.title`,
        [id]
      );

      // Strategic goal alignment - already captured at demand stage
      // (demand_goal_link), not re-asked here. Surfaced read-only.
      const goalResult = await client.query(
        `SELECT sg.name AS goal_name, sg.goal_year, dgl.alignment_notes
         FROM demand_goal_link dgl
         JOIN strategic_goal sg ON sg.id = dgl.strategic_goal_id
         WHERE dgl.demand_id = $1`,
        [businessCase.demand_id]
      );

      // Estimate movement - reads the already-anchored P50/P75 figures
      // rather than duplicating financial entry here.
      const estimateResult = await client.query(
        `SELECT claimed_cost, claimed_benefit, assessed_cost, assessed_benefit,
                cost_confidence, benefit_confidence
         FROM demand_estimate_movement WHERE demand_id = $1`,
        [businessCase.demand_id]
      );

      const risksResult = await client.query(
        `SELECT r.id, r.description, r.category, r.likelihood, r.impact,
                r.mitigation, r.status, r.created_at,
                owner.display_name AS owner_name
         FROM business_case_risk r
         LEFT JOIN app_user owner ON owner.id = r.owner_user_id
         WHERE r.business_case_id = $1
         ORDER BY r.created_at DESC`,
        [id]
      );

      const governance = await computeGovernanceRequirements(client, organizationId, businessCase.requested_spend);

      const fiaResult = await client.query(
        `SELECT fia.id, funding_source, cost_centre, capex_amount, opex_amount,
                ongoing_annual_cost, funding_period_months, financial_narrative,
                status, prepared_at,
                prep.display_name AS prepared_by_name
         FROM finance_impact_assessment fia
         LEFT JOIN app_user prep ON prep.id = fia.prepared_by
         WHERE fia.business_case_id = $1`,
        [id]
      );

      return {
        ...businessCase,
        raci: raciResult.rows[0] ?? null,
        investment: investmentResult.rows[0] ?? null,
        benefits: benefitsResult.rows,
        strategicGoal: goalResult.rows[0] ?? null,
        estimate: estimateResult.rows[0] ?? null,
        risks: risksResult.rows,
        governance,
        financeImpactAssessment: fiaResult.rows[0] ?? null,
      };
    });

    if (!result) return res.status(404).json({ error: 'Business case not found' });
    res.json(result);
  } catch (err) {
    console.error('Failed to fetch business case:', err);
    res.status(500).json({ error: 'Failed to fetch business case' });
  }
});

// ---------- Update narrative (executive summary / problem statement) ----------
const narrativeSchema = z.object({
  executiveSummary: z.string().optional(),
  problemStatement: z.string().optional(),
});

router.patch('/business-cases/:id/narrative', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = narrativeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { executiveSummary, problemStatement } = parsed.data;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const canAccess = await assertCanAccessBusinessCase(client, id, userId);
      if (!canAccess) return null;

      const result = await client.query(
        `UPDATE business_case SET
           executive_summary = COALESCE($1, executive_summary),
           problem_statement = COALESCE($2, problem_statement)
         WHERE id = $3
         RETURNING id, executive_summary, problem_statement`,
        [executiveSummary ?? null, problemStatement ?? null, id]
      );
      return result.rows[0];
    });

    if (!updated) return res.status(404).json({ error: 'Business case not found' });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update narrative:', err);
    res.status(500).json({ error: 'Failed to update narrative' });
  }
});

// ---------- Set requested spend ----------
const requestedSpendSchema = z.object({ requestedSpend: z.number().min(0), reason: z.string().optional() });

router.patch('/business-cases/:id/requested-spend', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = requestedSpendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const canAccess = await assertCanAccessBusinessCase(client, id, userId);
      if (!canAccess) return null;

      const before = await client.query(`SELECT requested_spend FROM business_case WHERE id = $1`, [id]);
      const priorValue = before.rows[0]?.requested_spend ?? null;

      await logRevisionIfApproved(client, organizationId, id, userId, 'requested_spend', parsed.data.reason, priorValue, parsed.data.requestedSpend);

      const result = await client.query(
        `UPDATE business_case SET requested_spend = $1 WHERE id = $2 RETURNING id, requested_spend`,
        [parsed.data.requestedSpend, id]
      );
      return result.rows[0];
    });

    if (!updated) return res.status(404).json({ error: 'Business case not found' });
    res.json(updated);
  } catch (err) {
    if (err instanceof RevisionReasonRequiredError) return res.status(400).json({ error: err.message });
    console.error('Failed to update requested spend:', err);
    res.status(500).json({ error: 'Failed to update requested spend' });
  }
});

// ---------- Investment (approved amount / actual spend to date) - upsert ----------
const investmentSchema = z.object({
  approvedAmount: z.number().min(0).optional(),
  actualSpendToDate: z.number().min(0).optional(),
  reason: z.string().optional(),
});

router.put('/business-cases/:id/investment', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = investmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { approvedAmount, actualSpendToDate, reason } = parsed.data;

  try {
    const investment = await withTenantContext(organizationId, async (client) => {
      const existing = await client.query(`SELECT business_case_id, approved_amount FROM investment WHERE business_case_id = $1`, [id]);

      // approved_amount is the anchored baseline -- only log a revision
      // when it's actually changing (not just re-sending the same
      // value, and not the very first time it's ever set).
      if (existing.rows.length > 0 && approvedAmount !== undefined && Number(existing.rows[0].approved_amount) !== approvedAmount) {
        await logRevisionIfApproved(client, organizationId, id, userId, 'approved_amount', reason, existing.rows[0].approved_amount, approvedAmount);
      }

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
    if (err instanceof RevisionReasonRequiredError) return res.status(400).json({ error: err.message });
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
  recurrence: z.enum(['one_time', 'annual', 'multi_year_lump_sum']),
  durationYears: z.number().int().positive().optional(),
  reason: z.string().optional(),
}).refine(
  (data) => (data.recurrence === 'one_time') === (data.durationYears === undefined),
  { message: 'duration_years is required for annual/multi_year_lump_sum and must be omitted for one_time.' }
);

router.post('/business-cases/:id/benefits', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = addBenefitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { title, benefitType, claimedValue, ownerUserId, recurrence, durationYears, reason } = parsed.data;

  try {
    const benefit = await withTenantContext(organizationId, async (client) => {
      const canAccess = await assertCanAccessBusinessCase(client, id, userId);
      if (!canAccess) return null;

      const result = await client.query(
        `INSERT INTO benefit (id, business_case_id, title, benefit_type, claimed_value, owner_user_id, status, recurrence, duration_years)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'forecast', $6, $7)
         RETURNING id, title, benefit_type, claimed_value, status, recurrence, duration_years`,
        [id, title, benefitType, claimedValue ?? null, ownerUserId, recurrence, durationYears ?? null]
      );
      const row = result.rows[0];

      // A new benefit added after approval is net-new scope on an
      // already-decided case -- always worth a reason, not just a
      // value change, so this logs on the insert itself.
      await logRevisionIfApproved(client, organizationId, id, userId, 'benefit_added', reason, null, row, row.id);

      return row;
    });

    if (!benefit) return res.status(404).json({ error: 'Business case not found' });
    res.status(201).json(benefit);
  } catch (err) {
    if (err instanceof RevisionReasonRequiredError) return res.status(400).json({ error: err.message });
    console.error('Failed to add benefit:', err);
    res.status(500).json({ error: 'Failed to add benefit' });
  }
});

// ---------- Edit an existing benefit ----------
// Didn't exist before this migration -- benefits could only ever be
// created, never corrected or (critically) reclassified. Needed so
// legacy rows left NULL by migration 49 can actually be reviewed, not
// just flagged forever with no way to act on the flag.
const editBenefitSchema = z.object({
  title: z.string().min(1).optional(),
  claimedValue: z.number().optional(),
  recurrence: z.enum(['one_time', 'annual', 'multi_year_lump_sum']).optional(),
  durationYears: z.number().int().positive().nullable().optional(),
  reason: z.string().optional(),
}).refine(
  (data) => {
    if (!data.recurrence) return true; // not changing recurrence -- duration_years handled independently
    return (data.recurrence === 'one_time') === (data.durationYears == null);
  },
  { message: 'duration_years is required for annual/multi_year_lump_sum and must be omitted for one_time.' }
);

router.patch('/business-cases/:id/benefits/:benefitId', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const { id, benefitId } = req.params;
  const parsed = editBenefitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { title, claimedValue, recurrence, durationYears, reason } = parsed.data;

  try {
    const benefit = await withTenantContext(organizationId, async (client) => {
      const canAccess = await assertCanAccessBusinessCase(client, id, userId);
      if (!canAccess) return null;

      const before = await client.query(
        `SELECT title, claimed_value, recurrence, duration_years FROM benefit WHERE id = $1 AND business_case_id = $2`,
        [benefitId, id]
      );
      if (before.rows.length === 0) return null;

      await logRevisionIfApproved(client, organizationId, id, userId, 'benefit_edited', reason, before.rows[0], parsed.data, Array.isArray(benefitId) ? benefitId[0] : benefitId);

      const result = await client.query(
        `UPDATE benefit SET
           title = COALESCE($1, title),
           claimed_value = COALESCE($2, claimed_value),
           recurrence = COALESCE($3, recurrence),
           duration_years = CASE WHEN $3::text IS NOT NULL THEN $4 ELSE duration_years END,
           updated_at = now()
         WHERE id = $5 AND business_case_id = $6
         RETURNING id, title, benefit_type, claimed_value, status, recurrence, duration_years`,
        [title ?? null, claimedValue ?? null, recurrence ?? null, durationYears ?? null, benefitId, id]
      );
      return result.rows[0] ?? null;
    });

    if (!benefit) return res.status(404).json({ error: 'Benefit not found' });
    res.json(benefit);
  } catch (err) {
    if (err instanceof RevisionReasonRequiredError) return res.status(400).json({ error: err.message });
    console.error('Failed to update benefit:', err);
    res.status(500).json({ error: 'Failed to update benefit' });
  }
});

// ---------- Risk register: add ----------
const addRiskSchema = z.object({
  description: z.string().min(1),
  category: z.enum(['delivery', 'business']),
  likelihood: z.enum(['low', 'medium', 'high']),
  impact: z.enum(['low', 'medium', 'high']),
  mitigation: z.string().optional(),
  ownerUserId: looseUuid().optional(),
  reason: z.string().optional(),
});

router.post('/business-cases/:id/risks', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = addRiskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const { description, category, likelihood, impact, mitigation, ownerUserId, reason } = parsed.data;

  try {
    const risk = await withTenantContext(organizationId, async (client) => {
      const canAccess = await assertCanAccessBusinessCase(client, id, userId);
      if (!canAccess) return null;

      const result = await client.query(
        `INSERT INTO business_case_risk
           (id, business_case_id, description, category, likelihood, impact, mitigation, owner_user_id, raised_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, description, category, likelihood, impact, mitigation, status, created_at`,
        [id, description, category, likelihood, impact, mitigation ?? null, ownerUserId ?? null, userId]
      );
      const row = result.rows[0];

      await logRevisionIfApproved(client, organizationId, id, userId, 'risk_added', reason, null, row, row.id);

      return row;
    });

    if (!risk) return res.status(404).json({ error: 'Business case not found' });
    res.status(201).json(risk);
  } catch (err) {
    if (err instanceof RevisionReasonRequiredError) return res.status(400).json({ error: err.message });
    console.error('Failed to add risk:', err);
    res.status(500).json({ error: 'Failed to add risk' });
  }
});

// ---------- Risk register: update status/mitigation ----------
const updateRiskSchema = z.object({
  status: z.enum(['open', 'mitigated', 'accepted', 'closed']).optional(),
  mitigation: z.string().optional(),
});

router.patch('/business-cases/:id/risks/:riskId', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = updateRiskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id, riskId } = req.params;
  const { status, mitigation } = parsed.data;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const canAccess = await assertCanAccessBusinessCase(client, id, userId);
      if (!canAccess) return null;

      const result = await client.query(
        `UPDATE business_case_risk SET
           status = COALESCE($1, status),
           mitigation = COALESCE($2, mitigation),
           updated_at = now()
         WHERE id = $3
         RETURNING id, description, category, likelihood, impact, mitigation, status`,
        [status ?? null, mitigation ?? null, riskId]
      );
      return result.rows[0];
    });

    if (!updated) return res.status(404).json({ error: 'Risk not found' });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update risk:', err);
    res.status(500).json({ error: 'Failed to update risk' });
  }
});

// ---------- Risk register: delete ----------
// Blocked outright once the business case is approved -- not a
// tracked-with-reason path like the others, since deleting a risk
// that was part of the decided case would remove it from the record
// entirely rather than just changing it. Close it via status instead.
router.delete('/business-cases/:id/risks/:riskId', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const { organizationId } = req.user!;
  const { id, riskId } = req.params;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const decision = await getBusinessCaseDecision(client, id);
      if (decision === 'approved') {
        return { blocked: true as const };
      }
      await client.query(`DELETE FROM business_case_risk WHERE id = $1`, [riskId]);
      return { blocked: false as const };
    });

    if (result.blocked) {
      return res.status(409).json({ error: 'Risks cannot be deleted once the business case is approved. Set its status to closed instead.' });
    }
    res.status(200).json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete risk:', err);
    res.status(500).json({ error: 'Failed to delete risk' });
  }
});


// ---------- Revision history ----------
// Everything logged by logRevisionIfApproved, newest first. This is
// the only place these tracked changes are visible -- without it,
// requiring a reason would just be friction with nothing to show for
// it afterward.
router.get('/business-cases/:id/revisions', requireAuth, requirePermission('business_case.view'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const revisions = await withTenantContext(organizationId, async (client) => {
      const canAccess = await assertCanAccessBusinessCase(client, id, userId);
      if (!canAccess) return null;

      const result = await client.query(
        `SELECT r.id, r.field, r.reference_id, r.prior_value, r.new_value, r.reason, r.changed_at,
                u.display_name AS changed_by_name
           FROM business_case_revision r
           LEFT JOIN app_user u ON u.id = r.changed_by
          WHERE r.business_case_id = $1
          ORDER BY r.changed_at DESC`,
        [id]
      );
      return result.rows;
    });

    if (revisions === null) return res.status(404).json({ error: 'Business case not found' });
    res.json(revisions);
  } catch (err) {
    console.error('Failed to fetch revision history:', err);
    res.status(500).json({ error: 'Failed to fetch revision history' });
  }
});

// ---------- Finance Impact Assessment: upsert ----------
const fiaSchema = z.object({
  fundingSource: z.string().optional(),
  costCentre: z.string().optional(),
  capexAmount: z.number().min(0).optional(),
  opexAmount: z.number().min(0).optional(),
  ongoingAnnualCost: z.number().min(0).optional(),
  fundingPeriodMonths: z.number().int().min(0).optional(),
  financialNarrative: z.string().optional(),
  status: z.enum(['draft', 'completed']).optional(),
});

router.put('/business-cases/:id/finance-impact-assessment', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = fiaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;
  const {
    fundingSource, costCentre, capexAmount, opexAmount,
    ongoingAnnualCost, fundingPeriodMonths, financialNarrative, status,
  } = parsed.data;

  try {
    const fia = await withTenantContext(organizationId, async (client) => {
      const existing = await client.query(
        `SELECT id FROM finance_impact_assessment WHERE business_case_id = $1`, [id]
      );

      const preparedAt = status === 'completed' ? new Date() : null;

      if (existing.rows.length > 0) {
        const result = await client.query(
          `UPDATE finance_impact_assessment SET
             funding_source = COALESCE($1, funding_source),
             cost_centre = COALESCE($2, cost_centre),
             capex_amount = COALESCE($3, capex_amount),
             opex_amount = COALESCE($4, opex_amount),
             ongoing_annual_cost = COALESCE($5, ongoing_annual_cost),
             funding_period_months = COALESCE($6, funding_period_months),
             financial_narrative = COALESCE($7, financial_narrative),
             status = COALESCE($8, status),
             prepared_by = CASE WHEN $8 = 'completed' THEN $9 ELSE prepared_by END,
             prepared_at = CASE WHEN $8 = 'completed' THEN COALESCE(prepared_at, now()) ELSE prepared_at END,
             updated_at = now()
           WHERE business_case_id = $10
           RETURNING id, funding_source, cost_centre, capex_amount, opex_amount,
                     ongoing_annual_cost, funding_period_months, financial_narrative, status, prepared_at`,
          [fundingSource ?? null, costCentre ?? null, capexAmount ?? null, opexAmount ?? null,
           ongoingAnnualCost ?? null, fundingPeriodMonths ?? null, financialNarrative ?? null,
           status ?? null, userId, id]
        );
        return result.rows[0];
      }

      const result = await client.query(
        `INSERT INTO finance_impact_assessment
           (id, business_case_id, funding_source, cost_centre, capex_amount, opex_amount,
            ongoing_annual_cost, funding_period_months, financial_narrative, status,
            prepared_by, prepared_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'draft'), $10, $11)
         RETURNING id, funding_source, cost_centre, capex_amount, opex_amount,
                   ongoing_annual_cost, funding_period_months, financial_narrative, status, prepared_at`,
        [id, fundingSource ?? null, costCentre ?? null, capexAmount ?? null, opexAmount ?? null,
         ongoingAnnualCost ?? null, fundingPeriodMonths ?? null, financialNarrative ?? null,
         status ?? null, status === 'completed' ? userId : null, preparedAt]
      );
      return result.rows[0];
    });

    res.json(fia);
  } catch (err) {
    console.error('Failed to save finance impact assessment:', err);
    res.status(500).json({ error: 'Failed to save finance impact assessment' });
  }
});


// ---------- Decision: approve or decline the requested spend ----------
// A DIFFERENT question from the earlier triage accept/reject - that was
// "is this idea worth pursuing." This is "is this specific spend approved."
const decisionSchema = z.object({ decision: z.enum(['approved', 'declined']) });

router.post('/business-cases/:id/decision', requireAuth, requirePermission('business_case.decide'), async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const updated = await withTenantContext(organizationId, async (client) => {
      const canAccess = await assertCanAccessBusinessCase(client, id, userId);
      if (!canAccess) return null;

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

// ---------- PDF export of the executive summary view ----------
// Deliberately narrow: exec summary, problem statement, decision,
// requested spend, anchored estimate movement, strategic goal, RACI,
// benefits, and open risks. This is a summary document for circulation,
// not a full data dump - detailed financial breakdowns and the full
// audit trail stay in the app.
router.get('/business-cases/:id/export.pdf', requireAuth, requirePermission('business_case.view'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const { id } = req.params;

  try {
    const data = await withTenantContext(organizationId, async (client) => {
      const canView = await assertCanAccessBusinessCase(client, id, userId);
      if (!canView) return null;

      const bcResult = await client.query(
        `SELECT bc.id, bc.title, bc.requested_spend, bc.decision, bc.decision_date,
                bc.demand_id, bc.executive_summary, bc.problem_statement,
                p.name AS portfolio_name,
                sponsor.display_name AS sponsor_name,
                submitter.display_name AS submitted_by_name
         FROM business_case bc
         JOIN portfolio p ON p.id = bc.portfolio_id
         LEFT JOIN app_user sponsor ON sponsor.id = bc.sponsor_user_id
         LEFT JOIN app_user submitter ON submitter.id = bc.submitted_by
         WHERE bc.id = $1`,
        [id]
      );
      const bc = bcResult.rows[0];
      if (!bc) return null;

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
        [bc.demand_id]
      );

      const estimateResult = await client.query(
        `SELECT claimed_cost, claimed_benefit, assessed_cost, assessed_benefit,
                cost_confidence, benefit_confidence
         FROM demand_estimate_movement WHERE demand_id = $1`,
        [bc.demand_id]
      );

      const goalResult = await client.query(
        `SELECT sg.name AS goal_name, sg.goal_year, dgl.alignment_notes
         FROM demand_goal_link dgl
         JOIN strategic_goal sg ON sg.id = dgl.strategic_goal_id
         WHERE dgl.demand_id = $1`,
        [bc.demand_id]
      );

      const benefitsResult = await client.query(
        `SELECT b.title, b.benefit_type, b.claimed_value, b.status, b.recurrence, b.duration_years, owner.display_name AS owner_name
         FROM benefit b
         LEFT JOIN app_user owner ON owner.id = b.owner_user_id
         WHERE b.business_case_id = $1
         ORDER BY b.title`,
        [id]
      );

      const risksResult = await client.query(
        `SELECT r.description, r.category, r.likelihood, r.impact, r.mitigation, r.status,
                owner.display_name AS owner_name
         FROM business_case_risk r
         LEFT JOIN app_user owner ON owner.id = r.owner_user_id
         WHERE r.business_case_id = $1 AND r.status <> 'closed'
         ORDER BY r.created_at DESC`,
        [id]
      );

      const governance = await computeGovernanceRequirements(client, organizationId, bc.requested_spend);

      return {
        bc,
        raci: raciResult.rows[0] ?? null,
        estimate: estimateResult.rows[0] ?? null,
        goal: goalResult.rows[0] ?? null,
        benefits: benefitsResult.rows,
        risks: risksResult.rows,
        governance,
      };
    });

    if (!data) return res.status(404).json({ error: 'Business case not found' });

    const { bc, raci, estimate, goal, benefits, risks, governance } = data;
    const fileSafeTitle = (bc.title ?? 'business-case').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileSafeTitle}-summary.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // ---------- Header ----------
    doc.fontSize(18).font('Helvetica-Bold').text(bc.title ?? 'Business Case');
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#666')
      .text([bc.portfolio_name, bc.sponsor_name && `Sponsor: ${bc.sponsor_name}`, bc.submitted_by_name && `Submitted by: ${bc.submitted_by_name}`]
        .filter(Boolean).join('   |   '));
    doc.fillColor('#000');
    if (bc.decision) {
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica-Bold')
        .text(`Decision: ${bc.decision.toUpperCase()}${bc.decision_date ? ` on ${new Date(bc.decision_date).toLocaleDateString()}` : ''}`);
    }
    doc.moveDown(1);

    function sectionHeading(text: string) {
      doc.moveDown(0.6);
      doc.fontSize(13).font('Helvetica-Bold').text(text);
      doc.moveDown(0.2);
      doc.fontSize(10).font('Helvetica');
    }

    // ---------- Executive summary ----------
    sectionHeading('Executive Summary');
    doc.text(bc.executive_summary || 'Not yet written.');

    // ---------- Problem statement ----------
    sectionHeading('Problem / Opportunity Statement');
    doc.text(bc.problem_statement || 'Not yet written.');

    // ---------- Financial position (anchored estimate) ----------
    sectionHeading('Financial Position (anchored estimate)');
    if (estimate) {
      doc.text(`Claimed at raise (P50): cost ${fmtMoney(estimate.claimed_cost)}, benefit ${fmtMoney(estimate.claimed_benefit)}`);
      doc.text(`Assessed (P75): cost ${fmtMoney(estimate.assessed_cost)}, benefit ${fmtMoney(estimate.assessed_benefit)}`
        + (estimate.cost_confidence ? ` — cost confidence: ${estimate.cost_confidence}` : '')
        + (estimate.benefit_confidence ? `, benefit confidence: ${estimate.benefit_confidence}` : ''));
    } else {
      doc.text('No estimate recorded yet.');
    }
    doc.text(`Requested spend: ${fmtMoney(bc.requested_spend)}`);

    // ---------- Strategic alignment ----------
    sectionHeading('Strategic Alignment');
    if (goal) {
      doc.text(`Linked goal: ${goal.goal_name} (${goal.goal_year})`);
      if (goal.alignment_notes) doc.text(goal.alignment_notes);
    } else {
      doc.text('Not linked to a declared strategic goal.');
    }

    // ---------- Stakeholders / governance (RACI) ----------
    sectionHeading('Stakeholders & Governance (RACI)');
    if (raci) {
      doc.text(`Accountable — Financial: ${raci.accountable_financial_name}`);
      doc.text(`Accountable — Scope: ${raci.accountable_scope_name}`);
      doc.text(`Accountable — Schedule: ${raci.accountable_schedule_name}`);
      doc.text(`Sponsor: ${raci.sponsor_name}`);
      doc.text(`Benefit Owner: ${raci.benefit_owner_name}`);
    } else {
      doc.text('RACI not yet named.');
    }

    // ---------- Governance requirements (cost-tiered, cumulative) ----------
    sectionHeading('Governance Requirements (by requested spend)');
    if (governance.highest_tier_name) {
      doc.text(`Governance tier reached: ${governance.highest_tier_name} (threshold ${fmtMoney(governance.highest_tier_threshold)})`);
    }
    doc.text(`Required approvers: ${governance.required_approvers.length > 0 ? governance.required_approvers.join(', ') : 'none configured'}`);
    doc.text(`Required documents: ${governance.required_documents.length > 0 ? governance.required_documents.join(', ') : 'none configured'}`);

    // ---------- Benefits ----------
    sectionHeading('Benefits Claimed');
    if (benefits.length === 0) {
      doc.text('No benefits recorded yet.');
    } else {
      benefits.forEach((b: any) => {
        doc.font('Helvetica-Bold').text(`${b.title}${b.claimed_value != null ? ` — ${fmtMoney(b.claimed_value)}` : ''}`, { continued: false });
        doc.font('Helvetica').fontSize(9).fillColor('#666')
          .text(`${b.benefit_type}   |   owner: ${b.owner_name ?? 'unassigned'}   |   ${b.status}`);
        doc.fillColor('#000').fontSize(10);
        doc.moveDown(0.3);
      });
    }

    // ---------- Risks ----------
    sectionHeading('Risk Assessment (open / not closed)');
    if (risks.length === 0) {
      doc.text('No open risks recorded.');
    } else {
      risks.forEach((r: any) => {
        doc.font('Helvetica-Bold').text(r.description);
        doc.font('Helvetica').fontSize(9).fillColor('#666')
          .text(`${r.category}   |   likelihood: ${r.likelihood}   |   impact: ${r.impact}   |   status: ${r.status}`
            + (r.owner_name ? `   |   owner: ${r.owner_name}` : ''));
        if (r.mitigation) doc.fillColor('#000').fontSize(10).text(`Mitigation: ${r.mitigation}`);
        doc.fillColor('#000').fontSize(10);
        doc.moveDown(0.3);
      });
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#999')
      .text(`Generated from Ledger on ${new Date().toLocaleDateString()}. This is a summary export; the full audit trail lives in the platform.`);

    doc.end();
  } catch (err) {
    console.error('Failed to export business case PDF:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to export PDF' });
  }
});

function fmtMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return 'not recorded';
  const n = Number(value);
  if (isNaN(n)) return 'not recorded';
  return `GBP ${n.toLocaleString()}`;
}

export default router;
