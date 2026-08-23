import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/apiClient';

interface Goal {
  id: string;
  name: string;
  description: string | null;
  goal_year: number;
  status: 'active' | 'suspended' | 'completed';
  declared_at: string;
  status_changed_at: string | null;
}

const STATUS_PILL: Record<string, string> = {
  active: 'pill--teal',
  suspended: 'pill--indigo',
  completed: 'pill--muted',
};

const NEXT_ACTIONS: Record<string, { label: string; target: string }[]> = {
  active: [
    { label: 'Suspend', target: 'suspended' },
    { label: 'Mark complete', target: 'completed' },
  ],
  suspended: [
    { label: 'Reactivate', target: 'active' },
    { label: 'Mark complete', target: 'completed' },
  ],
  completed: [],
};

export function StrategicGoals() {
  const currentCalendarYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentCalendarYear);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  function loadGoals(year: number) {
    setLoading(true);
    apiFetch(`/api/strategic-goals?year=${year}`)
      .then(setGoals)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    apiFetch('/api/strategic-goals/years')
      .then((years: number[]) => {
        const combined = Array.from(new Set([...years, currentCalendarYear])).sort((a, b) => b - a);
        setAvailableYears(combined);
      })
      .catch(() => setAvailableYears([currentCalendarYear]));
  }, []);

  useEffect(() => loadGoals(selectedYear), [selectedYear]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAdding(true);
    try {
      await apiFetch('/api/strategic-goals', {
        method: 'POST',
        body: JSON.stringify({ name: newName, description: newDescription || undefined, goalYear: selectedYear }),
      });
      setNewName('');
      setNewDescription('');
      setShowAddForm(false);
      loadGoals(selectedYear);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add goal');
    } finally {
      setAdding(false);
    }
  }

  async function changeStatus(id: string, status: string) {
    try {
      await apiFetch(`/api/strategic-goals/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      loadGoals(selectedYear);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update goal status');
    }
  }

  const activeCount = goals.filter((g) => g.status !== 'completed' || true).length; // all declared count toward cap
  const openSlots = 5 - goals.length;

  return (
    <div style={{ maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Strategic Goals</h1>
          <p className="page-subtitle">Top 5 corporate goals, declared annually - locked once declared, status can still change</p>
        </div>
        {openSlots > 0 && (
          <button onClick={() => setShowAddForm((s) => !s)} className="btn btn--project">
            + Add goal
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Year</label>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          style={{ padding: '6px 10px', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 13 }}
        >
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{goals.length} of 5 slots declared</span>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="goal-card" style={{ marginBottom: '1.25rem' }}>
          <div className="login-field">
            <label>Goal name</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Grow Latin America market" required />
          </div>
          <div className="login-field" style={{ marginBottom: 0 }}>
            <label>Description (optional)</label>
            <input type="text" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          </div>
          {addError && <p className="login-error" style={{ marginTop: 10 }}>{addError}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={adding} className="btn btn--project">
              {adding ? 'Adding...' : `Declare for ${selectedYear}`}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="btn btn--outline">Cancel</button>
          </div>
        </form>
      )}

      {loading && <p>Loading...</p>}
      {error && <p className="login-error">{error}</p>}

      {!loading && !error && (
        <>
          {goals.map((g) => (
            <div key={g.id} className="goal-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div className="goal-card__name">{g.name}</div>
                <span className={`pill ${STATUS_PILL[g.status]}`} style={{ textTransform: 'capitalize' }}>{g.status}</span>
              </div>
              <div className="goal-card__meta">
                Declared {new Date(g.declared_at).toLocaleDateString()}
                {g.status_changed_at && ` \u00b7 status changed ${new Date(g.status_changed_at).toLocaleDateString()}`}
              </div>
              {g.description && <div className="goal-card__desc" style={{ marginTop: 6 }}>{g.description}</div>}

              {NEXT_ACTIONS[g.status].length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {NEXT_ACTIONS[g.status].map((action) => (
                    <button
                      key={action.target}
                      onClick={() => changeStatus(g.id, action.target)}
                      className="btn btn--outline"
                      style={{ fontSize: 12, padding: '5px 10px' }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
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
