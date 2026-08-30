import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface Criterion {
  id: string; name: string; dimension: string; unit: string | null;
  baseline_value: number | null; target_value: number | null;
}
interface Score {
  criterion_name: string; max_points: number; weight_pct: number | null;
  score_awarded: number; rationale: string | null;
}
interface SubPortfolio { id: string; name: string; parent_id: string; parent_name: string; }
interface User { id: string; display_name: string; role: string; is_senior: boolean; }

interface Priority {
  total_score: number; weighted_score: number; criteria_scored: number; criteria_available: number;
}
interface Raci {
  accountable_financial_name: string; accountable_scope_name: string;
  accountable_schedule_name: string; sponsor_name: string; benefit_owner_name: string;
}
interface StrategyLink { title: string; alignment_notes: string | null; }
interface Assessment {
  assessed_cost: number | null; assessed_benefit: number | null;
  cost_confidence: string | null; benefit_confidence: string | null;
  assessment_narrative: string | null; assessor_capacity: string | null;
  assessor_detail: string | null; recommendation: string | null;
  assessed_at: string; assessed_by_name: string | null;
}

interface DemandDetail {
  id: string; title: string; description: string; outcome_statement: string; status: string;
  confidential: boolean;
  raised_date: string; need_by_date: string | null; accepted_at: string | null;
  adoption_change_type: string | null; portfolio_name: string;
  raised_by_name: string | null; sponsor_name: string | null;
  complexity_tier: string | null; cost_tier: string | null;
  date_driver_type: string | null; date_driver_detail: string | null;
  claimed_cost: number | null; claimed_benefit: number | null;
  assessment: Assessment | null;
  triaged_at: string | null; triage_notes: string | null; triaged_by_name: string | null;
  stop_reason: string | null; stopped_at: string | null; stopped_by_name: string | null;
  assigned_assessor_id: string | null; assigned_assessor_name: string | null;
  delivering_sub_portfolio_name: string | null; delivering_parent_portfolio_name: string | null;
  delivering_sub_portfolio_id: string | null;
  criteria: Criterion[]; raci: Raci | null; scores: Score[]; priority: Priority;
  strategyLinks: StrategyLink[];
  businessCaseId: string | null;
}

const DATE_DRIVER_LABEL: Record<string, string> = {
  regulatory: 'Regulatory / legislative deadline',
  audit_finding: 'Audit finding remediation',
  contractual: 'Contractual commitment',
  product_launch: 'Product launch dependency',
};

const DIMENSION_LABEL: Record<string, string> = {
  delivery: 'Delivery', adoption: 'Adoption', business: 'Business metric', financial: 'Financial',
};

export function DemandDetail() {
  const { id } = useParams();
  const [demand, setDemand] = useState<DemandDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [subPortfolios, setSubPortfolios] = useState<SubPortfolio[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [complexityTier, setComplexityTier] = useState('');
  const [costTier, setCostTier] = useState('');
  const [triageNotes, setTriageNotes] = useState('');
  const [assignedAssessorId, setAssignedAssessorId] = useState('');
  const [triageError, setTriageError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  const [showStop, setShowStop] = useState(false);
  const [stopReason, setStopReason] = useState('');
  const [stopError, setStopError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  function load() {
    if (!id) return;
    setLoading(true);
    apiFetch(`/api/demands/${id}`).then(setDemand).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }
  useEffect(load, [id]);
  useEffect(() => { apiFetch('/api/portfolios/sub-portfolios/all').then(setSubPortfolios).catch(() => {}); }, []);
  useEffect(() => { apiFetch('/api/users').then(setUsers).catch(() => {}); }, []);

  async function assignSubPortfolio(subPortfolioId: string) {
    if (!id) return;
    setAssignError(null);
    setAssigning(true);
    try {
      await apiFetch(`/api/demands/${id}/delivering-sub-portfolio`, {
        method: 'PATCH',
        body: JSON.stringify({ subPortfolioId: subPortfolioId || null }),
      });
      load();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setAssigning(false);
    }
  }

  async function reassignAssessor(assessorId: string) {
    if (!id) return;
    try {
      await apiFetch(`/api/demands/${id}/assessor`, {
        method: 'PATCH',
        body: JSON.stringify({ assessorId: assessorId || null }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reassign assessor');
    }
  }

  async function submitTriageDecision() {
    if (!id) return;
    setTriageError(null);
    if (!complexityTier || !costTier) {
      setTriageError('Complexity and cost must both be assessed before accepting');
      return;
    }
    setUpdating(true);
    try {
      await apiFetch(`/api/demands/${id}/triage`, {
        method: 'POST',
        body: JSON.stringify({
          complexityTier, costTier, notes: triageNotes || undefined,
          assignedAssessorId: assignedAssessorId || undefined,
        }),
      });
      load();
    } catch (err) {
      setTriageError(err instanceof Error ? err.message : 'Failed to record triage decision');
    } finally {
      setUpdating(false);
    }
  }

  // Stopping is available from any pre-promotion stage - raised,
  // accepted, or assessed - not just at triage. The reason is what
  // carries the nuance ("not the right time" vs "doesn't stack up"),
  // not which status word gets set.
  async function submitStop() {
    if (!id) return;
    setStopError(null);
    if (!stopReason.trim()) {
      setStopError('A reason is required to stop this demand');
      return;
    }
    setStopping(true);
    try {
      await apiFetch(`/api/demands/${id}/stop`, {
        method: 'POST',
        body: JSON.stringify({ reason: stopReason }),
      });
      setShowStop(false);
      setStopReason('');
      load();
    } catch (err) {
      setStopError(err instanceof Error ? err.message : 'Failed to stop this demand');
    } finally {
      setStopping(false);
    }
  }

  if (loading) return <p>Loading...</p>;
  if (error) return <p className="login-error">{error}</p>;
  if (!demand) return <p>Not found.</p>;

  // Rendered inline next to each stage's real primary action (Accept,
  // Assess, Promote) rather than as one isolated control elsewhere on
  // the page - stopping needs to be a visible option AT the point of
  // deciding what happens next, not a separate afterthought lower down.
  // Plain JSX consts, not nested components - a function defined inside
  // render gets a new identity every render, which would remount the
  // textarea below and drop focus on every keystroke.
  const stopButton = (
    <button
      onClick={() => { setShowStop((s) => !s); setStopError(null); }}
      className="btn btn--outline" style={{ fontSize: 12.5 }}
    >
      {showStop ? 'Cancel stop' : 'Stop this demand'}
    </button>
  );

  const stopForm = showStop && (
    <div className="goal-card" style={{ marginTop: 10 }}>
      <div className="goal-card__meta" style={{ marginBottom: 8 }}>Stop this demand</div>
      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 0, marginBottom: 10 }}>
        Stopping isn't a verdict on the idea - it just means it's not moving forward right now.
        The reason is what future readers will actually use, so make it a real one.
      </p>
      <div className="login-field" style={{ marginBottom: 0 }}>
        <label>Reason</label>
        <textarea rows={3} value={stopReason} onChange={(e) => setStopReason(e.target.value)}
          placeholder="e.g. not the right time, superseded by another demand, doesn't stack up financially..."
          style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14, resize: 'vertical' }} />
      </div>
      {stopError && <p className="login-error" style={{ marginTop: 10 }}>{stopError}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={submitStop} disabled={stopping} className="btn btn--outline" style={{ fontSize: 12.5, padding: '7px 14px' }}>
          {stopping ? 'Stopping...' : 'Confirm stop'}
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 660 }}>
      <Link to="/demand" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>&larr; Back to All Demand</Link>

      <h1 className="page-title" style={{ marginTop: 12 }}>
        {demand.title}
        {demand.confidential && (
          <span className="pill pill--indigo" style={{ marginLeft: 10, verticalAlign: 'middle', fontSize: 11 }}>
            Confidential
          </span>
        )}
      </h1>
      <p className="page-subtitle">
        {demand.portfolio_name} (raised)
        {demand.raised_by_name && <> &middot; conceived by {demand.raised_by_name}</>}
        {demand.sponsor_name && <> &middot; sponsor {demand.sponsor_name}</>}
      </p>
      <p className="page-subtitle" style={{ marginTop: -12 }}>
        raised {new Date(demand.raised_date).toLocaleDateString()}
        {demand.need_by_date && <> &middot; needed by {new Date(demand.need_by_date).toLocaleDateString()}</>}
      </p>

      {demand.date_driver_type && demand.date_driver_type !== 'none' && (
        <div style={{
          border: '1.5px solid #E8A317', background: 'rgba(232,163,23,0.06)',
          borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1.25rem',
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#8a6100' }}>
            Fixed date driver - {DATE_DRIVER_LABEL[demand.date_driver_type] ?? demand.date_driver_type}
          </div>
          {demand.date_driver_detail && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{demand.date_driver_detail}</div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
            This demand is not freely deferrable at annual planning - deferring it past its
            required date is permitted, but recorded as an accepted risk.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '1.25rem' }}>
        <div className="goal-card" style={{ marginBottom: 0 }}>
          <div className="goal-card__meta">Current status</div>
          <div className="goal-card__name" style={{ textTransform: 'capitalize' }}>{demand.status}</div>
        </div>
        <div className="goal-card" style={{ marginBottom: 0 }}>
          <div className="goal-card__meta">Weighted priority score</div>
          <div className="goal-card__name">
            {Number(demand.priority.weighted_score ?? 0).toFixed(1)} <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>/ 20
              ({demand.priority.criteria_scored} of {demand.priority.criteria_available} scored)</span>
          </div>
        </div>
        <div className="goal-card" style={{ marginBottom: 0 }}>
          <div className="goal-card__meta">Portfolio</div>
          <div className="goal-card__name" style={{ fontSize: 15 }}>{demand.portfolio_name}</div>
        </div>
        <div className="goal-card" style={{ marginBottom: 0 }}>
          <div className="goal-card__meta">Delivering sub-portfolio</div>
          <div className="goal-card__name" style={{ fontSize: 15 }}>
            {demand.delivering_sub_portfolio_name ?? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Not yet categorised</span>}
          </div>
        </div>
      </div>

      {demand.scores.length > 0 && (
        <div style={{ marginBottom: '1.5rem', border: '2px solid var(--teal)', borderRadius: 'var(--radius)', padding: '1rem 1.15rem' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
            Priority scoring - submitted by conceiver
          </div>
          {demand.scores.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < demand.scores.length - 1 ? '1px solid var(--hairline)' : 'none' }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.criterion_name}</span>
                {s.weight_pct !== null && (
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>weight {s.weight_pct}%</span>
                )}
                {s.rationale && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{s.rationale}</div>}
              </div>
              <span className="pill pill--indigo" style={{ flexShrink: 0, marginLeft: 12 }}>{s.score_awarded} / 20</span>
            </div>
          ))}
        </div>
      )}

      {(demand.claimed_cost !== null || demand.assessment) && (
        <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta" style={{ marginBottom: 10 }}>
            Estimates - claimed at raise, assessed at P75
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', fontSize: 11 }}>
                <th style={{ textAlign: 'left', paddingBottom: 6 }}></th>
                <th style={{ textAlign: 'right', paddingBottom: 6 }}>Claimed (P50)</th>
                <th style={{ textAlign: 'right', paddingBottom: 6 }}>Assessed (P75)</th>
                <th style={{ textAlign: 'right', paddingBottom: 6 }}>Movement</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderTop: '1px solid var(--hairline)' }}>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>Cost</td>
                <td style={{ textAlign: 'right' }}>
                  {demand.claimed_cost !== null ? Number(demand.claimed_cost).toLocaleString() : '-'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {demand.assessment?.assessed_cost != null ? Number(demand.assessment.assessed_cost).toLocaleString() : 'not yet assessed'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {demand.assessment?.assessed_cost != null && demand.claimed_cost !== null
                    ? (() => {
                        const d = Number(demand.assessment.assessed_cost) - Number(demand.claimed_cost);
                        if (d === 0) return <span style={{ color: 'var(--muted)' }}>unchanged</span>;
                        return <span style={{ color: d > 0 ? '#8a6100' : '#0e8f82' }}>{d > 0 ? '+' : ''}{d.toLocaleString()}</span>;
                      })()
                    : '-'}
                </td>
              </tr>
              <tr style={{ borderTop: '1px solid var(--hairline)' }}>
                <td style={{ padding: '8px 0', fontWeight: 600 }}>Benefit</td>
                <td style={{ textAlign: 'right' }}>
                  {demand.claimed_benefit !== null ? Number(demand.claimed_benefit).toLocaleString() : '-'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {demand.assessment?.assessed_benefit != null ? Number(demand.assessment.assessed_benefit).toLocaleString() : 'not yet assessed'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {demand.assessment?.assessed_benefit != null && demand.claimed_benefit !== null
                    ? (() => {
                        const d = Number(demand.assessment.assessed_benefit) - Number(demand.claimed_benefit);
                        if (d === 0) return <span style={{ color: 'var(--muted)' }}>unchanged</span>;
                        return <span style={{ color: d < 0 ? '#8a6100' : '#0e8f82' }}>{d > 0 ? '+' : ''}{d.toLocaleString()}</span>;
                      })()
                    : '-'}
                </td>
              </tr>
            </tbody>
          </table>

          {demand.assessment && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hairline)' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <span className="pill pill--muted">cost confidence: {demand.assessment.cost_confidence}</span>
                <span className="pill pill--muted">benefit confidence: {demand.assessment.benefit_confidence}</span>
                {demand.assessment.recommendation && demand.assessment.recommendation !== 'no_recommendation' && (
                  <span className={`pill ${demand.assessment.recommendation === 'stop' ? 'pill--muted' : 'pill--teal'}`}>
                    recommends {demand.assessment.recommendation}
                  </span>
                )}
              </div>
              {demand.assessment.assessment_narrative && (
                <div style={{ fontSize: 13, marginBottom: 6 }}>{demand.assessment.assessment_narrative}</div>
              )}
              <div className="goal-card__meta" style={{ textTransform: 'none', letterSpacing: 0 }}>
                Assessed by {demand.assessment.assessed_by_name ?? 'unknown'}
                {demand.assessment.assessor_capacity && ` (${demand.assessment.assessor_capacity.replace(/_/g, ' ')}`}
                {demand.assessment.assessor_detail && `, ${demand.assessment.assessor_detail}`}
                {demand.assessment.assessor_capacity && ')'}
                {' '}on {new Date(demand.assessment.assessed_at).toLocaleDateString()}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <div className="goal-card__meta" style={{ marginBottom: 8 }}>Delivering sub-portfolio</div>
        {demand.delivering_sub_portfolio_name ? (
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {demand.delivering_parent_portfolio_name} &rarr; {demand.delivering_sub_portfolio_name}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Not yet categorised - still counts toward {demand.portfolio_name}'s budget until assigned
          </div>
        )}
        <select
          value={demand.delivering_sub_portfolio_id ?? ''}
          onChange={(e) => assignSubPortfolio(e.target.value)}
          disabled={assigning}
          style={{ width: '100%', padding: 8, border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13, marginTop: 10 }}
        >
          <option value="">Not yet categorised</option>
          {subPortfolios.map((s) => (
            <option key={s.id} value={s.id}>{s.parent_name} &rarr; {s.name}</option>
          ))}
        </select>
        {assignError && <p className="login-error" style={{ marginTop: 8 }}>{assignError}</p>}
      </div>

      {demand.accepted_at && (
        <div style={{ marginBottom: '1.25rem' }}>
          <span className="pill pill--teal">Accepted {new Date(demand.accepted_at).toLocaleDateString()}</span>
        </div>
      )}

      {demand.status === 'stopped' && (
        <div className="goal-card" style={{ marginBottom: '1.25rem', border: '1.5px solid var(--hairline)' }}>
          <div className="goal-card__meta">Stopped</div>
          <div className="goal-card__desc" style={{ marginTop: 6 }}>{demand.stop_reason}</div>
          <div className="goal-card__meta" style={{ marginTop: 8 }}>
            {demand.stopped_by_name ?? 'unknown'}{demand.stopped_at ? ` \u00b7 ${new Date(demand.stopped_at).toLocaleDateString()}` : ''}
          </div>
        </div>
      )}

      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <div className="goal-card__meta">Problem statement</div>
        <div className="goal-card__desc" style={{ marginTop: 8 }}>{demand.description}</div>
      </div>

      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <div className="goal-card__meta">Need and output</div>
        <div className="goal-card__desc" style={{ marginTop: 8 }}>{demand.outcome_statement}</div>
      </div>

      {demand.strategyLinks.length > 0 && (
        <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta">Linked objective / strategy</div>
          {demand.strategyLinks.map((s, i) => (
            <div key={i} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
              {s.alignment_notes && <div className="goal-card__desc" style={{ marginTop: 2 }}>{s.alignment_notes}</div>}
            </div>
          ))}
        </div>
      )}

      {demand.criteria.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta" style={{ marginBottom: 8 }}>
            Success measures {demand.accepted_at ? '- preserved original, locked' : '- editable until accepted'}
          </div>
          {demand.criteria.map((c) => (
            <div key={c.id} className="goal-card" style={{ marginBottom: 8 }}>
              <span className="pill pill--teal">{DIMENSION_LABEL[c.dimension] ?? c.dimension}</span>
              <div className="goal-card__desc" style={{ marginTop: 8 }}>{c.name}</div>
              {(c.baseline_value !== null || c.target_value !== null) && (
                <div className="goal-card__meta" style={{ marginTop: 6 }}>
                  {c.baseline_value ?? '?'} {c.unit ?? ''} &rarr; {c.target_value ?? '?'} {c.unit ?? ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(demand.complexity_tier || demand.cost_tier) && (
        <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta">Triage assessment</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {demand.complexity_tier && <span className="pill pill--indigo" style={{ textTransform: 'capitalize' }}>Complexity: {demand.complexity_tier}</span>}
            {demand.cost_tier && <span className="pill pill--indigo" style={{ textTransform: 'capitalize' }}>Cost: {demand.cost_tier}</span>}
          </div>
          {demand.triaged_by_name && (
            <div className="goal-card__meta" style={{ marginTop: 8 }}>
              Assessed by {demand.triaged_by_name}{demand.triaged_at ? ` on ${new Date(demand.triaged_at).toLocaleDateString()}` : ''}
            </div>
          )}
          {demand.triage_notes && <div className="goal-card__desc" style={{ marginTop: 6 }}>{demand.triage_notes}</div>}
        </div>
      )}

      {demand.raci && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta" style={{ marginBottom: 8 }}>RACI seats</div>
          <div className="goal-card">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
              <div><strong>Financial:</strong> {demand.raci.accountable_financial_name}</div>
              <div><strong>Scope:</strong> {demand.raci.accountable_scope_name}</div>
              <div><strong>Schedule:</strong> {demand.raci.accountable_schedule_name}</div>
              <div><strong>Sponsor:</strong> {demand.raci.sponsor_name}</div>
              <div><strong>Benefit Owner:</strong> {demand.raci.benefit_owner_name}</div>
            </div>
          </div>
        </div>
      )}

      {demand.status === 'raised' && (
        <div className="goal-card">
          <div className="goal-card__name" style={{ marginBottom: 10 }}>Triage assessment</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="login-field" style={{ marginBottom: 0 }}>
              <label>Complexity</label>
              <select value={complexityTier} onChange={(e) => setComplexityTier(e.target.value)}
                style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14 }}>
                <option value="">Select</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="login-field" style={{ marginBottom: 0 }}>
              <label>Cost</label>
              <select value={costTier} onChange={(e) => setCostTier(e.target.value)}
                style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14 }}>
                <option value="">Select</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div className="login-field" style={{ marginTop: 10, marginBottom: 0 }}>
            <label>Notes (optional)</label>
            <input type="text" placeholder="Any context for this decision"
              value={triageNotes} onChange={(e) => setTriageNotes(e.target.value)} />
          </div>

          <div className="login-field" style={{ marginTop: 10, marginBottom: 0 }}>
            <label>Tag an assessor (optional)</label>
            <select value={assignedAssessorId} onChange={(e) => setAssignedAssessorId(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14 }}>
              <option value="">Leave open - anyone who can assess picks it up</option>
              {[...users].sort((a, b) => Number(b.is_senior) - Number(a.is_senior)).map((u) => (
                <option key={u.id} value={u.id}>{u.display_name}</option>
              ))}
            </select>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>
              If tagged, this shows in that person's My Actions as their P75 task specifically.
            </p>
          </div>

          {triageError && <p className="login-error" style={{ marginTop: 10 }}>{triageError}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={() => submitTriageDecision()} disabled={updating} className="btn btn--project">
              Accept
            </button>
            {stopButton}
          </div>
          {stopForm}
        </div>
      )}

      {demand.status === 'accepted' && (
        <div>
          <div className="goal-card" style={{ marginBottom: 12 }}>
            <div className="goal-card__meta" style={{ marginBottom: 6 }}>Tagged assessor</div>
            <select
              value={demand.assigned_assessor_id ?? ''}
              onChange={(e) => reassignAssessor(e.target.value)}
              style={{ width: '100%', padding: 8, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 13.5 }}
            >
              <option value="">Open - anyone who can assess picks it up</option>
              {[...users].sort((a, b) => Number(b.is_senior) - Number(a.is_senior)).map((u) => (
                <option key={u.id} value={u.id}>{u.display_name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to={`/demand/${demand.id}/assess`} className="btn btn--project" style={{ textDecoration: 'none' }}>
              Assess (P75)
            </Link>
            {stopButton}
          </div>
          {stopForm}
        </div>
      )}

      {demand.status === 'assessed' && (
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to={`/demand/${demand.id}/accept`} className="btn btn--project" style={{ textDecoration: 'none' }}>
              Build RACI and formally promote
            </Link>
            {stopButton}
          </div>
          {stopForm}
        </div>
      )}

      {demand.status === 'promoted' && demand.businessCaseId && (
        <Link to={`/business-case/${demand.businessCaseId}`} className="btn btn--project" style={{ textDecoration: 'none' }}>
          View business case
        </Link>
      )}

    </div>
  );
}
