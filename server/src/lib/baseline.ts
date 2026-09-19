// Baseline v1 = the business case approval. See 66_change_control_baselines.sql.
// Shared by the decision route (creates v1 on approve) and the change
// request route (creates v1 lazily if an approved case somehow has none).

export interface BaselineRow {
  id: string;
  version_number: number;
  approved_cost: number | null;
  benefit_total: number | null;
  planned_end_date: string | null;
  scope_summary: string | null;
}

function num(v: unknown): number | null {
  // numeric columns come back from pg as strings - always Number() them.
  return v === null || v === undefined ? null : Number(v);
}

export async function getCurrentBaseline(client: any, demandId: string): Promise<BaselineRow | null> {
  const r = await client.query(
    `SELECT id, version_number, approved_cost, benefit_total,
            to_char(planned_end_date, 'YYYY-MM-DD') AS planned_end_date, scope_summary
       FROM baseline_version
      WHERE demand_id = $1
      ORDER BY version_number DESC LIMIT 1`,
    [demandId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    version_number: row.version_number,
    approved_cost: num(row.approved_cost),
    benefit_total: num(row.benefit_total),
    planned_end_date: row.planned_end_date,
    scope_summary: row.scope_summary,
  };
}

// Creates v1 from the case's current figures if the demand has no
// baseline yet. backfilled = true marks a v1 built after the fact
// rather than captured at the moment of approval.
export async function ensureApprovedBaseline(
  client: any,
  organizationId: string,
  businessCaseId: string,
  userId: string | null,
  backfilled: boolean
): Promise<void> {
  const bc = await client.query(
    `SELECT bc.demand_id, COALESCE(d.outcome_statement, d.title) AS scope_summary,
            (SELECT i.approved_amount FROM investment i WHERE i.business_case_id = bc.id) AS approved_cost,
            (SELECT SUM(b.claimed_value) FROM benefit b WHERE b.business_case_id = bc.id) AS benefit_total,
            (SELECT to_char(dd.planned_end_date, 'YYYY-MM-DD') FROM demand_delivery dd WHERE dd.demand_id = bc.demand_id) AS planned_end_date
       FROM business_case bc
       JOIN demand d ON d.id = bc.demand_id
      WHERE bc.id = $1`,
    [businessCaseId]
  );
  const row = bc.rows[0];
  if (!row || !row.demand_id) return;

  await client.query(
    `INSERT INTO baseline_version
       (organization_id, demand_id, business_case_id, version_number, kind,
        approved_cost, benefit_total, planned_end_date, scope_summary, backfilled, created_by)
     VALUES ($1, $2, $3, 1, 'approved', $4, $5, $6, $7, $8, $9)
     ON CONFLICT (demand_id, version_number) DO NOTHING`,
    [organizationId, row.demand_id, businessCaseId, num(row.approved_cost), num(row.benefit_total),
     row.planned_end_date, row.scope_summary, backfilled, userId]
  );
}
