import { useCallback, useEffect, useRef, useState } from 'react';
import { createCrossTabChannel } from '../lib/crossTabChannel';

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
// Cross-tab synced via BroadcastChannel/localStorage (see crossTabChannel.ts):
// activity in any tab resets every tab's clock, and a timeout firing in any
// tab forces all tabs to sign out together. Previously per-tab only, which
// meant an idle background tab could survive on a shared/public machine as
// long as any other tab stayed active - closed as part of hardening this
// for public web access.
export function useIdleTimeout({ timeoutMs, warningMs, onTimeout, enabled }: UseIdleTimeoutOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const lastActivityRef = useRef(Date.now());
  const firedRef = useRef(false);

  // Local reset - updates this tab's own clock and UI, does NOT broadcast.
  // Used internally by the broadcast listener to avoid an echo loop.
  const applyActivity = useCallback((at: number) => {
    lastActivityRef.current = at;
    firedRef.current = false;
    setShowWarning(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const now = Date.now();
    applyActivity(now);

    const channel = createCrossTabChannel((msg) => {
      if (msg.type === 'activity') {
        // Only ever extends the deadline, never shortens it - a stale
        // message arriving out of order can't accidentally shrink the
        // window another tab is legitimately still counting down.
        if (msg.at > lastActivityRef.current) applyActivity(msg.at);
      } else if (msg.type === 'timeout') {
        if (!firedRef.current) {
          firedRef.current = true;
          setShowWarning(false);
          onTimeout();
        }
      }
    });

    // User activity in THIS tab: update locally and tell every other tab.
    const handleLocalActivity = () => {
      const at = Date.now();
      applyActivity(at);
      channel.post({ type: 'activity', at });
    };

    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach((e) => window.addEventListener(e, handleLocalActivity, { passive: true }));

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = timeoutMs - elapsed;

      if (remaining <= 0) {
        if (!firedRef.current) {
          firedRef.current = true;
          setShowWarning(false);
          // Tell every other tab to sign out too, then fire locally.
          channel.post({ type: 'timeout' });
          onTimeout();
        }
      } else if (remaining <= warningMs) {
        setShowWarning(true);
        setSecondsLeft(Math.ceil(remaining / 1000));
      }
    }, 1000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, handleLocalActivity));
      clearInterval(interval);
      channel.close();
    };
  }, [enabled, timeoutMs, warningMs, onTimeout, applyActivity]);

  // Public reset - called from the "Stay signed in" button. Broadcasts,
  // same as genuine activity, since choosing to stay signed in IS activity.
  const resetActivity = useCallback(() => {
    const at = Date.now();
    applyActivity(at);
    // Re-create a throwaway channel just to post; cheap and avoids
    // threading the effect's channel instance out through a ref for what
    // is a rare, user-initiated action.
    createCrossTabChannel(() => {}).post({ type: 'activity', at });
  }, [applyActivity]);

  return { showWarning, secondsLeft, resetActivity };
}