import { useCallback, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { useIdleTimeout } from '../hooks/useIdleTimeout';

// 30 minutes idle, warn for the last 60 seconds. Reasonable default for
// a tool holding confidential demand and financial data; not currently
// tenant-configurable - a fixed constant here, not a per-org setting.
// If different portfolios/teams need different thresholds later, that
// would be a natural follow-up (a governance-tier-style admin screen),
// not something to guess at now.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_MS = 60 * 1000;

export function IdleSessionGuard({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  const handleTimeout = useCallback(() => {
    logout();
  }, [logout]);

  const { showWarning, secondsLeft, resetActivity } = useIdleTimeout({
    timeoutMs: IDLE_TIMEOUT_MS,
    warningMs: WARNING_MS,
    onTimeout: handleTimeout,
    enabled: !!user,
  });

  return (
    <>
      {children}
      {showWarning && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(20,22,28,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff', borderRadius: 'var(--radius)', padding: '1.75rem',
              maxWidth: 360, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              Still there?
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 18 }}>
              You've been idle a while. For security, you'll be signed out in {secondsLeft}s.
            </p>
            <button onClick={resetActivity} className="btn btn--project" style={{ width: '100%', justifyContent: 'center' }}>
              Stay signed in
            </button>
          </div>
        </div>
      )}
    </>
  );
}
