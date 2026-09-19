// Change request planning, applying, and hold release (the engine behind routes/changeControl.ts).
// See 66_change_control_baselines.sql (baselines) and
// 68_change_request_holds.sql (held state).
//
// A change is PLANNED (validated against the live state, no writes),
// then APPLIED (cost, benefits, descopes, new baseline version, all in
// the caller's transaction). A held change is planned again at
// release time against whatever the state is by then, not against a
// stale snapshot from when it was recorded.

import { getCurrentBaseline, BaselineRow } from './baseline';

export class ChangeControlError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface ChangePayload {
  newApprovedCost?: number;
  newPlannedEndDate?: string;
  newScopeSummary?: string;
  benefitEdits?: { benefitId: string; claimedValue: number }[];
  descopeKpiIds?: string[];
}

export interface ChangePlan {
  current: BaselineRow;
  priorCost: number | null;
  newCost: number | null;
  costChanges: boolean;
  dateChanges: boolean;
  scopeChanges: boolean;
  newPlannedEndDate: string | null;
  newScopeSummary: string | null;
  benefitChanges: { benefitId: string; before: any; claimedValue: number }[];
  descopes: string[];
}

export interface ChangeContext {
  organizationId: string;
  demandId: string;
  businessCaseId: string;
}

export async function planChange(client: any, ctx: ChangeContext, p: ChangePayload): Promise<ChangePlan> {
  const current = await getCurrentBaseline(client, ctx.demandId);
  if (!current) throw new ChangeControlError(409, 'No baseline could be established for this business case.');

  const inv = await client.query(`SELECT approved_amount FROM investment WHERE business_case_id = $1`, [ctx.businessCaseId]);
  const priorCost = inv.rows[0] ? Number(inv.rows[0].approved_amount) : null;
  const costChanges = p.newApprovedCost !== undefined && p.newApprovedCost !== priorCost;
  if (costChanges && priorCost === null) throw new ChangeControlError(409, 'No investment record exists to re-base.');

  const dateChanges = p.newPlannedEndDate !== undefined && p.newPlannedEndDate !== current.planned_end_date;
  const scopeChanges = p.newScopeSummary !== undefined && p.newScopeSummary !== current.scope_summary;

  const benefitChanges: ChangePlan['benefitChanges'] = [];
  for (const edit of p.benefitEdits ?? []) {
    const before = await client.query(
      `SELECT title, claimed_value, recurrence, duration_years FROM benefit WHERE id = $1 AND business_case_id = $2`,
      [edit.benefitId, ctx.businessCaseId]
    );
    if (before.rows.length === 0) throw new ChangeControlError(404, 'A benefit in this request was not found on this business case.');
    if (Number(before.rows[0].claimed_value) !== edit.claimedValue) {
      benefitChanges.push({ benefitId: edit.benefitId, before: before.rows[0], claimedValue: edit.claimedValue });
    }
  }

  const descopes = Array.from(new Set(p.descopeKpiIds ?? []));
  if (descopes.length > 0) {
    const kpis = await client.query(
      `SELECT k.id, ds.id AS already_descoped
         FROM kpi_definition k
         LEFT JOIN kpi_descope ds ON ds.kpi_definition_id = k.id
        WHERE k.id = ANY($1::uuid[]) AND k.demand_id = $2`,
      [descopes, ctx.demandId]
    );
    if (kpis.rows.length !== descopes.length) {
      throw new ChangeControlError(404, 'A success measure in this request does not belong to this demand.');
    }
    if (kpis.rows.some((k: any) => k.already_descoped)) {
      throw new ChangeControlError(409, 'A success measure in this request is already descoped.');
    }
  }

  if (!costChanges && !dateChanges && !scopeChanges && benefitChanges.length === 0 && descopes.length === 0) {
    throw new ChangeControlError(400, 'Nothing in this request differs from the current baseline.');
  }

  return {
    current, priorCost,
    newCost: costChanges ? (p.newApprovedCost as number) : (priorCost ?? current.approved_cost),
    costChanges, dateChanges, scopeChanges,
    newPlannedEndDate: dateChanges ? (p.newPlannedEndDate as string) : null,
    newScopeSummary: scopeChanges ? (p.newScopeSummary as string) : null,
    benefitChanges, descopes,
  };
}

export interface AppliedChange {
  baselineVersionId: string;
  baseline: any;
}

// Writes only. Assumes the plan is fresh (planned in the same transaction).
export async function applyPlan(
  client: any, ctx: ChangeContext, changeRequestId: string, reason: string, recordedBy: string, plan: ChangePlan
): Promise<AppliedChange> {
  if (plan.costChanges) {
    await client.query(`UPDATE investment SET approved_amount = $1 WHERE business_case_id = $2`, [plan.newCost, ctx.businessCaseId]);
    await client.query(
      `INSERT INTO business_case_revision
         (organization_id, business_case_id, field, prior_value, new_value, reason, changed_by, change_request_id)
       VALUES ($1, $2, 'approved_amount', $3, $4, $5, $6, $7)`,
      [ctx.organizationId, ctx.businessCaseId, JSON.stringify(plan.priorCost), JSON.stringify(plan.newCost), reason, recordedBy, changeRequestId]
    );
  }

  for (const b of plan.benefitChanges) {
    await client.query(
      `UPDATE benefit SET claimed_value = $1, updated_at = now() WHERE id = $2 AND business_case_id = $3`,
      [b.claimedValue, b.benefitId, ctx.businessCaseId]
    );
    await client.query(
      `INSERT INTO business_case_revision
         (organization_id, business_case_id, field, reference_id, prior_value, new_value, reason, changed_by, change_request_id)
       VALUES ($1, $2, 'benefit_edited', $3, $4, $5, $6, $7, $8)`,
      [ctx.organizationId, ctx.businessCaseId, b.benefitId, JSON.stringify(b.before),
       JSON.stringify({ ...b.before, claimed_value: b.claimedValue }), reason, recordedBy, changeRequestId]
    );
  }

  for (const kpiId of plan.descopes) {
    await client.query(
      `INSERT INTO kpi_descope (organization_id, kpi_definition_id, change_request_id, created_by) VALUES ($1, $2, $3, $4)`,
      [ctx.organizationId, kpiId, changeRequestId, recordedBy]
    );
  }

  const sum = await client.query(`SELECT SUM(claimed_value) AS total FROM benefit WHERE business_case_id = $1`, [ctx.businessCaseId]);
  const benefitTotal = sum.rows[0].total === null ? null : Number(sum.rows[0].total);

  const version = await client.query(
    `INSERT INTO baseline_version
       (organization_id, demand_id, business_case_id, version_number, kind, predecessor_id, change_request_id,
        approved_cost, benefit_total, planned_end_date, scope_summary, created_by)
     VALUES ($1, $2, $3, $4, 'rebase', $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, version_number, approved_cost, benefit_total,
               to_char(planned_end_date, 'YYYY-MM-DD') AS planned_end_date, scope_summary`,
    [ctx.organizationId, ctx.demandId, ctx.businessCaseId, plan.current.version_number + 1, plan.current.id, changeRequestId,
     plan.newCost, benefitTotal,
     plan.dateChanges ? plan.newPlannedEndDate : plan.current.planned_end_date,
     plan.scopeChanges ? plan.newScopeSummary : plan.current.scope_summary,
     recordedBy]
  );
  return { baselineVersionId: version.rows[0].id, baseline: version.rows[0] };
}

// ---------- Hold release ----------
export type ReleaseVia = 'viewer_grant' | 'reattribution' | 'recheck';

export interface ReleaseResult {
  released: string[];
  failed: { changeRequestId: string; error: string }[];
}

// Releases every held change request on the demand whose effective
// decider can now see it (or is an outside name, which has no login to
// gate). Each release runs in its own savepoint: a change that can no
// longer apply cleanly stays held and is reported, and never breaks the
// caller's own operation (typically adding a viewer).
// onlyChangeRequestId narrows it to one request (re-attribution path).
export async function releaseEligibleHolds(
  client: any,
  organizationId: string,
  demandId: string,
  actorUserId: string,
  via: ReleaseVia,
  opts: { viewerGrantId?: string | null; onlyChangeRequestId?: string } = {}
): Promise<ReleaseResult> {
  const result: ReleaseResult = { released: [], failed: [] };

  const held = await client.query(
    `SELECT cr.id, cr.reason, cr.created_by, cr.business_case_id, h.payload,
            att.decider_user_id
       FROM change_request cr
       JOIN change_request_hold h ON h.change_request_id = cr.id
       LEFT JOIN change_request_resolution res ON res.change_request_id = cr.id
       LEFT JOIN LATERAL (
         SELECT decider_user_id FROM change_attestation a
          WHERE a.change_request_id = cr.id ORDER BY a.recorded_at DESC LIMIT 1
       ) att ON true
      WHERE cr.demand_id = $1 AND res.id IS NULL
        AND ($2::uuid IS NULL OR cr.id = $2::uuid)
      ORDER BY cr.created_at ASC`,
    [demandId, opts.onlyChangeRequestId ?? null]
  );

  for (const row of held.rows) {
    if (row.decider_user_id) {
      const vis = await client.query(`SELECT can_view_confidential_demand($1, $2) AS ok`, [demandId, row.decider_user_id]);
      if (!vis.rows[0].ok) continue; // still can't see it: stays held
    }
    const ctx: ChangeContext = { organizationId, demandId, businessCaseId: row.business_case_id };
    await client.query('SAVEPOINT release_hold');
    try {
      const plan = await planChange(client, ctx, row.payload as ChangePayload);
      const applied = await applyPlan(client, ctx, row.id, row.reason, row.created_by, plan);
      await client.query(
        `INSERT INTO change_request_resolution
           (organization_id, change_request_id, outcome, released_via, viewer_grant_id, baseline_version_id, resolved_by)
         VALUES ($1, $2, 'released', $3, $4, $5, $6)`,
        [organizationId, row.id, via, opts.viewerGrantId ?? null, applied.baselineVersionId, actorUserId]
      );
      await client.query('RELEASE SAVEPOINT release_hold');
      result.released.push(row.id);
    } catch (err: any) {
      await client.query('ROLLBACK TO SAVEPOINT release_hold');
      if (!(err instanceof ChangeControlError)) console.error('Held change could not be released:', row.id, err);
      result.failed.push({ changeRequestId: row.id, error: err instanceof ChangeControlError ? err.message : 'Could not apply' });
    }
  }
  return result;
}
