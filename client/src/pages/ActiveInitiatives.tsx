import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface Initiative {
  id: string;
  title: string;
  confidential: boolean;
  portfolio_name: string;
  business_case_id: string;
  delivery_stage: 'delivery_started' | 'delivery_completed' | 'adoption_measured' | 'benefit_realized' | null;
}

interface Column { key: string; label: string; stages: (Initiative['delivery_stage'])[]; muted?: boolean; }

// Left to right mirrors the same golden-thread convention All Demand
// already uses -- the four delivery milestones as columns, in the
// order they actually happen in. "Not started" isn't one of the four
// milestones the person asked for, but it's a real state the existing
// data can be in (approved + promoted, delivery not yet begun) --
// dropping those rows silently would just hide them, so they get a
// muted lead-in column rather than disappearing.
const COLUMNS: Column[] = [
  { key: 'not_started', label: 'Not started', stages: [null], muted: true },
  { key: 'in_delivery', label: 'In Delivery', stages: ['delivery_started'] },
  { key: 'delivered', label: 'Delivered', stages: ['delivery_completed'] },
  { key: 'adoption', label: 'Adoption', stages: ['adoption_measured'] },
  { key: 'realisation', label: 'Realisation', stages: ['benefit_realized'] },
];

function columnStyle(col: Column): CSSProperties {
  if (col.muted) {
    return { background: 'var(--cloud)', border: '1.5px dashed var(--hairline)', borderRadius: 'var(--radius)', padding: '10.5px' };
  }
  return { background: 'var(--cloud)', borderRadius: 'var(--radius)', padding: 12 };
}

function InitiativeCard({ i }: { i: Initiative }) {
  return (
    <Link to={`/demand/${i.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        background: '#fff', border: '1px solid var(--hairline)', borderRadius: 10,
        padding: '10px 12px', marginBottom: 8, fontSize: 12.5,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 5 }}>
          {i.title}
          {i.confidential && (
            <span style={{
              marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 9, padding: '2px 5px',
              borderRadius: 4, background: 'rgba(91,95,239,0.12)', color: 'var(--indigo)',
            }}>CONFIDENTIAL</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{i.portfolio_name}</div>
      </div>
    </Link>
  );
}

export function ActiveInitiatives() {
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/demands/active-initiatives')
      .then(setInitiatives)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="page-title">Active initiatives</h1>
      <p className="page-subtitle">Approved demand currently in delivery, laid out by milestone - left to right is how far each one's got.</p>

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && !error && (
        initiatives.length > 0 ? (
          <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 1200 }}>
              {COLUMNS.map((col, idx) => {
                const items = initiatives.filter((i) => col.stages.includes(i.delivery_stage));
                return (
                  <div key={col.key} style={{ display: 'contents' }}>
                    <div style={{ flex: '1 1 0', minWidth: 210, ...columnStyle(col) }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13.5 }}>{col.label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{items.length}</span>
                      </div>
                      {items.map((i) => <InitiativeCard key={i.id} i={i} />)}
                      {items.length === 0 && (
                        <div style={{ color: 'var(--muted)', fontSize: 11.5, textAlign: 'center', padding: '14px 0', fontFamily: 'var(--font-mono)' }}>
                          None
                        </div>
                      )}
                    </div>
                    {idx < COLUMNS.length - 1 && (
                      <div style={{ alignSelf: 'center', color: 'var(--hairline)', fontSize: 22, paddingTop: 40, userSelect: 'none' }}>
                        &#8594;
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Nothing approved and in delivery yet.
          </p>
        )
      )}
    </div>
  );
}