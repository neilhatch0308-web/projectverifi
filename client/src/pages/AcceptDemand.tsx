import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';

interface User {
  id: string;
  display_name: string;
  email: string;
  role: string;
}

const SEATS = [
  { key: 'accountableFinancialId', label: 'Accountable - Financial', desc: 'Holds re-basing authority for budget/financial-benefit changes' },
  { key: 'accountableScopeId', label: 'Accountable - Scope', desc: 'Holds re-basing authority for scope/outcome changes' },
  { key: 'accountableScheduleId', label: 'Accountable - Schedule', desc: 'Holds re-basing authority for timescale changes' },
  { key: 'sponsorId', label: 'Sponsor', desc: 'Executive owner of this initiative' },
  { key: 'benefitOwnerId', label: 'Benefit Owner', desc: 'Accountable for realising the claimed value' },
] as const;

export function AcceptDemand() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [seatValues, setSeatValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/api/users')
      .then(setUsers)
      .catch((err) => setError(err.message));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (SEATS.some((s) => !seatValues[s.key])) {
      setError('All five seats must be named before this demand can be accepted');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/api/demands/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify(seatValues),
      });
      navigate(`/demand/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept demand');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <Link to={`/demand/${id}`} style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>
        &larr; Back to demand
      </Link>

      <h1 className="page-title" style={{ marginTop: 12 }}>Accept Demand</h1>
      <p className="page-subtitle">
        Naming all five seats locks the success criteria as the preserved original.
        Changes after this point require an approved re-base, not a direct edit.
      </p>

      <form onSubmit={handleSubmit}>
        {SEATS.map((seat) => (
          <div key={seat.key} className="login-field">
            <label>{seat.label}</label>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 6px' }}>{seat.desc}</p>
            <select
              value={seatValues[seat.key] ?? ''}
              onChange={(e) => setSeatValues((v) => ({ ...v, [seat.key]: e.target.value }))}
              required
              style={{ width: '100%', padding: 10, border: '1px solid var(--hairline)', borderRadius: 9, fontSize: 14 }}
            >
              <option value="">Select person</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name}</option>
              ))}
            </select>
          </div>
        ))}

        {error && <p className="login-error">{error}</p>}

        <button type="submit" disabled={submitting} className="btn btn--project">
          {submitting ? 'Accepting...' : 'Accept and lock criteria'}
        </button>
      </form>
    </div>
  );
}
