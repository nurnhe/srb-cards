// Client for the app's own backend. Every database call goes through here —
// the browser no longer talks to Supabase, so no database key ships in the
// bundle.
//
// Each function resolves to { data, error }, deliberately mirroring what
// supabase-js used to return, so call sites in App.jsx keep their familiar
// shape.

// Empty in dev: Vite proxies /api to the backend (see vite.config.js). Set
// VITE_API_URL once the backend is deployed somewhere.
const BASE = import.meta.env.VITE_API_URL || '';

const PASSWORD_STORAGE_KEY = 'srbCardsAppPassword';

export const getStoredPassword = () => localStorage.getItem(PASSWORD_STORAGE_KEY);
export const logout = () => localStorage.removeItem(PASSWORD_STORAGE_KEY);

// Verifies a typed password against the backend before storing it, so the
// caller gets a clear yes/no rather than inferring success from some other
// endpoint's side effect.
export async function login(password) {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.ok) {
    localStorage.setItem(PASSWORD_STORAGE_KEY, password);
    return true;
  }
  return false;
}

async function request(path, { method = 'GET', body } = {}) {
  try {
    const password = getStoredPassword();
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(password ? { 'X-App-Password': password } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401) {
      // The stored password is missing/stale (e.g. changed on the server) —
      // drop it and reload so the app falls back to the login screen instead
      // of sitting on a dead session showing the generic save-failed banner
      // forever.
      logout();
      window.location.reload();
      return { data: null, error: new Error('Unauthorized') };
    }
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      return { data: null, error: new Error(payload?.error || `HTTP ${res.status}`) };
    }
    if (res.status === 204) return { data: null, error: null };
    return { data: await res.json(), error: null };
  } catch (err) {
    // fetch throws when the network or the server is unreachable, whereas
    // supabase-js resolved with an error field. Catching here means every call
    // site can keep checking `error` and nothing throws at them unexpectedly.
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// Words + links + tags in one request, already stitched together:
// { words: [{ ..., relatedIds, tagIds }], tags: [{ id, name }] }
export const getVocabulary = () => request('/vocabulary');

export const createWord = (sr, ru, example) =>
  request('/words', { method: 'POST', body: { sr, ru, example } });

export const updateWord = (id, sr, ru, example) =>
  request(`/words/${id}`, { method: 'PATCH', body: { sr, ru, example } });

// Resolves to the word's new { correct_count, wrong_count }.
export const recordAnswer = (id, correct) =>
  request(`/words/${id}/answer`, { method: 'POST', body: { correct } });

export const deleteWord = (id) => request(`/words/${id}`, { method: 'DELETE' });

export const linkWords = (idA, idB) => request('/links', { method: 'POST', body: { idA, idB } });

export const unlinkWords = (idA, idB) =>
  request(`/links?a=${encodeURIComponent(idA)}&b=${encodeURIComponent(idB)}`, { method: 'DELETE' });

// Creates the tag if needed; resolves to { tag: { id, name }, created }.
export const tagWord = (wordId, name) =>
  request(`/words/${wordId}/tags`, { method: 'POST', body: { name } });

export const untagWord = (wordId, tagId) =>
  request(`/words/${wordId}/tags/${tagId}`, { method: 'DELETE' });
