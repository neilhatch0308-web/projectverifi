import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface Portfolio {
  id: string;
  name: string;
}

interface ScoringCriterion {
  id: string;
  name: string;
  description: string | null;
  max_points: number;
  is_fixed: boolean;
}

interface Criterion {
  dimension: 'delivery' | 'adoption' | 'business' | 'financial';
  measure: string;
  baselineValue: string;
  targetValue: string;
  unit: string;
}

const DIMENSIONS: { key: Criterion['dimension']; label: string; hint: string }[] = [
  { key: 'delivery', label: 'Delivery', hint: 'e.g. delivered within 6 months at budget' },
  { key: 'adoption', label: 'Adoption', hint: 'e.g. used by 80% of the team by month 12' },
  { key: 'business', label: 'Business metric', hint: 'e.g. forecast accuracy improves from 87% to 94%' },
  { key: 'financial', label: 'Financial', hint: 'e.g. saves 50000 per year in labour' },
];

export function RaiseDemand() {
  const navigate = useNavigate();
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [scoringCriteria, setScoringCriteria] = useState<ScoringCriterion[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [portfolioId, setPortfolioId] = useState('');
  const [changeType, setChangeType] = useState('');
  const [selectedDimensions, setSelectedDimensions] = useState<Set<Criterion['dimension']>>(new Set(['adoption']));
  const [criteria, setCriteria] = useState<Record<string, Criterion>>({
    adoption: { dimension: 'adoption', measure: '', baselineValue: '', targetValue: '', unit: '' },
  });
  const [scores, setScores] = useState<Record<string, { applies: boolean; value: string; rationale: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/api/portfolios').then(setPortfolios).catch((err) => setError(err.message));
    apiFetch('/api/scoring-criteria').then(setScoringCriteria).catch((err) => setError(err.message));
  }, []);

  function toggleDimension(dim: Criterion['dimension']) {
    setSelectedDimensions((prev) => {
      const next = new Set(prev);
      if (next.has(dim)) {
        next.delete(dim);
      } else {
        next.add(dim);
        setCriteria((c) => ({
          ...c,
          [dim]: c[dim] ?? { dimension: dim, measure: '', baselineValue: '', targetValue: '', unit: '' },
        }));
      }
      return next;
    });
  }

  function updateCriterion(dim: string, field: keyof Criterion, value: string) {
    setCriteria((c) => ({ ...c, [dim]: { ...c[dim], [field]: value } }));
  }

  function updateScore(criterionId: string, field: 'applies' | 'value' | 'rationale', value: boolean | string) {
    setScores((s) => ({
      ...s,
      [criterionId]: { applies: false, value: '', rationale: '', ...s[criterionId], [field]: value },
    }));
  }

  const totalPossible = scoringCriteria.reduce((sum, c) => sum + c.max_points, 0);
  const totalAwarded = scoringCriteria.reduce((sum, c) => {
    const s = scores[c.id];
    if (!s) return sum;
    if (c.is_fixed) return sum + (s.applies ? c.max_points : 0);
    return sum + (Number(s.value) || 0);
  }, 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const activeCriteria = Array.from(selectedDimensions).map((dim) => criteria[dim]);
    if (activeCriteria.some((c) => !c.measure.trim())) {
      setError('Every selected dimension needs a success measure filled in');
      return;
    }

    const scorePayload = scoringCriteria
      .map((c) => {
        const s = scores[c.id];
        if (!s) return null;
        const value = c.is_fixed ? (s.applies ? c.max_points : 0) : Number(s.value) || 0;
        if (value === 0 && !s.rationale) return null;
        return { criterionId: c.id, scoreAwarded: value, rationale: s.rationale || undefined };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    setSubmitting(true);
    try {
      const demand = await apiFetch('/api/demands', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          portfolioId,
          adoptionChangeType: changeType || null,
          criteria: activeCriteria,
          scores: scorePayload,
        }),
      });
      navigate(`/demand/${demand.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to raise demand');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <h1 className="page-title">Raise Demand</h1>
      <p className="page-subtitle">What problem has been raised, and what does success look like?</p>

      <form onSubmit={handleSubmit}>
        <div className="login-field">
          <label>Raising division</label>
          <select
            value={portfolioId}
            onChange={(e) => setPortfolioId(e.target.value)}
            required
            style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14 }}
          >
            <option value="">Select division</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="login-field">
          <label>Problem title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Regional forecast data remains manual and error-prone"
            required
          />
        </div>

        <div className="login-field">
          <label>Problem statement</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the current state and why it matters"
            required
            rows={4}
            style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontFamily: 'var(--font-body)', fontSize: 14 }}
          />
        </div>

        <div className="login-field">
          <label>Adoption change type (optional)</label>
          <select
            value={changeType}
            onChange={(e) => setChangeType(e.target.value)}
            style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14 }}
          >
            <option value="">Not applicable</option>
            <option value="process">Process - people work differently</option>
            <option value="tool">Tool - a new system</option>
            <option value="both">Both</option>
          </select>
        </div>

        {/* ---------- Priority scoring ---------- */}
        <div style={{ marginTop: '1.75rem', marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Priority scoring
          </label>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
            Score against the org's criteria to help triage weigh this fairly against
            everything else raised. Optional per criterion - unscored just means unweighted.
            {totalPossible > 0 && (
              <> Running total: <strong>{totalAwarded} / {totalPossible}</strong></>
            )}
          </p>
        </div>

        {scoringCriteria.map((c) => (
          <div key={c.id} className="goal-card" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div className="goal-card__name">{c.name}</div>
              <span className="pill pill--muted">max {c.max_points}</span>
            </div>
            {c.description && <div className="goal-card__meta" style={{ marginTop: 4 }}>{c.description}</div>}

            {c.is_fixed ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={scores[c.id]?.applies ?? false}
                  onChange={(e) => updateScore(c.id, 'applies', e.target.checked)}
                />
                This applies (awards full {c.max_points} points)
              </label>
            ) : (
              <div className="login-field" style={{ marginTop: 10, marginBottom: 0 }}>
                <label>Score (0 - {c.max_points})</label>
                <input
                  type="number"
                  min={0}
                  max={c.max_points}
                  value={scores[c.id]?.value ?? ''}
                  onChange={(e) => updateScore(c.id, 'value', e.target.value)}
                />
              </div>
            )}

            <div className="login-field" style={{ marginTop: 8, marginBottom: 0 }}>
              <label>Rationale (optional)</label>
              <input
                type="text"
                placeholder="Why this score?"
                value={scores[c.id]?.rationale ?? ''}
                onChange={(e) => updateScore(c.id, 'rationale', e.target.value)}
              />
            </div>
          </div>
        ))}

        {/* ---------- Success measures ---------- */}
        <div style={{ marginTop: '1.5rem', marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            Success measures
          </label>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
            Pick which dimensions apply. These are captured now and preserved -
            changing them later requires an approved re-base, not a direct edit.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            {DIMENSIONS.map((d) => (
              <div
                key={d.key}
                onClick={() => toggleDimension(d.key)}
                style={{
                  border: selectedDimensions.has(d.key) ? '2px solid var(--teal)' : '1px solid var(--hairline)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  background: selectedDimensions.has(d.key) ? 'rgba(23,195,178,0.06)' : '#fff',
                }}
              >
                {d.label}
              </div>
            ))}
          </div>
        </div>

        {DIMENSIONS.filter((d) => selectedDimensions.has(d.key)).map((d) => (
          <div key={d.key} className="goal-card" style={{ marginBottom: 10 }}>
            <div className="goal-card__name">{d.label} criterion</div>
            <div className="login-field" style={{ marginTop: 10, marginBottom: 8 }}>
              <label>Success measure</label>
              <input
                type="text"
                placeholder={d.hint}
                value={criteria[d.key]?.measure ?? ''}
                onChange={(e) => updateCriterion(d.key, 'measure', e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div className="login-field" style={{ marginBottom: 0 }}>
                <label>Baseline</label>
                <input
                  type="text"
                  value={criteria[d.key]?.baselineValue ?? ''}
                  onChange={(e) => updateCriterion(d.key, 'baselineValue', e.target.value)}
                />
              </div>
              <div className="login-field" style={{ marginBottom: 0 }}>
                <label>Target</label>
                <input
                  type="text"
                  value={criteria[d.key]?.targetValue ?? ''}
                  onChange={(e) => updateCriterion(d.key, 'targetValue', e.target.value)}
                />
              </div>
              <div className="login-field" style={{ marginBottom: 0 }}>
                <label>Unit</label>
                <input
                  type="text"
                  placeholder="%, GBP, days..."
                  value={criteria[d.key]?.unit ?? ''}
                  onChange={(e) => updateCriterion(d.key, 'unit', e.target.value)}
                />
              </div>
            </div>
          </div>
        ))}

        {error && <p className="login-error" style={{ marginTop: 12 }}>{error}</p>}

        <button type="submit" disabled={submitting} className="btn btn--project" style={{ marginTop: 8 }}>
          {submitting ? 'Raising...' : 'Raise demand'}
        </button>
      </form>
    </div>
  );
}
