import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface AgingRow {
  demand_id: string;
  title: string;
  portfolio_name: string;
  current_stage: string;
  days_in_current_stage: number | null;
  portfolio_avg_days: number | null;
  n_baseline: number;
  days_over_average: number | null;
  flagged: boolean;
}

const STAGE_LABEL: Record<string, string> = {
  raise: 'Raise \u2192 Triage',
  triage: 'Triage \u2192 Assess',
  assess: 'Assess \u2192 Promote',
  promote: 'Promote \u2192 Decision',
  decision: 'Decision \u2192 Delivery start',
  delivery: 'In delivery',
  adoption_wait: 'Awaiting adoption measure',
  benefit_wait: 'Awaiting benefit realisation',
};

export function AgingReport() {
  const [rows, setRows] = useState<AgingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState(true);

  useEffect(() => {
    apiFetch('/api/reporting/aging')
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load report'));
  }, []);

  const visible = rows === null ? null : flaggedOnly ? rows.filter((r) => r.flagged) : rows;

  return (
    <div>
      <h1 className="page-title">Aging Report</h1>
      <p className="page-subtitle">
        Every demand currently in an active stage, compared against that portfolio's own
        historical average for the same transition. Flagged rows are sitting longer than
        that average, with at least 3 past demands behind the average being compared
        against &mdash; a portfolio's very first demand through a stage has no real
        average to be over yet.
      </p>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, margin: '1rem 0 1.5rem' }}>
        <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
        Show only flagged (over average)
      </label>

      {error && <p className="login-error">{error}</p>}
      {!error && rows === null && <p>Loading...</p>}
      {visible !== null && visible.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          {flaggedOnly ? 'Nothing is currently running over its portfolio average.' : 'No active demands found.'}
        </p>
      )}

      {visible !== null && visible.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Demand</th>
                <th style={thStyle}>Portfolio</th>
                <th style={thStyle}>Current stage</th>
                <th style={thStyle}>Days in stage</th>
                <th style={thStyle}>Portfolio average</th>
                <th style={thStyle}>Over average by</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.demand_id} style={r.flagged ? { background: 'rgba(176,58,58,0.05)' } : undefined}>
                  <td style={tdStyle}>
                    <Link to={`/demand/${r.demand_id}`}>{r.title}</Link>
                  </td>
                  <td style={tdStyle}>{r.portfolio_name}</td>
                  <td style={tdStyle}>{STAGE_LABEL[r.current_stage] ?? r.current_stage}</td>
                  <td style={tdStyle}>
                    {r.days_in_current_stage !== null ? Number(r.days_in_current_stage).toFixed(1) : '\u2014'}
                  </td>
                  <td style={tdStyle}>
                    {r.portfolio_avg_days !== null ? (
                      <>
                        {Number(r.portfolio_avg_days).toFixed(1)}
                        <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 4 }}>(n={r.n_baseline})</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>no baseline yet</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {r.flagged && r.days_over_average !== null ? (
                      <span style={{ color: '#b03a3a', fontWeight: 600 }}>+{Number(r.days_over_average).toFixed(1)} days</span>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>&mdash;</span>
                    )}
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

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--hairline)',
  fontWeight: 600, whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--muted)',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px', borderBottom: '1px solid var(--hairline)', whiteSpace: 'nowrap',
};
