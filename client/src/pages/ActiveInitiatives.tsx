import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { promotedDemandLabel } from '../lib/promotedDemandLabel';

interface Initiative {
  id: string;
  title: string;
  confidential: boolean;
  portfolio_name: string;
  business_case_id: string;
  delivery_stage: 'delivery_started' | 'delivery_completed' | 'adoption_measured' | 'benefit_realized' | null;
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
      <p className="page-subtitle">Approved demand currently in delivery, and how far each one's got.</p>

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && !error && (
        initiatives.length > 0 ? (
          initiatives.map((i) => (
            <Link key={i.id} to={`/demand/${i.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="goal-card" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {i.title}
                    {i.confidential && (
                      <span
                        title="Confidential"
                        style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#c22', marginLeft: 7, verticalAlign: 'middle' }}
                      />
                    )}
                  </div>
                  <div className="goal-card__meta" style={{ marginTop: 2 }}>{i.portfolio_name}</div>
                </div>
                <span className="pill pill--indigo" style={{ fontSize: 10.5, padding: '3px 8px', textTransform: 'capitalize' }}>
                  {promotedDemandLabel({ business_case_decision: 'approved', delivery_stage: i.delivery_stage })}
                </span>
              </div>
            </Link>
          ))
        ) : (
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Nothing approved and in delivery yet.
          </p>
        )
      )}
    </div>
  );
}
