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

async function request(path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

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
