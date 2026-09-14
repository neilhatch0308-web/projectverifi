import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface PortfolioRow {
  portfolio_id: string;
  portfolio_name: string;
  n_approved_cases: number;
  total_approved: number;
  total_actual: number;
  variance_amount: number;
  variance_pct: number | null;
  n_overrun: number;
}

interface CaseRow {
  business_case_id: string;
  demand_id: string;
  title: string;
  portfolio_id: string;
  portfolio_name: string;
  decision_date: string | null;
  approved_amount: number | null;
  actual_spend_to_date: number | null;
  variance_amount: number | null;
  variance_pct: number | null;
  is_overrun: boolean;
}

function Money({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--muted)' }}>&mdash;</span>;
  return <span>{Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>;
}

// Colour band on variance_pct: negative (overrun, spend has overtaken
// approval) is always red regardless of size -- an overrun of any
// size is the same failure mode. Positive (approved but unspent) is
// banded by how large the gap is, since a small unspent margin is
// normal timing lag, not a signal.
function varianceColor(pct: number | null, isOverrun: boolean): string {
  if (isOverrun || (pct !== null && pct < 0)) return '#b03a3a'; // red -- overrun
  if (pct === null) return 'var(--muted)'; // no approved spend yet, nothing to band
  if (pct >= 40) return '#c58a1a'; // amber -- large unspent exposure
  return '#3f7d52'; // green -- on track
}

function VarianceBadge({ pct, isOverrun }: { pct: number | null; isOverrun: boolean }) {
  const color = varianceColor(pct, isOverrun);
  if (pct === null) return <span style={{ color }}>&mdash;</span>;
  const sign = pct > 0 ? '+' : '';
  return <span style={{ color, fontWeight: 600 }}>{sign}{pct}%</span>;
}

export function CommitmentReport() {
  const [portfolioRows, setPortfolioRows] = useState<PortfolioRow[] | null>(null);
  const [caseRows, setCaseRows] = useState<CaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    apiFetch('/api/reporting/commitment')
      .then(setPortfolioRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load report'));
  }, []);

  useEffect(() => {
    const qs = selectedPortfolio ? `?portfolioId=${selectedPortfolio.id}` : '';
    apiFetch(`/api/reporting/commitment/cases${qs}`)
      .then(setCaseRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load case list'));
  }, [selectedPortfolio]);

  // Headline figures, derived from the portfolio rows already loaded --
  // no separate endpoint, same "don't re-derive what's already fetched"
  // discipline as everything else in this reporting suite.
  const totals = portfolioRows?.reduce(
    (acc, r) => ({
      approved: acc.approved + Number(r.total_approved),
      actual: acc.actual + Number(r.total_actual),
      overrunCases: acc.overrunCases + Number(r.n_overrun),
    }),
    { approved: 0, actual: 0, overrunCases: 0 }
  ) ?? null;
  const unspentExposure = totals ? totals.approved - totals.actual : null;

  return (
    <div>
      <h1 className="page-title">Commitment Report</h1>
      <p className="page-subtitle">
        Approved spend (investment.approved_amount) vs actual spend to date, for business
        cases with a recorded decision of approved. Positive variance is money approved but
        not yet spent; negative is spend that has overtaken what was approved &mdash; an
        overrun in flight, not yet reconciled. Sorted worst first, either direction.
      </p>

      {error && <p className="login-error">{error}</p>}

      {totals && (
        <div style={{ display: 'flex', gap: 24, margin: '1rem 0 1.75rem', flexWrap: 'wrap' }}>
          <div>
            <div style={headlineLabel}>Approved, not yet spent</div>
            <div style={{ ...headlineValue, color: unspentExposure !== null && unspentExposure < 0 ? '#b03a3a' : 'var(--graphite)' }}>
              <Money value={unspentExposure} />
            </div>
          </div>
          <div>
            <div style={headlineLabel}>Business cases over approved</div>
            <div style={{ ...headlineValue, color: totals.overrunCases > 0 ? '#b03a3a' : 'var(--graphite)' }}>
              {totals.overrunCases}
            </div>
          </div>
        </div>
      )}

      {!error && portfolioRows === null && <p>Loading...</p>}
      {portfolioRows !== null && portfolioRows.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>No approved business cases yet &mdash; nothing to compare against.</p>
      )}

      {portfolioRows !== null && portfolioRows.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Portfolio</th>
                <th style={thStyle}>Approved cases</th>
                <th style={thStyle}>Approved</th>
                <th style={thStyle}>Actual to date</th>
                <th style={thStyle}>Variance</th>
                <th style={thStyle}>Over approved</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {portfolioRows.map((r) => (
                <tr key={r.portfolio_id} style={selectedPortfolio?.id === r.portfolio_id ? { background: 'var(--cloud)' } : undefined}>
                  <td style={tdStyle}>{r.portfolio_name}</td>
                  <td style={tdStyle}>{r.n_approved_cases}</td>
                  <td style={tdStyle}><Money value={r.total_approved} /></td>
                  <td style={tdStyle}><Money value={r.total_actual} /></td>
                  <td style={tdStyle}><VarianceBadge pct={r.variance_pct} isOverrun={r.n_overrun > 0} /></td>
                  <td style={tdStyle}>
                    {r.n_overrun > 0
                      ? <span style={{ color: '#b03a3a', fontWeight: 600 }}>{r.n_overrun}</span>
                      : <span style={{ color: 'var(--muted)' }}>0</span>}
                  </td>
                  <td style={tdStyle}>
                    {r.n_approved_cases > 0 && (
                      <button
                        type="button"
                        className="btn btn--outline"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={() =>
                          setSelectedPortfolio(
                            selectedPortfolio?.id === r.portfolio_id ? null : { id: r.portfolio_id, name: r.portfolio_name }
                          )
                        }
                      >
                        {selectedPortfolio?.id === r.portfolio_id ? 'Showing this portfolio' : 'View cases'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem' }}>
        {selectedPortfolio ? `Business cases — ${selectedPortfolio.name}` : 'All business cases'}
      </h2>
      {selectedPortfolio && (
        <button
          type="button"
          className="btn btn--outline"
          style={{ fontSize: 11, padding: '4px 10px', marginBottom: 12 }}
          onClick={() => setSelectedPortfolio(null)}
        >
          Clear filter
        </button>
      )}

      {caseRows !== null && caseRows.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>No approved business cases here yet.</p>
      )}

      {caseRows !== null && caseRows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Business case</th>
                <th style={thStyle}>Portfolio</th>
                <th style={thStyle}>Decided</th>
                <th style={thStyle}>Approved</th>
                <th style={thStyle}>Actual to date</th>
                <th style={thStyle}>Variance</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {caseRows.map((c) => (
                <tr key={c.business_case_id}>
                  <td style={tdStyle}>{c.title}</td>
                  <td style={tdStyle}>{c.portfolio_name}</td>
                  <td style={tdStyle}>{c.decision_date ?? <span style={{ color: 'var(--muted)' }}>&mdash;</span>}</td>
                  <td style={tdStyle}><Money value={c.approved_amount} /></td>
                  <td style={tdStyle}><Money value={c.actual_spend_to_date} /></td>
                  <td style={tdStyle}><VarianceBadge pct={c.variance_pct} isOverrun={c.is_overrun} /></td>
                  <td style={tdStyle}>
                    <Link to={`/business-case/${c.business_case_id}`} className="btn btn--outline" style={{ fontSize: 11, padding: '4px 10px', textDecoration: 'none' }}>
                      {c.is_overrun ? 'Record revision' : 'Open'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const headlineLabel: React.CSSProperties = {
  fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
};
const headlineValue: React.CSSProperties = {
  fontSize: '1.6rem', fontWeight: 700, fontFamily: 'var(--font-display)',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--hairline)',
  fontWeight: 600, whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--muted)',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--hairline)', whiteSpace: 'nowrap',
};