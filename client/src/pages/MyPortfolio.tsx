import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface Portfolio { id: string; name: string; }

interface StageCounts {
  raised: number;
  accepted: number;
  assessed: number;
  awaiting_decision: number;
  in_delivery: number;
}

interface AgingItem {
  kind: 'aging';
  demand_id: string;
  title: string;
  current_stage: string;
  days_in_current_stage: number;
  portfolio_avg_days: number;
  n_baseline: number;
}

interface BlockedItem {
  kind: 'blocked';
  demand_id: string;
  title: string;
  blocking_demand_id: string;
  blocking_title: string;
}

type NeedsAttentionItem = AgingItem | BlockedItem;

interface ComingUpItem {
  demand_id: string;
  title: string;
  target_start_year: number;
  target_start_quarter: number | null;
}

interface Commitment {
  total_approved: number;
  total_actual: number;
  variance_amount: number;
  n_overrun: number;
}

interface DashboardData {
  portfolio: Portfolio;
  stageCounts: StageCounts;
  needsAttention: NeedsAttentionItem[];
  comingUp: ComingUpItem[];
  commitment: Commitment | null;
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

const TILES: { key: keyof StageCounts; label: string; accent?: boolean }[] = [
  { key: 'raised', label: 'Raised' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'assessed', label: 'Assessed' },
  { key: 'awaiting_decision', label: 'Awaiting decision' },
  { key: 'in_delivery', label: 'In delivery', accent: true },
];

function Money({ value }: { value: number }) {
  return <span>{Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>;
}

function AttentionCard({ item }: { item: NeedsAttentionItem }) {
  if (item.kind === 'aging') {
    return (
      <Link to={`/demand/${item.demand_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
        <div style={{ ...cardStyle, borderLeft: '3px solid #b03a3a' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.title}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Stuck in {STAGE_LABEL[item.current_stage] ?? item.current_stage} &middot;{' '}
            {Number(item.days_in_current_stage).toFixed(0)} days vs {Number(item.portfolio_avg_days).toFixed(0)} avg
            <span style={{ marginLeft: 4 }}>(n={item.n_baseline})</span>
          </div>
        </div>
      </Link>
    );
  }
  return (
    <Link to={`/demand/${item.demand_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ ...cardStyle, borderLeft: '3px solid #c58a1a' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.title}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          Blocked on <Link to={`/demand/${item.blocking_demand_id}`} onClick={(e) => e.stopPropagation()}>{item.blocking_title}</Link>
        </div>
      </div>
    </Link>
  );
}

function ComingUpCard({ item }: { item: ComingUpItem }) {
  return (
    <Link to={`/demand/${item.demand_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.title}</div>
        <span className="pill" style={{ fontSize: 10.5, padding: '2px 8px', background: 'var(--cloud)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {item.target_start_quarter ? `Q${item.target_start_quarter} ` : ''}{item.target_start_year}
        </span>
      </div>
    </Link>
  );
}

export function MyPortfolio() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [portfolioId, setPortfolioId] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiFetch('/api/portfolios'), apiFetch('/api/me')])
      .then(([p, me]: [Portfolio[], { defaultPortfolioId: string | null }]) => {
        setPortfolios(p);
        setPortfolioId(me.defaultPortfolioId ?? p[0]?.id ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load portfolios'));
  }, []);

  useEffect(() => {
    if (!portfolioId) return;
    apiFetch(`/api/reporting/my-portfolio?portfolioId=${portfolioId}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'));
  }, [portfolioId]);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">{data?.portfolio.name ?? 'My Portfolio'}</h1>
          <p className="page-subtitle">Your portfolio's pipeline, at a glance.</p>
        </div>
        {portfolios.length > 1 && (
          <select
            value={portfolioId ?? ''}
            onChange={(e) => setPortfolioId(e.target.value)}
            style={{ fontSize: 12.5, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--hairline)' }}
          >
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="login-error">{error}</p>}
      {!error && data === null && <p>Loading...</p>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, margin: '1.25rem 0 1.75rem' }}>
            {TILES.map((t) => (
              <div key={t.key} style={{ background: 'var(--cloud)', borderRadius: 10, padding: '12px 10px' }}>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)', color: t.accent ? 'var(--teal)' : 'var(--graphite)' }}>
                  {data.stageCounts[t.key]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>Needs attention</span>
                {data.needsAttention.length > 0 && <span style={{ color: '#b03a3a', fontWeight: 700 }}>{data.needsAttention.length}</span>}
              </div>
              {data.needsAttention.length === 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Nothing stuck or blocked right now.</p>
              )}
              {data.needsAttention.map((item) => (
                <AttentionCard key={`${item.kind}-${item.demand_id}`} item={item} />
              ))}
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>Coming up</span>
                {data.comingUp.length > 0 && <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{data.comingUp.length}</span>}
              </div>
              {data.comingUp.length === 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>Nothing horizon-tagged yet.</p>
              )}
              {data.comingUp.map((item) => (
                <ComingUpCard key={item.demand_id} item={item} />
              ))}
            </div>
          </div>

          {data.commitment && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--hairline)', fontSize: 11, color: 'var(--muted)' }}>
              Committed spend this year:{' '}
              <strong style={{ color: 'var(--graphite)' }}><Money value={data.commitment.total_approved} /> approved</strong>
              {' '}&middot;{' '}
              <strong style={{ color: data.commitment.variance_amount < 0 ? '#b03a3a' : '#3f7d52' }}>
                <Money value={Math.abs(data.commitment.variance_amount)} /> {data.commitment.variance_amount < 0 ? 'over approved' : 'unspent'}
              </strong>
              {' '}&middot;{' '}
              <Link to="/commitment-report" style={{ color: 'var(--indigo)' }}>view commitment report</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--hairline)', borderRadius: 8, padding: '9px 11px', marginBottom: 7,
};
