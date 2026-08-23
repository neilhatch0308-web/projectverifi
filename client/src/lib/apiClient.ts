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
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return response.json();
}
