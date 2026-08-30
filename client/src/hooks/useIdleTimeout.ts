import { useCallback, useEffect, useRef, useState } from 'react';

interface UseIdleTimeoutOptions {
  timeoutMs: number;
  warningMs: number;   // how long before timeout the warning shows
  onTimeout: () => void;
  enabled: boolean;
}

// Tracks genuine activity (mouse, keyboard, touch, scroll) against a
// wall-clock timestamp, not a resettable setTimeout - a setTimeout
// approach breaks if the tab is backgrounded and the browser throttles
// timers, letting a genuinely idle session survive far longer than
// intended. Checking elapsed real time every second is more reliable.
//
// Per-tab only, deliberately - activity in one tab doesn't reset the
// timer in another. Cross-tab sync (BroadcastChannel/localStorage)
// would close that gap but adds real complexity; flagging as a known
// scope boundary rather than silently leaving it unmentioned.
export function useIdleTimeout({ timeoutMs, warningMs, onTimeout, enabled }: UseIdleTimeoutOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const firedRef = useRef(false);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    firedRef.current = false;
    setShowWarning(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    resetActivity();

    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => window.addEventListener(e, resetActivity, { passive: true }));

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = timeoutMs - elapsed;

      if (remaining <= 0) {
        if (!firedRef.current) {
          firedRef.current = true;
          setShowWarning(false);
          onTimeout();
        }
      } else if (remaining <= warningMs) {
        setShowWarning(true);
        setSecondsLeft(Math.ceil(remaining / 1000));
      }
    }, 1000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetActivity));
      clearInterval(interval);
    };
  }, [enabled, timeoutMs, warningMs, onTimeout, resetActivity]);

  return { showWarning, secondsLeft, resetActivity };
}
