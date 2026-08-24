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
interface Priority {
  total_score: number; weighted_score: number; criteria_scored: number; criteria_available: number;
}
interface Raci {
  accountable_financial_name: string; accountable_scope_name: string;
  accountable_schedule_name: string; sponsor_name: string; benefit_owner_name: string;
}
interface StrategyLink { title: string; alignment_notes: string | null; }

interface DemandDetail {
  id: string; title: string; description: string; outcome_statement: string; status: string;
  raised_date: string; need_by_date: string | null; accepted_at: string | null;
  adoption_change_type: string | null; portfolio_name: string;
  raised_by_name: string | null; sponsor_name: string | null;
  complexity_tier: string | null; cost_tier: string | null;
  triaged_at: string | null; triage_notes: string | null; triaged_by_name: string | null;
  criteria: Criterion[]; raci: Raci | null; scores: Score[]; priority: Priority;
  strategyLinks: StrategyLink[];
  businessCaseId: string | null;
}

const DIMENSION_LABEL: Record<string, string> = {
  delivery: 'Delivery', adoption: 'Adoption', business: 'Business metric', financial: 'Financial',
};

export function DemandDetail() {
  const { id } = useParams();
  const [demand, setDemand] = useState<DemandDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [complexityTier, setComplexityTier] = useState('');
  const [costTier, setCostTier] = useState('');
  const [triageNotes, setTriageNotes] = useState('');
  const [triageError, setTriageError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    apiFetch(`/api/demands/${id}`).then(setDemand).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }
  useEffect(load, [id]);

  async function submitTriageDecision(decision: 'accepted' | 'rejected') {
    if (!id) return;
    setTriageError(null);
    if (!complexityTier || !costTier) {
      setTriageError('Complexity and cost must both be assessed before a decision can be recorded');
      return;
    }
    setUpdating(true);
    try {
      await apiFetch(`/api/demands/${id}/triage`, {
        method: 'POST',
        body: JSON.stringify({ decision, complexityTier, costTier, notes: triageNotes || undefined }),
      });
      load();
    } catch (err) {
      setTriageError(err instanceof Error ? err.message : 'Failed to record triage decision');
    } finally {
      setUpdating(false);
    }
  }

  if (loading) return <p>Loading...</p>;
  if (error) return <p className="login-error">{error}</p>;
  if (!demand) return <p>Not found.</p>;

  return (
    <div style={{ maxWidth: 660 }}>
      <Link to="/demand" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>&larr; Back to All Demand</Link>

      <h1 className="page-title" style={{ marginTop: 12 }}>{demand.title}</h1>
      <p className="page-subtitle">
        {demand.portfolio_name}
        {demand.raised_by_name && <> &middot; conceived by {demand.raised_by_name}</>}
        {demand.sponsor_name && <> &middot; sponsor {demand.sponsor_name}</>}
      </p>
      <p className="page-subtitle" style={{ marginTop: -12 }}>
        raised {new Date(demand.raised_date).toLocaleDateString()}
        {demand.need_by_date && <> &middot; needed by {new Date(demand.need_by_date).toLocaleDateString()}</>}
      </p>

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

      {demand.accepted_at && (
        <div style={{ marginBottom: '1.25rem' }}>
          <span className="pill pill--teal">Accepted {new Date(demand.accepted_at).toLocaleDateString()}</span>
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

          {triageError && <p className="login-error" style={{ marginTop: 10 }}>{triageError}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={() => submitTriageDecision('accepted')} disabled={updating} className="btn btn--project">
              Accept
            </button>
            <button onClick={() => submitTriageDecision('rejected')} disabled={updating} className="btn btn--outline">
              Reject
            </button>
          </div>
        </div>
      )}

      {demand.status === 'accepted' && (
        <Link to={`/demand/${demand.id}/accept`} className="btn btn--project" style={{ textDecoration: 'none' }}>
          Build RACI and formally promote
        </Link>
      )}

      {demand.status === 'promoted' && demand.businessCaseId && (
        <Link to={`/business-case/${demand.businessCaseId}`} className="btn btn--project" style={{ textDecoration: 'none' }}>
          View business case
        </Link>
      )}
    </div>
  );
}