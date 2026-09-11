import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

interface PortfolioReportRow {
  portfolio_id: string;
  portfolio_name: string;
  demand_count: number;

  avg_days_raise_to_triage: number | null; n_raise_to_triage: number;
  avg_days_triage_to_assess: number | null; n_triage_to_assess: number;
  avg_days_assess_to_promote: number | null; n_assess_to_promote: number;
  avg_days_promote_to_decision: number | null; n_promote_to_decision: number;
  avg_days_decision_to_delivery_start: number | null; n_decision_to_delivery_start: number;
  avg_days_delivery_duration: number | null; n_delivery_duration: number;
  avg_days_complete_to_adoption: number | null; n_complete_to_adoption: number;
  avg_days_adoption_to_benefit: number | null; n_adoption_to_benefit: number;

  avg_claimed_cost: number | null; n_claimed_cost: number;
  avg_claimed_benefit: number | null; n_claimed_benefit: number;
  avg_assessed_cost: number | null; n_assessed_cost: number;
  avg_assessed_benefit: number | null; n_assessed_benefit: number;
  avg_actual_cost: number | null; n_actual_cost: number;
  avg_actual_benefit: number | null; n_actual_benefit: number;
}

const STAGE_COLUMNS: { key: keyof PortfolioReportRow; nKey: keyof PortfolioReportRow; label: string }[] = [
  { key: 'avg_days_raise_to_triage', nKey: 'n_raise_to_triage', label: 'Raise \u2192 Triage' },
  { key: 'avg_days_triage_to_assess', nKey: 'n_triage_to_assess', label: 'Triage \u2192 Assess' },
  { key: 'avg_days_assess_to_promote', nKey: 'n_assess_to_promote', label: 'Assess \u2192 Promote' },
  { key: 'avg_days_promote_to_decision', nKey: 'n_promote_to_decision', label: 'Promote \u2192 Decision' },
  { key: 'avg_days_decision_to_delivery_start', nKey: 'n_decision_to_delivery_start', label: 'Decision \u2192 Delivery start' },
  { key: 'avg_days_delivery_duration', nKey: 'n_delivery_duration', label: 'Delivery duration' },
  { key: 'avg_days_complete_to_adoption', nKey: 'n_complete_to_adoption', label: 'Complete \u2192 Adoption' },
  { key: 'avg_days_adoption_to_benefit', nKey: 'n_adoption_to_benefit', label: 'Adoption \u2192 Benefit' },
];

const MONEY_COLUMNS: { key: keyof PortfolioReportRow; nKey: keyof PortfolioReportRow; label: string }[] = [
  { key: 'avg_claimed_cost', nKey: 'n_claimed_cost', label: 'Claimed cost (P50)' },
  { key: 'avg_claimed_benefit', nKey: 'n_claimed_benefit', label: 'Claimed benefit (P50)' },
  { key: 'avg_assessed_cost', nKey: 'n_assessed_cost', label: 'Assessed cost (P75)' },
  { key: 'avg_assessed_benefit', nKey: 'n_assessed_benefit', label: 'Assessed benefit (P75)' },
  { key: 'avg_actual_cost', nKey: 'n_actual_cost', label: 'Actual cost (P100)' },
  { key: 'avg_actual_benefit', nKey: 'n_actual_benefit', label: 'Actual benefit (P100)' },
];

// Every average is shown with its sample size, always - never the bare
// number alone. An average of one is not a trend, and this is exactly
// the kind of screen where that's easiest to forget.
function AverageCell({ value, n, isMoney }: { value: number | null; n: number; isMoney?: boolean }) {
  if (value === null || n === 0) {
    return <span style={{ color: 'var(--muted)' }}>&mdash;</span>;
  }
  const formatted = isMoney
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })
    : Number(value).toFixed(1);
  return (
    <span>
      {formatted}
      <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 4 }}>(n={n})</span>
    </span>
  );
}

export function PortfolioReport() {
  const [rows, setRows] = useState<PortfolioReportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  function load() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    apiFetch(`/api/reporting/portfolio-report${qs ? `?${qs}` : ''}`)
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load report'));
  }

  useEffect(load, [from, to]);

  return (
    <div>
      <h1 className="page-title">Portfolio Report</h1>
      <p className="page-subtitle">
        Average days spent in each stage, and average claimed (P50), assessed (P75) and
        actual (P100) figures, per portfolio. Every average is shown with the number of
        demands it's drawn from &mdash; a figure based on one or two demands is not yet a
        trend, and is shown that way deliberately rather than looking more certain than it is.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '1rem 0 1.5rem', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Raised from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ padding: '6px 8px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 12.5 }}
          />
        </label>
        <label style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Raised to
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ padding: '6px 8px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 12.5 }}
          />
        </label>
        {(from || to) && (
          <button
            type="button"
            onClick={() => { setFrom(''); setTo(''); }}
            className="btn btn--outline"
            style={{ fontSize: 11.5, padding: '5px 10px' }}
          >
            Clear (show all-time)
          </button>
        )}
      </div>

      {error && <p className="login-error">{error}</p>}
      {!error && rows === null && <p>Loading...</p>}

      {rows !== null && rows.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>No portfolios found.</p>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, marginTop: '1.5rem', marginBottom: '0.5rem' }}>Time in stage (days)</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Portfolio</th>
                  <th style={thStyle}>Demand count</th>
                  {STAGE_COLUMNS.map((c) => (
                    <th key={c.key} style={thStyle}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.portfolio_id}>
                    <td style={tdStyle}><strong>{r.portfolio_name}</strong></td>
                    <td style={tdStyle}>{r.demand_count}</td>
                    {STAGE_COLUMNS.map((c) => (
                      <td key={c.key} style={tdStyle}>
                        <AverageCell value={r[c.key] as number | null} n={r[c.nKey] as number} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: 15, marginTop: '2rem', marginBottom: '0.5rem' }}>Spend and benefit</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Portfolio</th>
                  {MONEY_COLUMNS.map((c) => (
                    <th key={c.key} style={thStyle}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.portfolio_id}>
                    <td style={tdStyle}><strong>{r.portfolio_name}</strong></td>
                    {MONEY_COLUMNS.map((c) => (
                      <td key={c.key} style={tdStyle}>
                        <AverageCell value={r[c.key] as number | null} n={r[c.nKey] as number} isMoney />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--hairline)',
  fontWeight: 600, whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--muted)',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--hairline)', whiteSpace: 'nowrap',
};
