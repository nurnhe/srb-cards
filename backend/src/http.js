import { cyrillicToLatin, isCyrillic } from './serbianScript.js';

// Express 4 does not catch errors thrown inside async handlers, so every route
// is wrapped to forward rejections to the error middleware.
export function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// supabase-js reports failures in the response body instead of throwing. Every
// route funnels them through here, because the frontend only shows one generic
// "не могу да сачувам" banner — the server log is the only real diagnostic.
export function fail(res, where, error, status = 500) {
  console.error(`[${where}]`, error?.message || error);
  return res.status(status).json({ error: error?.message || 'Database error' });
}

// A non-string value (an object/array from a malformed request) used to get
// coerced by String() into something like "[object Object]" and saved as a
// real vocabulary entry with no error. Treating it as blank instead routes
// it through the existing "sr and ru are required" validation each caller
// already has, rather than adding a second error path.
function cleanField(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// sr/ru are single words/short phrases, safe to force fully lowercase so
// e.g. "Blag"/"blag" collapse to one entry. An example is a full sentence —
// doing the same to it would also lowercase any proper noun inside it, so
// it only gets its first letter capitalized ("sentence case"), leaving the
// rest exactly as typed.
function capitalizeFirst(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// sr is always saved as Latin, whichever script it was typed in — Cyrillic to
// Latin is the clean, lossless direction (each Cyrillic letter maps to one
// Latin spelling; the reverse is ambiguous at digraph boundaries like dž/nj),
// which is why Latin, not Cyrillic, is the one that gets stored. The other
// script is still derived for display on the fly (otherScript in logic.js),
// same as before — this only changes what's written to the database.
function toLatinIfCyrillic(value) {
  return isCyrillic(value) ? cyrillicToLatin(value) : value;
}

// Shared input handling: sr/ru are lowercased on save so "Blag"/"blag" collapse
// to one entry; example gets sentence case (see capitalizeFirst above). Existing
// rows saved before this rule existed keep whatever case they already have
// until next edited — this only normalizes what's written from here on.
export function cleanWordFields({ sr, ru, example }) {
  return {
    sr: toLatinIfCyrillic(cleanField(sr).toLowerCase()),
    ru: cleanField(ru).toLowerCase(),
    example: capitalizeFirst(cleanField(example)) || null,
  };
}

// user_id is selected for server-side use only (attachOwnership in shape.js
// turns it into a `mine` boolean before a word ever reaches the client — see
// that file's comment for why). correct_count/wrong_count no longer live on
// this table; they come from word_progress (see attachGroupsAndProgress).
export const WORD_COLUMNS = 'id, sr, ru, example, user_id';

// Validates a route param that's expected to be a Postgres uuid before it
// ever reaches a query — an malformed id (a truncated URL, a stale link)
// would otherwise surface as Postgres's raw "invalid input syntax for type
// uuid" error, reported as a confusing generic 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

// Decides what a failed "who is this token?" check means. Only a problem with
// the token itself (missing, malformed, expired, revoked — Supabase answers
// with a 4xx) should make the caller sign the user out. Rate limiting (429),
// a 5xx or a network failure says nothing about the login, so those are
// reported as "try again" (503) instead of "you are logged out" (401) —
// otherwise a one-second hiccup at Supabase would end the user's session and
// throw away whatever they were saving.
export function authFailureStatus(error) {
  if (!error) return 401;
  if (error.name === 'AuthSessionMissingError') return 401;
  const status = error.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) return 401;
  return 503;
}

// Supabase returns at most 1000 rows per request (its default cap), silently
// cutting the rest off — a big enough vocabulary would just lose links and
// tags from the app with no error. This asks for one page at a time until
// everything has arrived. `buildPage(from, to)` must return a query for that
// row range (`.range(from, to)`), ordered so pages never overlap, and should
// ask for `{ count: 'exact' }` so the total is known; without a count it
// stops at the first page shorter than `pageSize`. Resolves like supabase-js:
// { data, error }.
export async function fetchAllRows(buildPage, pageSize = 1000) {
  const rows = [];
  let total = null;
  for (;;) {
    const { data, error, count } = await buildPage(rows.length, rows.length + pageSize - 1);
    if (error) return { data: null, error };
    if (total === null && typeof count === 'number') total = count;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (total !== null ? rows.length >= total : data.length < pageSize) break;
  }
  return { data: rows, error: null };
}
