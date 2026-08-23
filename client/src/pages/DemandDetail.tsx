import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface Criterion {
  id: string;
  name: string;
  dimension: string;
  unit: string | null;
  baseline_value: number | null;
  target_value: number | null;
}

interface Score {
  criterion_name: string;
  max_points: number;
  score_awarded: number;
  rationale: string | null;
}

interface Priority {
  total_score: number;
  criteria_scored: number;
  criteria_available: number;
}

interface Raci {
  accountable_financial_name: string;
  accountable_scope_name: string;
  accountable_schedule_name: string;
  sponsor_name: string;
  benefit_owner_name: string;
}

interface DemandDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  raised_date: string;
  accepted_at: string | null;
  adoption_change_type: string | null;
  portfolio_name: string;
  raised_by_name: string | null;
  criteria: Criterion[];
  raci: Raci | null;
  scores: Score[];
  priority: Priority;
}

const DIMENSION_LABEL: Record<string, string> = {
  delivery: 'Delivery',
  adoption: 'Adoption',
  business: 'Business metric',
  financial: 'Financial',
};

export function DemandDetail() {
  const { id } = useParams();
  const [demand, setDemand] = useState<DemandDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  function load() {
    if (!id) return;
    setLoading(true);
    apiFetch(`/api/demands/${id}`)
      .then(setDemand)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  async function moveToStatus(status: string) {
    if (!id) return;
    setUpdating(true);
    try {
      await apiFetch(`/api/demands/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdating(false);
    }
  }

  if (loading) return <p>Loading...</p>;
  if (error) return <p className="login-error">{error}</p>;
  if (!demand) return <p>Not found.</p>;

  const totalPossible = demand.scores.reduce((sum, s) => sum + s.max_points, 0);

  return (
    <div style={{ maxWidth: 640 }}>
      <Link to="/demand" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>
        &larr; Back to All Demand
      </Link>

      <h1 className="page-title" style={{ marginTop: 12 }}>{demand.title}</h1>
      <p className="page-subtitle">
        {demand.portfolio_name} &middot; raised {new Date(demand.raised_date).toLocaleDateString()}
        {demand.raised_by_name && <> by {demand.raised_by_name}</>}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: '1.25rem' }}>
        <div className="goal-card" style={{ marginBottom: 0 }}>
          <div className="goal-card__meta">Current status</div>
          <div className="goal-card__name" style={{ textTransform: 'capitalize' }}>{demand.status}</div>
        </div>
        <div className="goal-card" style={{ marginBottom: 0 }}>
          <div className="goal-card__meta">Priority score</div>
          <div className="goal-card__name">
            {demand.priority.total_score} <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>
              {totalPossible > 0 ? `/ ${totalPossible} possible` : ''} ({demand.priority.criteria_scored} of {demand.priority.criteria_available} criteria scored)
            </span>
          </div>
        </div>
      </div>

      {demand.accepted_at && (
        <div style={{ marginBottom: '1.25rem' }}>
          <span className="pill pill--teal">
            Accepted {new Date(demand.accepted_at).toLocaleDateString()}
          </span>
        </div>
      )}

      <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
        <div className="goal-card__meta">Problem statement</div>
        <div className="goal-card__desc" style={{ marginTop: 8 }}>{demand.description}</div>
      </div>

      {demand.scores.length > 0 && (
        <div style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta" style={{ marginBottom: 8 }}>Priority scoring breakdown</div>
          {demand.scores.map((s, i) => (
            <div key={i} className="goal-card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.criterion_name}</span>
                <span className="pill pill--indigo">{s.score_awarded} / {s.max_points}</span>
              </div>
              {s.rationale && <div className="goal-card__desc" style={{ marginTop: 6 }}>{s.rationale}</div>}
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

      {demand.adoption_change_type && (
        <div className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="goal-card__meta">Adoption change type</div>
          <div className="goal-card__desc" style={{ marginTop: 8, textTransform: 'capitalize' }}>
            {demand.adoption_change_type}
          </div>
        </div>
      )}

      {demand.status === 'raised' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => moveToStatus('triaged')} disabled={updating} className="btn btn--project">
            Move to Triaged
          </button>
          <button onClick={() => moveToStatus('rejected')} disabled={updating} className="btn btn--outline">
            Reject
          </button>
        </div>
      )}

      {demand.status === 'triaged' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/demand/${demand.id}/accept`} className="btn btn--project" style={{ textDecoration: 'none' }}>
            Accept demand (name RACI seats)
          </Link>
          <button onClick={() => moveToStatus('rejected')} disabled={updating} className="btn btn--outline">
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
