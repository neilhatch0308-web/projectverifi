import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import logoMark from '../assets/project-verifi-logo.svg';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-card">
      <img src={logoMark} alt="Project Verifi" style={{ height: 56, marginBottom: '1.75rem' }} />
      <form onSubmit={handleSubmit}>
        <div className="login-field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="login-field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={submitting} className="btn btn--project">
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
