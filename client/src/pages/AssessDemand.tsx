import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface DemandSummary {
  id: string;
  title: string;
  status: string;
  claimed_cost: number | null;
  claimed_benefit: number | null;
  portfolio_name: string;
  raised_by_name: string | null;
  outcome_statement: string;
  target_start_year: number | null;
  target_start_quarter: number | null;
  target_year_locked_agreed: boolean;
}

const CAPACITIES = [
  { value: 'portfolio_lead', label: 'Portfolio lead' },
  { value: 'business_analyst', label: 'Business analyst' },
  { value: 'technical_consultant', label: 'Technical consultant' },
  { value: 'project_manager', label: 'Project manager' },
  { value: 'third_party', label: 'Third party' },
  { value: 'other', label: 'Other' },
];

export function AssessDemand() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [demand, setDemand] = useState<DemandSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [assessedCost, setAssessedCost] = useState('');
  const [assessedBenefit, setAssessedBenefit] = useState('');
  const [costConfidence, setCostConfidence] = useState('medium');
  const [benefitConfidence, setBenefitConfidence] = useState('medium');
  const [narrative, setNarrative] = useState('');
  const [capacity, setCapacity] = useState('portfolio_lead');
  const [capacityDetail, setCapacityDetail] = useState('');
  const [recommendation, setRecommendation] = useState('proceed');
  const [targetStartYear, setTargetStartYear] = useState('');
  const [targetStartQuarter, setTargetStartQuarter] = useState('');
  const [targetYearError, setTargetYearError] = useState<string | null>(null);

  const currentFY = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const horizonYears = Array.from({ length: 5 }, (_, i) => currentFY + i);

  useEffect(() => {
    if (!id) return;
    apiFetch(`/api/demands/${id}`)
      .then((d: DemandSummary) => {
        setDemand(d);
        if (d.target_start_year) {
          setTargetStartYear(String(d.target_start_year));
          setTargetStartQuarter(d.target_start_quarter ? String(d.target_start_quarter) : '');
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch(`/api/demands/${id}/assessment`, {
        method: 'POST',
        body: JSON.stringify({
          assessedCost: Number(assessedCost),
          assessedBenefit: Number(assessedBenefit),
          costConfidence,
          benefitConfidence,
          assessmentNarrative: narrative,
          assessorCapacity: capacity,
          assessorDetail: capacityDetail || undefined,
          recommendation,
        }),
      });

      let targetYearFailed = false;
      if (!demand?.target_start_year && targetStartYear) {
        try {
          await apiFetch(`/api/demands/${id}/target-year`, {
            method: 'PATCH',
            body: JSON.stringify({
              targetStartYear: Number(targetStartYear),
              targetStartQuarter: targetStartQuarter ? Number(targetStartQuarter) : undefined,
            }),
          });
        } catch (tyErr) {
          targetYearFailed = true;
          setTargetYearError(tyErr instanceof Error ? tyErr.message : 'Could not set the target year.');
        }
      }

      if (!targetYearFailed) navigate(`/demand/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record assessment');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p>Loading...</p>;
  if (!demand) return <p className="login-error">{error ?? 'Not found'}</p>;

  const selectStyle = { width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14 };

  const costDelta = assessedCost ? Number(assessedCost) - (demand.claimed_cost ?? 0) : null;
  const benefitDelta = assessedBenefit ? Number(assessedBenefit) - (demand.claimed_benefit ?? 0) : null;

  function deltaLabel(delta: number | null) {
    if (delta === null || isNaN(delta)) return null;
    if (delta === 0) return <span style={{ color: 'var(--muted)' }}>unchanged from claim</span>;
    const up = delta > 0;
    return (
      <span style={{ color: up ? '#8a6100' : '#0e8f82' }}>
        {up ? '+' : ''}{delta.toLocaleString()} vs claim
      </span>
    );
  }

  return (
    <div style={{ maxWidth: 620 }}>
      <Link to={`/demand/${id}`} style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>
        &larr; Back to demand
      </Link>

      <h1 className="page-title" style={{ marginTop: 12 }}>Assessment</h1>
      <p className="page-subtitle">
        {demand.title} &middot; {demand.portfolio_name}
      </p>

      <div className="goal-card" style={{ marginBottom: '1.5rem', background: 'var(--cloud)' }}>
        <div className="goal-card__meta">The claim being assessed</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Claimed cost</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
              {demand.claimed_cost !== null ? `GBP ${Number(demand.claimed_cost).toLocaleString()}` : 'not stated'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Claimed benefit</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
              {demand.claimed_benefit !== null ? `GBP ${Number(demand.claimed_benefit).toLocaleString()}` : 'not stated'}
            </div>
          </div>
        </div>
        {demand.raised_by_name && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
            Claimed by {demand.raised_by_name}. This stays on the record whatever you find.
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Your assessment
          </label>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>
            Your own figures. They may be higher, lower, or the same as the claim - a confirmed
            claim is as useful a record as a corrected one.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="login-field">
            <label>Assessed cost (GBP)</label>
            <input type="number" step="any" min="0" value={assessedCost}
              onChange={(e) => setAssessedCost(e.target.value)} required />
            <div style={{ fontSize: 11.5, marginTop: 4 }}>{deltaLabel(costDelta)}</div>
          </div>
          <div className="login-field">
            <label>Assessed benefit (GBP)</label>
            <input type="number" step="any" min="0" value={assessedBenefit}
              onChange={(e) => setAssessedBenefit(e.target.value)} required />
            <div style={{ fontSize: 11.5, marginTop: 4 }}>{deltaLabel(benefitDelta)}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="login-field">
            <label>Confidence in the cost</label>
            <select value={costConfidence} onChange={(e) => setCostConfidence(e.target.value)} style={selectStyle}>
              <option value="high">High - firm quote or equivalent</option>
              <option value="medium">Medium - analysed, some unknowns</option>
              <option value="low">Low - still largely an estimate</option>
            </select>
          </div>
          <div className="login-field">
            <label>Confidence in the benefit</label>
            <select value={benefitConfidence} onChange={(e) => setBenefitConfidence(e.target.value)} style={selectStyle}>
              <option value="high">High - evidenced and measurable</option>
              <option value="medium">Medium - plausible, partly evidenced</option>
              <option value="low">Low - largely assertion</option>
            </select>
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: -6, marginBottom: '1.25rem' }}>
          These are deliberately separate - a firm quote with a speculative benefit case is a
          real and common state, and worth showing plainly.
        </p>

        <div className="login-field">
          <label>What did you find?</label>
          <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)}
            rows={4} required
            placeholder="What changed from the claim and why - or why it stands as claimed."
            style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontFamily: 'var(--font-body)', fontSize: 14 }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="login-field">
            <label>Assessed in what capacity</label>
            <select value={capacity} onChange={(e) => setCapacity(e.target.value)} style={selectStyle}>
              {CAPACITIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="login-field">
            <label>Detail (optional)</label>
            <input type="text" placeholder="e.g. the third party's name"
              value={capacityDetail} onChange={(e) => setCapacityDetail(e.target.value)} />
          </div>
        </div>

        <div className="login-field">
          <label>Recommendation</label>
          <select value={recommendation} onChange={(e) => setRecommendation(e.target.value)} style={selectStyle}>
            <option value="proceed">Proceed - take to planning</option>
            <option value="stop">Stop - the economics do not hold up</option>
            <option value="no_recommendation">No recommendation - figures only</option>
          </select>
          <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
            Assessment is analytical, but better numbers legitimately stop work. A stop
            recommendation does not itself stop the demand - that is a separate decision.
          </p>
        </div>

        <div className="login-field">
          <label>Target year</label>
          {demand.target_start_year ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              FY{String(demand.target_start_year).slice(-2)}
              {demand.target_start_quarter ? ` Q${demand.target_start_quarter}` : ''} - already set.
              {demand.target_year_locked_agreed
                ? ' Locked on an Agreed annual plan.'
                : ' Use the Five-Year Horizon view to move it (a portfolio lead or admin can drag it, with a reason).'}
            </p>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 6px' }}>
                No target year set yet. Realistically, which financial year does this land in?
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <select value={targetStartYear} onChange={(e) => setTargetStartYear(e.target.value)} style={selectStyle}>
                  <option value="">Leave unset</option>
                  {horizonYears.map((y) => <option key={y} value={y}>FY{String(y).slice(-2)}</option>)}
                </select>
                <select
                  value={targetStartQuarter}
                  onChange={(e) => setTargetStartQuarter(e.target.value)}
                  disabled={!targetStartYear}
                  style={selectStyle}
                >
                  <option value="">Whole year</option>
                  <option value="1">Q1</option>
                  <option value="2">Q2</option>
                  <option value="3">Q3</option>
                  <option value="4">Q4</option>
                </select>
              </div>
              {targetYearError && <p className="login-error" style={{ marginTop: 6 }}>{targetYearError}</p>}
            </>
          )}
        </div>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" disabled={submitting} className="btn btn--project">
          {submitting ? 'Recording...' : 'Record assessment'}
        </button>
      </form>
    </div>
  );
}
