import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Session-only persistence: closing the browser (not just the active
// tab, since other open tabs to this origin keep the session alive
// until ALL of them are closed) clears the sign-in, matching the
// expectation that reopening the browser later should require signing
// in again rather than silently staying authenticated indefinitely.
// Firebase's own default (browserLocalPersistence) survives a full
// browser restart, which doesn't fit an app handling confidential
// demand and audit-facing governance data.
setPersistence(auth, browserSessionPersistence).catch((err) => {
  console.error('Failed to set session-only auth persistence:', err);
});