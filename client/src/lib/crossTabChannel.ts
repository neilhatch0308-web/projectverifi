// Minimal cross-tab messaging for idle-session sync. BroadcastChannel is
// supported in every browser we target (Chrome/Edge/Firefox/Safari 15.4+);
// the localStorage fallback covers anything older or with it disabled.
// Not a general-purpose pub/sub - scoped deliberately to this one job.

type CrossTabMessage =
  | { type: 'activity'; at: number }
  | { type: 'timeout' };

const CHANNEL_NAME = 'verifi-idle-session';
const STORAGE_KEY = '__verifi_idle_session_msg__';

type Listener = (msg: CrossTabMessage) => void;

export function createCrossTabChannel(onMessage: Listener): { post: (msg: CrossTabMessage) => void; close: () => void } {
  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel(CHANNEL_NAME);
    bc.onmessage = (e: MessageEvent<CrossTabMessage>) => onMessage(e.data);
    return {
      post: (msg) => bc.postMessage(msg),
      close: () => bc.close(),
    };
  }

  // Fallback: storage events only fire in *other* tabs, never the tab that
  // set the value, which is exactly the semantics we want here.
  const handler = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      onMessage(JSON.parse(e.newValue) as CrossTabMessage);
    } catch {
      // Ignore malformed payloads rather than throwing in a storage handler.
    }
  };
  window.addEventListener('storage', handler);

  return {
    post: (msg) => {
      // Value must change each write or same-value writes won't fire the
      // storage event in other tabs; the timestamp handles that.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...msg, _ts: Date.now() }));
    },
    close: () => window.removeEventListener('storage', handler),
  };
}