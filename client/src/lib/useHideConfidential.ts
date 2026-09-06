import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pv_hide_confidential';

/**
 * Shared "hide confidential demand from view" state, used identically
 * across My Home, All Demand, Annual Planning, and Five-Year Horizon.
 *
 * This is a display filter, not an access control -- every item it
 * can hide is something the user is already authorized to see. It
 * exists for screen-sharing: toggle it on before presenting, and it
 * holds across every page you navigate to without needing to
 * re-toggle on each one.
 *
 * Backed by localStorage rather than a React Context because only one
 * of the four pages is ever mounted at a time (plain client-side
 * routing unmounts the others), so real-time in-page sync isn't
 * needed -- just persistence across navigation and refresh. The
 * `storage` event listener additionally catches the case where the
 * person has two tabs open at once and toggles it in one.
 */
export function useHideConfidential() {
  const [hideConfidential, setHideConfidentialState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setHideConfidentialState(e.newValue === 'true');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function setHideConfidential(value: boolean) {
    setHideConfidentialState(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // localStorage unavailable (private browsing, etc) -- toggle still
      // works for the current page, just won't persist across navigation.
    }
  }

  return { hideConfidential, setHideConfidential };
}
