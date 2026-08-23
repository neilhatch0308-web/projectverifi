import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

interface Goal {
  id: string;
  name: string;
  description: string | null;
  goal_year: number;
  declared_at: string;
}

export function StrategicGoals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/strategic-goals')
      .then(setGoals)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const currentYear = goals[0]?.goal_year;
  const openSlots = currentYear ? 5 - goals.filter((g) => g.goal_year === currentYear).length : 0;

  return (
    <div>
      <h1 className="page-title">Strategic Goals</h1>
      <p className="page-subtitle">Top 5 corporate goals, declared annually</p>

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && !error && (
        <>
          {goals.map((g) => (
            <div key={g.id} className="goal-card">
              <div className="goal-card__name">{g.name}</div>
              <div className="goal-card__meta">
                {g.goal_year} - declared {new Date(g.declared_at).toLocaleDateString()}
              </div>
              {g.description && <div className="goal-card__desc">{g.description}</div>}
            </div>
          ))}

          {openSlots > 0 &&
            Array.from({ length: openSlots }).map((_, i) => (
              <div key={`empty-${i}`} className="goal-slot-empty">
                Open slot - {goals.length + i + 1} of 5
              </div>
            ))}
        </>
      )}
    </div>
  );
}
