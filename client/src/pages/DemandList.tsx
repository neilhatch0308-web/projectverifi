import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/apiClient';

interface Demand {
  id: string;
  title: string;
  status: string;
  raised_date: string;
}

export function DemandList() {
  const { user, logout } = useAuth();
  const [demands, setDemands] = useState<Demand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/demands')
      .then(setDemands)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>All Demand</h1>
        <div>
          <span style={{ marginRight: 12 }}>{user?.email}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </div>

      {loading && <p>Loading...</p>}
      {error && (
        <p style={{ color: 'red' }}>
          {error}
          {error.includes('No account found') && (
            <><br />Your Firebase login worked, but no app_user row has this firebase_uid linked yet.</>
          )}
        </p>
      )}

      {!loading && !error && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
              <th style={{ padding: 8 }}>Title</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Raised</th>
            </tr>
          </thead>
          <tbody>
            {demands.map((d) => (
              <tr key={d.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{d.title}</td>
                <td style={{ padding: 8 }}>{d.status}</td>
                <td style={{ padding: 8 }}>{new Date(d.raised_date).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
