import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import logoMark from '../assets/project-verifi-logo.svg';

type ViewState = 'signin' | 'forgot-request' | 'forgot-confirm';

export function Login() {
  const { login } = useAuth();

  // --- Sign-in state ---
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // --- Forgot-password state ---
  const [view, setView] = useState<ViewState>('signin');
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [attemptsExhausted, setAttemptsExhausted] = useState(false);

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

  function goToForgotPassword() {
    setResetEmail(email);
    setResetError(null);
    setResetSuccess(null);
    setView('forgot-request');
  }

  function backToSignIn() {
    setView('signin');
    setError(null);
  }

  // Step 1: request a reset code by email. The backend deliberately never
  // reveals whether the account exists — always proceed to the code-entry
  // step on a 200, whatever the response says.
  async function handleSendResetCode(e: FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetSubmitting(true);

    const trimmedEmail = resetEmail.trim();
    if (!trimmedEmail) {
      setResetError('Please enter your email.');
      setResetSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const data = await res.json();

      if (!res.ok) {
        setResetError(data.detail || 'Something went wrong. Please try again.');
        setResetSubmitting(false);
        return;
      }

      setResetToken(data.resetToken || null);
      setResetCode('');
      setNewPassword('');
      setConfirmPassword('');
      setAttemptsExhausted(false);
      setView('forgot-confirm');
    } catch {
      setResetError('Network error. Please try again.');
    } finally {
      setResetSubmitting(false);
    }
  }

  async function handleResendCode() {
    setResetSubmitting(true);
    try {
      const res = await fetch('/api/auth/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });
      const data = await res.json();
      if (res.ok) {
        setResetToken(data.resetToken || null);
        setResetError(null);
        setAttemptsExhausted(false);
      } else {
        setResetError('Failed to resend code.');
      }
    } catch {
      setResetError('Network error.');
    } finally {
      setResetSubmitting(false);
    }
  }

  // Step 2: submit the code + new password.
  async function handleConfirmReset(e: FormEvent) {
    e.preventDefault();
    setResetError(null);
    setResetSubmitting(true);

    const code = resetCode.trim();
    if (!code || code.length !== 6) {
      setResetError('Enter the 6-digit code.');
      setResetSubmitting(false);
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setResetError('Password must be at least 8 characters.');
      setResetSubmitting(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError("Passwords don't match.");
      setResetSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/password-reset-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, code, newPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error === 'too_many_attempts') {
          setResetError(data.detail || 'Too many incorrect attempts. Request a new code.');
          setAttemptsExhausted(true);
        } else {
          setResetError(data.detail || 'That code is invalid or has expired.');
        }
        setResetSubmitting(false);
        return;
      }

      setResetSuccess('Password reset. You can now sign in with your new password.');
      setTimeout(() => {
        setEmail(resetEmail);
        setPassword('');
        setView('signin');
        setResetSuccess(null);
      }, 1800);
    } catch {
      setResetError('Network error. Please try again.');
      setResetSubmitting(false);
    }
  }

  if (view === 'forgot-request') {
    return (
      <div className="login-card">
        <img src={logoMark} alt="Project Verifi" style={{ height: 56, marginBottom: '1.75rem' }} />
        <h1 style={{ fontSize: '1.3rem', marginBottom: 8 }}>Reset your password</h1>
        <p className="login-sub">We'll email a 6-digit code to confirm it's you</p>
        <form onSubmit={handleSendResetCode}>
          <div className="login-field">
            <label>Email</label>
            <input
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          {resetError && <p className="login-error">{resetError}</p>}
          <button type="submit" disabled={resetSubmitting} className="btn btn--project">
            {resetSubmitting ? 'Sending...' : 'Send reset code'}
          </button>
        </form>
        <button type="button" className="login-link" onClick={backToSignIn}>
          Back to sign in
        </button>
      </div>
    );
  }

  if (view === 'forgot-confirm') {
    return (
      <div className="login-card">
        <img src={logoMark} alt="Project Verifi" style={{ height: 56, marginBottom: '1.75rem' }} />
        <h1 style={{ fontSize: '1.3rem', marginBottom: 8 }}>Enter your code</h1>
        <p className="login-sub">
          Check <strong>{resetEmail}</strong> for a 6-digit code, valid for 10 minutes
        </p>
        <form onSubmit={handleConfirmReset}>
          <div className="login-field">
            <label>Verification code</label>
            <input
              type="text"
              value={resetCode}
              onChange={(e) => setResetCode(e.target.value)}
              placeholder="000000"
              maxLength={6}
              inputMode="numeric"
              required
            />
          </div>
          <div className="login-field">
            <label>New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="login-field">
            <label>Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          {resetError && <p className="login-error">{resetError}</p>}
          {resetSuccess && <p className="login-success">{resetSuccess}</p>}
          {!attemptsExhausted && (
            <>
              <button type="submit" disabled={resetSubmitting} className="btn btn--project">
                {resetSubmitting ? 'Resetting...' : 'Reset password'}
              </button>
              <button
                type="button"
                disabled={resetSubmitting}
                className="btn btn--secondary"
                style={{ marginTop: 8 }}
                onClick={handleResendCode}
              >
                Resend code
              </button>
            </>
          )}
        </form>
        <button type="button" className="login-link" onClick={backToSignIn}>
          Back to sign in
        </button>
      </div>
    );
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
      <button type="button" className="login-link" onClick={goToForgotPassword}>
        Forgot your password?
      </button>
    </div>
  );
}