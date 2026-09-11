import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface VarianceRow {
  demand_id: string;
  title: string;
  portfolio_name: string;
  claimed_cost: number | null;
  actual_cost: number | null;
  cost_variance_pct: number | null;
  claimed_benefit: number | null;
  actual_benefit_value: number | null;
  benefit_variance_pct: number | null;
  benefit_attribution_confidence: string | null;
}

function Pct({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--muted)' }}>&mdash;</span>;
  const color = value < 0 ? '#b03a3a' : value > 0 ? '#3f7d52' : 'inherit';
  const sign = value > 0 ? '+' : '';
  return <span style={{ color, fontWeight: 600 }}>{sign}{value}%</span>;
}

function Money({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--muted)' }}>&mdash;</span>;
  return <span>{Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>;
}

export function VarianceReport() {
  const [rows, setRows] = useState<VarianceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<'worst' | 'cost' | 'benefit'>('worst');

  useEffect(() => {
    apiFetch(`/api/reporting/variance?sort=${sort}`)
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load report'));
  }, [sort]);

  return (
    <div>
      <h1 className="page-title">Variance Report</h1>
      <p className="page-subtitle">
        Demands with at least one actual figure recorded, showing how far actual cost and
        benefit (P100) landed from what was originally claimed (P50). A cost overrun and a
        benefit shortfall are shown separately &mdash; they're different failure modes,
        never blended into one score. Sorted worst first.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '1rem 0 1.5rem' }}>
        {(['worst', 'cost', 'benefit'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            className={sort === s ? 'btn btn--primary' : 'btn btn--outline'}
            style={{ fontSize: 11.5, padding: '5px 10px' }}
          >
            {s === 'worst' ? 'Worst miss (either)' : s === 'cost' ? 'Sort by cost variance' : 'Sort by benefit variance'}
          </button>
        ))}
      </div>

      {error && <p className="login-error">{error}</p>}
      {!error && rows === null && <p>Loading...</p>}
      {rows !== null && rows.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          No demands have an actual cost or benefit recorded yet &mdash; nothing to compare against a claim.
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Demand</th>
                <th style={thStyle}>Portfolio</th>
                <th style={thStyle}>Claimed cost</th>
                <th style={thStyle}>Actual cost</th>
                <th style={thStyle}>Cost variance</th>
                <th style={thStyle}>Claimed benefit</th>
                <th style={thStyle}>Actual benefit</th>
                <th style={thStyle}>Benefit variance</th>
                <th style={thStyle}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.demand_id}>
                  <td style={tdStyle}>
                    <Link to={`/demand/${r.demand_id}`}>{r.title}</Link>
                  </td>
                  <td style={tdStyle}>{r.portfolio_name}</td>
                  <td style={tdStyle}><Money value={r.claimed_cost} /></td>
                  <td style={tdStyle}><Money value={r.actual_cost} /></td>
                  <td style={tdStyle}><Pct value={r.cost_variance_pct} /></td>
                  <td style={tdStyle}><Money value={r.claimed_benefit} /></td>
                  <td style={tdStyle}><Money value={r.actual_benefit_value} /></td>
                  <td style={tdStyle}><Pct value={r.benefit_variance_pct} /></td>
                  <td style={tdStyle}>{r.benefit_attribution_confidence ?? <span style={{ color: 'var(--muted)' }}>&mdash;</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
