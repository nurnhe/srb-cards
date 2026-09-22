// Client for the app's own backend. Every database call goes through here —
// the browser talks to Supabase directly only for auth (see
// supabaseClient.js), never for data, so no data-access key ships in the
// bundle.
//
// Each function resolves to { data, error }, deliberately mirroring what
// supabase-js used to return, so call sites in App.jsx keep their familiar
// shape.

import { getSupabase } from './supabaseClient';

// Empty in dev: Vite proxies /api to the backend (see vite.config.js). Set
// VITE_API_URL once the backend is deployed somewhere.
const BASE = import.meta.env.VITE_API_URL || '';

async function request(path, { method = 'GET', body } = {}) {
  try {
    // Fetched fresh on every call, not cached, so Supabase's own automatic
    // token refresh (the access token is short-lived) is always picked up.
    const supabase = await getSupabase();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401) {
      // The session is missing/stale (e.g. revoked) — sign out so the app
      // falls back to the login screen instead of sitting on a dead session
      // showing the generic save-failed banner forever.
      await supabase.auth.signOut();
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

// Words + links + tags + study groups in one request, already stitched
// together: { words: [{ ..., relatedIds, tagIds, groupIds, mine }], tags: [{ id, name }], groups: [{ id, name }] }
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

// Study groups with joint dictionaries. getGroups() carries richer detail
// (invite code, membership) than the minimal {id, name} list already in
// getVocabulary()'s response — it's what the dedicated Groups screen uses.
export const getGroups = () => request('/groups');

export const createGroup = (name) => request('/groups', { method: 'POST', body: { name } });

export const joinGroup = (code) => request('/groups/join', { method: 'POST', body: { code } });

export const leaveGroup = (groupId) => request(`/groups/${groupId}/membership`, { method: 'DELETE' });

export const shareWordToGroup = (wordId, groupId) =>
  request(`/words/${wordId}/groups`, { method: 'POST', body: { groupId } });

export const unshareWordFromGroup = (wordId, groupId) =>
  request(`/words/${wordId}/groups/${groupId}`, { method: 'DELETE' });
