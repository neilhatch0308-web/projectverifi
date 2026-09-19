import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { withTenantContext } from '../db/pool';
import { looseUuid } from '../lib/validation';
import { assertCanAccessBusinessCase } from './businessCase';
import { ensureApprovedBaseline } from '../lib/baseline';
import { ChangeControlError, ChangePayload, planChange, applyPlan, releaseEligibleHolds } from '../lib/changeEngine';
import { computeDrift, evaluateTolerance, deriveFlags, Capacity, Level, ToleranceRule } from '../lib/tolerance';

// Post-approval change control, step 1: baseline versions and the
// change request wrapper. See 66_change_control_baselines.sql.
//
// One change request = one atomic, reasoned event that may move cost,
// benefit, timescale and scope together ("cost too high, so descope").
// It replaces the old process-flow rule that rejected a re-base
// spanning two or more aspects: cost and scope are coupled in practice,
// so the wrapper records them as one decision instead of forcing a
// split. Gated by business_case.edit, the same door migration 54 used.
// Step 2 (67_change_tolerance_attestation.sql): who DECIDED the change
// is attested separately from who recorded it, and the level of
// decision it needed is computed from tenant tolerance rules against
// total drift from baseline v1. A mismatch is flagged, never blocked.

const DEFAULT_HOLD_FLAG_DAYS = 7;

const router = Router();


const attestationSchema = z.object({
  deciderUserId: looseUuid().optional(),
  deciderExternalName: z.string().trim().min(1).optional(),
  decisionCapacity: z.enum(['sponsor', 'portfolio', 'executive']),
  decisionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  evidenceReference: z.string().trim().min(1).optional(),
}).refine((a) => a.deciderUserId !== undefined || a.deciderExternalName !== undefined, {
  message: 'Name the decider: a user, or an outside name.',
});
type Attestation = z.infer<typeof attestationSchema>;

// Shared by the create route and the add-attestation route. Validation
// only -- nothing here blocks on the decider's level (flag, never block).
async function insertAttestation(
  client: any, organizationId: string, changeRequestId: string, recordedBy: string, a: Attestation
): Promise<void> {
  const today = await client.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`);
  if (a.decisionDate > today.rows[0].d) {
    throw new ChangeControlError(400, 'The decision date cannot be in the future.');
  }
  if (a.deciderUserId) {
    const u = await client.query(
      `SELECT id FROM app_user WHERE id = $1 AND organization_id = $2 AND is_active = true`,
      [a.deciderUserId, organizationId]
    );
    if (u.rows.length === 0) throw new ChangeControlError(404, 'The named decider was not found.');
  }
  await client.query(
    `INSERT INTO change_attestation
       (organization_id, change_request_id, decider_user_id, decider_external_name,
        decision_capacity, decision_date, evidence_reference, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [organizationId, changeRequestId, a.deciderUserId ?? null, a.deciderExternalName ?? null,
     a.decisionCapacity, a.decisionDate, a.evidenceReference ?? null, recordedBy]
  );
}

const changeRequestSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required'),
  newApprovedCost: z.number().nonnegative().optional(),
  newPlannedEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  newScopeSummary: z.string().trim().min(1).optional(),
  benefitEdits: z.array(z.object({
    benefitId: looseUuid(),
    claimedValue: z.number().nonnegative(),
  })).optional(),
  descopeKpiIds: z.array(looseUuid()).optional(),
  attestation: z.lazy(() => attestationSchema).optional(),
});

router.post('/business-cases/:id/change-requests', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = changeRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { reason, attestation, ...payload } = parsed.data;
  const changePayload: ChangePayload = payload;

  try {
    const result = await withTenantContext(organizationId, async (client) => {
      const demandId = await assertCanAccessBusinessCase(client, id, userId);
      if (!demandId) return null; // 404 - also covers confidential demands the caller can't see

      // Serialise change requests per business case.
      const bc = await client.query(`SELECT decision FROM business_case WHERE id = $1 FOR UPDATE`, [id]);
      if (bc.rows[0]?.decision !== 'approved') {
        throw new ChangeControlError(409, 'Change requests apply only after approval. Before approval, edit the business case directly.');
      }
      const dem = await client.query(`SELECT status, confidential FROM demand WHERE id = $1`, [demandId]);
      if (dem.rows[0]?.status === 'stopped') throw new ChangeControlError(409, 'This demand is stopped.');

      const open = await client.query(`SELECT 1 FROM change_request_held WHERE business_case_id = $1 LIMIT 1`, [id]);
      if (open.rows.length > 0) {
        throw new ChangeControlError(409, 'A held change is already waiting on this business case. Release, re-attribute or withdraw it first.');
      }

      await ensureApprovedBaseline(client, organizationId, id, null, true);
      const ctx = { organizationId, demandId, businessCaseId: id };
      const plan = await planChange(client, ctx, changePayload);
      const current = plan.current;

      // --- Required level: drift from baseline v1, evaluated against tenant rules ---
      const v1Res = await client.query(
        `SELECT approved_cost, benefit_total, to_char(planned_end_date, 'YYYY-MM-DD') AS planned_end_date, scope_summary
           FROM baseline_version WHERE demand_id = $1 AND version_number = 1`,
        [demandId]
      );
      const v1 = v1Res.rows[0];
      const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      const newCostValue = plan.newCost;
      const benefitNow = await client.query(`SELECT SUM(claimed_value) AS total FROM benefit WHERE business_case_id = $1`, [id]);
      let prospectiveBenefit = numOrNull(benefitNow.rows[0].total);
      if (prospectiveBenefit !== null) {
        for (const b of plan.benefitChanges) prospectiveBenefit += b.claimedValue - Number(b.before.claimed_value);
      }
      const v1Cost = numOrNull(v1?.approved_cost);
      let crossedTier = false;
      if (v1Cost !== null && newCostValue !== null) {
        const t = await client.query(
          `SELECT EXISTS (SELECT 1 FROM governance_tier
                           WHERE organization_id = $1
                             AND ((min_threshold <= $2) <> (min_threshold <= $3))) AS crossed`,
          [organizationId, v1Cost, newCostValue]
        );
        crossedTier = t.rows[0].crossed;
      }
      const priorDescopes = await client.query(
        `SELECT count(*)::int AS n FROM kpi_descope ds JOIN kpi_definition k ON k.id = ds.kpi_definition_id WHERE k.demand_id = $1`,
        [demandId]
      );
      const drift = computeDrift(
        { cost: v1Cost, benefit: numOrNull(v1?.benefit_total), endDate: v1?.planned_end_date ?? null, scope: v1?.scope_summary ?? null },
        { cost: newCostValue, benefit: prospectiveBenefit,
          endDate: plan.dateChanges ? plan.newPlannedEndDate : current.planned_end_date,
          scope: plan.scopeChanges ? plan.newScopeSummary : current.scope_summary },
        crossedTier,
        priorDescopes.rows[0].n + plan.descopes.length > 0
      );
      const ruleRows = await client.query(
        `SELECT name, required_level, min_pct, min_abs, min_days, on_tier_crossing, on_scope_change
           FROM change_tolerance_rule WHERE organization_id = $1`,
        [organizationId]
      );
      const rules: ToleranceRule[] = ruleRows.rows.map((r: any) => ({
        ...r, min_pct: numOrNull(r.min_pct), min_abs: numOrNull(r.min_abs), min_days: numOrNull(r.min_days),
      }));
      const evaluation = evaluateTolerance(rules, drift);

      // --- Record the change request (always) ---
      const cr = await client.query(
        `INSERT INTO change_request
           (organization_id, demand_id, business_case_id, reason, created_by,
            required_level, required_reasons, cost_drift_amount, cost_drift_pct,
            benefit_drift_amount, benefit_drift_pct, date_slip_days, crossed_governance_tier, scope_changed_since_v1)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id, created_at`,
        [organizationId, demandId, id, reason, userId,
         evaluation.requiredLevel, evaluation.reasons, drift.costAmount, drift.costPct,
         drift.benefitAmount, drift.benefitPct, drift.dateSlipDays, drift.crossedGovernanceTier, drift.scopeChangedSinceV1]
      );
      const changeRequestId: string = cr.rows[0].id;
      if (attestation) await insertAttestation(client, organizationId, changeRequestId, userId, attestation);

      const recordedDate = (await client.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
      const flags = deriveFlags(
        evaluation.requiredLevel,
        attestation ? { capacity: attestation.decisionCapacity as Capacity, decisionDate: attestation.decisionDate,
                        hasUser: attestation.deciderUserId !== undefined, evidence: attestation.evidenceReference ?? null } : null,
        recordedDate
      );
      const summary = { changeRequestId, createdAt: cr.rows[0].created_at,
                        requiredLevel: evaluation.requiredLevel, requiredReasons: evaluation.reasons, drift, flags };

      // --- Hold: confidential demand + a named decider who cannot see it ---
      if (dem.rows[0].confidential && attestation?.deciderUserId) {
        const vis = await client.query(`SELECT can_view_confidential_demand($1, $2) AS ok`, [demandId, attestation.deciderUserId]);
        if (!vis.rows[0].ok) {
          await client.query(
            `INSERT INTO change_request_hold (organization_id, change_request_id, payload, placed_by)
             VALUES ($1, $2, $3, $4)`,
            [organizationId, changeRequestId, JSON.stringify(changePayload), userId]
          );
          return { held: true as const, ...summary };
        }
      }

      // --- Apply now ---
      const applied = await applyPlan(client, ctx, changeRequestId, reason, userId, plan);
      return { held: false as const, ...summary, baseline: applied.baseline };
    });

    if (!result) return res.status(404).json({ error: 'Business case not found' });
    if (result.held) {
      return res.status(202).json({
        ...result,
        holdReason: 'The named decider cannot see this confidential demand. The change is recorded but not applied. Add them as a viewer, re-attribute the decision, or withdraw the change.',
      });
    }
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ChangeControlError) return res.status(err.status).json({ error: err.message });
    console.error('Failed to record change request:', err);
    res.status(500).json({ error: 'Failed to record change request' });
  }
});

// ---------- Baseline history ----------
// The whole chain, oldest first, with the ORIGINAL ask and the P75
// assessment shown alongside so nobody has to reconstruct the story.
router.get('/business-cases/:id/baselines', requireAuth, requirePermission('business_case.view'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const data = await withTenantContext(organizationId, async (client) => {
      const demandId = await assertCanAccessBusinessCase(client, id, userId);
      if (!demandId) return null;

      const original = await client.query(
        `SELECT d.claimed_cost, d.claimed_benefit, a.assessed_cost, a.assessed_benefit
           FROM demand d LEFT JOIN demand_assessment a ON a.demand_id = d.id
          WHERE d.id = $1`,
        [demandId]
      );
      const versions = await client.query(
        `SELECT bv.id, bv.version_number, bv.kind, bv.approved_cost, bv.benefit_total,
                to_char(bv.planned_end_date, 'YYYY-MM-DD') AS planned_end_date,
                bv.scope_summary, bv.backfilled, bv.created_at,
                bv.change_request_id, cr.reason, u.display_name AS recorded_by_name,
                cr.required_level, cr.required_reasons, cr.cost_drift_amount, cr.cost_drift_pct,
                cr.benefit_drift_amount, cr.benefit_drift_pct, cr.date_slip_days,
                cr.crossed_governance_tier, cr.scope_changed_since_v1,
                to_char(cr.created_at, 'YYYY-MM-DD') AS change_recorded_date,
                resp.response AS attribution_response, resp.reason AS attribution_response_reason,
                resp.responded_at AS attribution_responded_at,
                (CURRENT_DATE - att.recorded_at::date) AS days_since_attributed,
                hd.placed_at AS held_at, rs.resolved_at AS released_at, rs.released_via, rs.viewer_grant_id,
                att.decider_user_id, decider.display_name AS decider_name, att.decider_external_name,
                att.decision_capacity, to_char(att.decision_date, 'YYYY-MM-DD') AS decision_date,
                att.evidence_reference, att.recorded_at AS attestation_recorded_at
           FROM baseline_version bv
           LEFT JOIN change_request cr ON cr.id = bv.change_request_id
           LEFT JOIN app_user u ON u.id = COALESCE(cr.created_by, bv.created_by)
           LEFT JOIN LATERAL (
             SELECT * FROM change_attestation a WHERE a.change_request_id = cr.id
              ORDER BY a.recorded_at DESC LIMIT 1
           ) att ON true
           LEFT JOIN LATERAL (
             SELECT * FROM change_attribution_response r WHERE r.attestation_id = att.id
              ORDER BY r.responded_at DESC LIMIT 1
           ) resp ON true
           LEFT JOIN app_user decider ON decider.id = att.decider_user_id
           LEFT JOIN change_request_hold hd ON hd.change_request_id = cr.id
           LEFT JOIN change_request_resolution rs ON rs.change_request_id = cr.id
          WHERE bv.demand_id = $1
          ORDER BY bv.version_number ASC`,
        [demandId]
      );
      const descoped = await client.query(
        `SELECT ds.kpi_definition_id, k.name, ds.change_request_id, ds.created_at
           FROM kpi_descope ds JOIN kpi_definition k ON k.id = ds.kpi_definition_id
          WHERE k.demand_id = $1
          ORDER BY ds.created_at ASC`,
        [demandId]
      );
      const settingRow = await client.query(`SELECT hold_flag_days FROM change_control_setting WHERE organization_id = $1`, [organizationId]);
      const flagDays: number = settingRow.rows[0]?.hold_flag_days ?? DEFAULT_HOLD_FLAG_DAYS;
      const heldRows = await client.query(
        `SELECT h.change_request_id, h.reason, h.required_level, h.placed_at, h.days_held, h.payload,
                u.display_name AS recorded_by_name,
                att.decider_user_id, decider.display_name AS decider_name, att.decider_external_name
           FROM change_request_held h
           JOIN app_user u ON u.id = h.recorded_by
           LEFT JOIN LATERAL (
             SELECT * FROM change_attestation a WHERE a.change_request_id = h.change_request_id
              ORDER BY a.recorded_at DESC LIMIT 1
           ) att ON true
           LEFT JOIN app_user decider ON decider.id = att.decider_user_id
          WHERE h.demand_id = $1
          ORDER BY h.placed_at ASC`,
        [demandId]
      );
      const withdrawnRows = await client.query(
        `SELECT cr.id AS change_request_id, cr.reason, rs.withdraw_reason, rs.resolved_at, u.display_name AS withdrawn_by_name
           FROM change_request cr
           JOIN change_request_resolution rs ON rs.change_request_id = cr.id AND rs.outcome = 'withdrawn'
           JOIN app_user u ON u.id = rs.resolved_by
          WHERE cr.demand_id = $1 ORDER BY rs.resolved_at ASC`,
        [demandId]
      );
      const o = original.rows[0] ?? {};
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        original: {
          claimedCost: n(o.claimed_cost), claimedBenefit: n(o.claimed_benefit),
          assessedCost: n(o.assessed_cost), assessedBenefit: n(o.assessed_benefit),
        },
        versions: versions.rows.map((v: any) => {
          const isRebase = v.change_request_id !== null;
          const flags = isRebase
            ? deriveFlags(
                v.required_level as Level | null,
                v.decision_capacity
                  ? { capacity: v.decision_capacity as Capacity, decisionDate: v.decision_date,
                      hasUser: v.decider_user_id !== null, evidence: v.evidence_reference }
                  : null,
                v.change_recorded_date
              )
            : null;
          return {
            ...v,
            approved_cost: n(v.approved_cost), benefit_total: n(v.benefit_total),
            cost_drift_amount: n(v.cost_drift_amount), cost_drift_pct: n(v.cost_drift_pct),
            benefit_drift_amount: n(v.benefit_drift_amount), benefit_drift_pct: n(v.benefit_drift_pct),
            flags,
            // Unconfirmed / confirmed / disputed. Only meaningful for a re-base
            // with a named user as decider; the age of 'unconfirmed' is a signal.
            attribution_status: isRebase && v.decider_user_id
              ? (v.attribution_response ?? 'unconfirmed') : null,
            days_unconfirmed: isRebase && v.decider_user_id && !v.attribution_response ? v.days_since_attributed : null,
          };
        }),
        descopedMeasures: descoped.rows,
        heldChanges: heldRows.rows.map((h: any) => ({ ...h, overdue: h.days_held >= flagDays, flagAfterDays: flagDays })),
        withdrawnChanges: withdrawnRows.rows,
      };
    });

    if (!data) return res.status(404).json({ error: 'Business case not found' });
    res.json(data);
  } catch (err) {
    console.error('Failed to load baselines:', err);
    res.status(500).json({ error: 'Failed to load baselines' });
  }
});

// ---------- Add or supersede the attestation on a change request ----------
// Insert-only: the latest row is effective, earlier ones stay in the
// record. Lets the recorder name a decider after the fact, or correct
// a wrong one, without overwriting who was originally named.
router.post('/change-requests/:crId/attestations', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = attestationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { organizationId, userId } = req.user!;
  const crId = Array.isArray(req.params.crId) ? req.params.crId[0] : req.params.crId;

  try {
    const ok = await withTenantContext(organizationId, async (client) => {
      const cr = await client.query(`SELECT business_case_id FROM change_request WHERE id = $1`, [crId]);
      if (cr.rows.length === 0) return null;
      const demandId = await assertCanAccessBusinessCase(client, cr.rows[0].business_case_id, userId);
      if (!demandId) return null;
      await insertAttestation(client, organizationId, crId, userId, parsed.data);
      // If this change was held, the new decider may now be able to see it.
      const rel = await releaseEligibleHolds(client, organizationId, demandId, userId, 'reattribution', { onlyChangeRequestId: crId });
      return { rel };
    });
    if (!ok) return res.status(404).json({ error: 'Change request not found' });
    res.status(201).json({ recorded: true, released: ok.rel.released.length > 0, releaseFailures: ok.rel.failed });
  } catch (err) {
    if (err instanceof ChangeControlError) return res.status(err.status).json({ error: err.message });
    console.error('Failed to record attestation:', err);
    res.status(500).json({ error: 'Failed to record attestation' });
  }
});

// ---------- Tolerance rules (tenant configuration) ----------
// Same admin door as governance tiers (org.manage). Editing a rule
// never rewrites history: each change request stored its own computed
// required level at the time it was recorded.
router.get('/change-tolerance-rules', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  try {
    const rows = await withTenantContext(organizationId, async (client) => {
      const r = await client.query(
        `SELECT id, name, required_level, min_pct, min_abs, min_days, on_tier_crossing, on_scope_change
           FROM change_tolerance_rule WHERE organization_id = $1 ORDER BY created_at ASC`,
        [organizationId]
      );
      return r.rows;
    });
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch tolerance rules:', err);
    res.status(500).json({ error: 'Failed to fetch tolerance rules' });
  }
});

const ruleSchema = z.object({
  name: z.string().trim().min(1),
  requiredLevel: z.enum(['sponsor', 'portfolio', 'executive']),
  minPct: z.number().positive().nullable().optional(),
  minAbs: z.number().positive().nullable().optional(),
  minDays: z.number().int().positive().nullable().optional(),
  onTierCrossing: z.boolean().optional(),
  onScopeChange: z.boolean().optional(),
}).refine(
  (r) => r.minPct != null || r.minAbs != null || r.minDays != null || r.onTierCrossing === true || r.onScopeChange === true,
  { message: 'A rule needs at least one trigger.' }
);

router.post('/change-tolerance-rules', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { organizationId, userId } = req.user!;
  const r = parsed.data;
  try {
    const row = await withTenantContext(organizationId, async (client) => {
      const q = await client.query(
        `INSERT INTO change_tolerance_rule
           (organization_id, name, required_level, min_pct, min_abs, min_days, on_tier_crossing, on_scope_change, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name, required_level, min_pct, min_abs, min_days, on_tier_crossing, on_scope_change`,
        [organizationId, r.name, r.requiredLevel, r.minPct ?? null, r.minAbs ?? null, r.minDays ?? null,
         r.onTierCrossing ?? false, r.onScopeChange ?? false, userId]
      );
      return q.rows[0];
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('Failed to create tolerance rule:', err);
    res.status(500).json({ error: 'Failed to create tolerance rule' });
  }
});

router.put('/change-tolerance-rules/:id', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { organizationId } = req.user!;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const r = parsed.data;
  try {
    const row = await withTenantContext(organizationId, async (client) => {
      const q = await client.query(
        `UPDATE change_tolerance_rule SET
           name = $1, required_level = $2, min_pct = $3, min_abs = $4, min_days = $5,
           on_tier_crossing = $6, on_scope_change = $7, updated_at = now()
         WHERE id = $8
         RETURNING id, name, required_level, min_pct, min_abs, min_days, on_tier_crossing, on_scope_change`,
        [r.name, r.requiredLevel, r.minPct ?? null, r.minAbs ?? null, r.minDays ?? null,
         r.onTierCrossing ?? false, r.onScopeChange ?? false, id]
      );
      return q.rows[0];
    });
    if (!row) return res.status(404).json({ error: 'Tolerance rule not found' });
    res.json(row);
  } catch (err) {
    console.error('Failed to update tolerance rule:', err);
    res.status(500).json({ error: 'Failed to update tolerance rule' });
  }
});

router.delete('/change-tolerance-rules/:id', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const { organizationId } = req.user!;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    await withTenantContext(organizationId, async (client) => {
      await client.query(`DELETE FROM change_tolerance_rule WHERE id = $1`, [id]);
    });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Failed to delete tolerance rule:', err);
    res.status(500).json({ error: 'Failed to delete tolerance rule' });
  }
});

// ---------- Withdraw a held change ----------
// Only a HELD change can be withdrawn: an applied change is history and
// is corrected by a further change request, never erased.
router.post('/change-requests/:crId/withdraw', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const parsed = z.object({ reason: z.string().trim().min(1, 'A reason is required') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { organizationId, userId } = req.user!;
  const crId = Array.isArray(req.params.crId) ? req.params.crId[0] : req.params.crId;

  try {
    const ok = await withTenantContext(organizationId, async (client) => {
      const cr = await client.query(`SELECT business_case_id FROM change_request WHERE id = $1`, [crId]);
      if (cr.rows.length === 0) return false;
      const demandId = await assertCanAccessBusinessCase(client, cr.rows[0].business_case_id, userId);
      if (!demandId) return false;
      const held = await client.query(`SELECT 1 FROM change_request_held WHERE change_request_id = $1`, [crId]);
      if (held.rows.length === 0) throw new ChangeControlError(409, 'Only a held change can be withdrawn.');
      await client.query(
        `INSERT INTO change_request_resolution (organization_id, change_request_id, outcome, withdraw_reason, resolved_by)
         VALUES ($1, $2, 'withdrawn', $3, $4)`,
        [organizationId, crId, parsed.data.reason, userId]
      );
      return true;
    });
    if (!ok) return res.status(404).json({ error: 'Change request not found' });
    res.json({ withdrawn: true });
  } catch (err) {
    if (err instanceof ChangeControlError) return res.status(err.status).json({ error: err.message });
    console.error('Failed to withdraw change request:', err);
    res.status(500).json({ error: 'Failed to withdraw change request' });
  }
});

// ---------- Re-check holds on a business case ----------
// The viewer-grant and re-attribution paths release automatically. This
// covers a decider who gained access some other way (assigned as an
// assessor or a RACI seat, which the visibility rule derives live).
router.post('/business-cases/:id/held-changes/recheck', requireAuth, requirePermission('business_case.edit'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const out = await withTenantContext(organizationId, async (client) => {
      const demandId = await assertCanAccessBusinessCase(client, id, userId);
      if (!demandId) return null;
      return releaseEligibleHolds(client, organizationId, demandId, userId, 'recheck');
    });
    if (!out) return res.status(404).json({ error: 'Business case not found' });
    res.json({ released: out.released.length, releasedIds: out.released, failed: out.failed });
  } catch (err) {
    console.error('Failed to recheck held changes:', err);
    res.status(500).json({ error: 'Failed to recheck held changes' });
  }
});

// ---------- Held changes, across the organisation ----------
// For the recorder's My Home (mine=true) and portfolio reporting.
// Confidentiality is applied here, not in the view: a held change on a
// confidential demand the caller cannot see is simply absent.
router.get('/change-requests/held', requireAuth, requirePermission('business_case.view'), async (req, res) => {
  const { organizationId, userId } = req.user!;
  const mine = req.query.mine === 'true';
  try {
    const rows = await withTenantContext(organizationId, async (client) => {
      const setting = await client.query(`SELECT hold_flag_days FROM change_control_setting WHERE organization_id = $1`, [organizationId]);
      const flagDays: number = setting.rows[0]?.hold_flag_days ?? DEFAULT_HOLD_FLAG_DAYS;
      const r = await client.query(
        `SELECT h.change_request_id, h.demand_id, h.business_case_id, d.title AS demand_title, h.reason,
                h.required_level, h.placed_at, h.days_held, u.display_name AS recorded_by_name,
                att.decider_user_id, decider.display_name AS decider_name, att.decider_external_name
           FROM change_request_held h
           JOIN demand d ON d.id = h.demand_id
           JOIN app_user u ON u.id = h.recorded_by
           LEFT JOIN LATERAL (
             SELECT * FROM change_attestation a WHERE a.change_request_id = h.change_request_id
              ORDER BY a.recorded_at DESC LIMIT 1
           ) att ON true
           LEFT JOIN app_user decider ON decider.id = att.decider_user_id
          WHERE (d.confidential = false OR can_view_confidential_demand(d.id, $1))
            AND ($2::boolean = false OR h.recorded_by = $1)
          ORDER BY h.placed_at ASC`,
        [userId, mine]
      );
      return r.rows.map((x: any) => ({ ...x, overdue: x.days_held >= flagDays, flagAfterDays: flagDays }));
    });
    res.json(rows);
  } catch (err) {
    console.error('Failed to fetch held changes:', err);
    res.status(500).json({ error: 'Failed to fetch held changes' });
  }
});

// ---------- Tenant setting: when a hold counts as overdue ----------
router.get('/change-control-settings', requireAuth, async (req, res) => {
  const { organizationId } = req.user!;
  try {
    const days = await withTenantContext(organizationId, async (client) => {
      const r = await client.query(`SELECT hold_flag_days FROM change_control_setting WHERE organization_id = $1`, [organizationId]);
      return r.rows[0]?.hold_flag_days ?? DEFAULT_HOLD_FLAG_DAYS;
    });
    res.json({ holdFlagDays: days });
  } catch (err) {
    console.error('Failed to fetch change control settings:', err);
    res.status(500).json({ error: 'Failed to fetch change control settings' });
  }
});

router.put('/change-control-settings', requireAuth, requirePermission('org.manage'), async (req, res) => {
  const parsed = z.object({ holdFlagDays: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { organizationId, userId } = req.user!;
  try {
    await withTenantContext(organizationId, async (client) => {
      await client.query(
        `INSERT INTO change_control_setting (organization_id, hold_flag_days, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id) DO UPDATE SET hold_flag_days = $2, updated_by = $3, updated_at = now()`,
        [organizationId, parsed.data.holdFlagDays, userId]
      );
    });
    res.json({ holdFlagDays: parsed.data.holdFlagDays });
  } catch (err) {
    console.error('Failed to update change control settings:', err);
    res.status(500).json({ error: 'Failed to update change control settings' });
  }
});

export default router;
