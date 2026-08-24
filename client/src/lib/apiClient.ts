import { auth } from './firebase';

export async function apiFetch(path: string, options: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  const token = await user.getIdToken();

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(formatApiError(body.error, response.status));
  }

  return response.json();
}

// Zod's .flatten() returns { fieldErrors: {...}, formErrors: [...] } - an
// object, not a string. new Error(objectValue) silently stringifies it to
// the useless literal "[object Object]". This extracts the real messages
// instead, so validation failures are actually readable in the UI.
function formatApiError(error: unknown, status: number): string {
  if (typeof error === 'string') return error;

  if (error && typeof error === 'object') {
    const flat = error as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };

    const fieldMessages = flat.fieldErrors
      ? Object.entries(flat.fieldErrors)
          .filter(([, msgs]) => msgs && msgs.length > 0)
          .map(([field, msgs]) => `${field}: ${msgs!.join(', ')}`)
      : [];

    const formMessages = flat.formErrors ?? [];
    const combined = [...fieldMessages, ...formMessages];

    if (combined.length > 0) return combined.join(' | ');
  }

  return `Request failed: ${status}`;
}