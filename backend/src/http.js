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

// Shared input handling: sr/ru are lowercased on save so "Blag"/"blag" collapse
// to one entry; example is a full sentence and is left alone.
export function cleanWordFields({ sr, ru, example }) {
  return {
    sr: cleanField(sr).toLowerCase(),
    ru: cleanField(ru).toLowerCase(),
    example: cleanField(example) || null,
  };
}

export const WORD_COLUMNS = 'id, sr, ru, example, correct_count, wrong_count';

// Validates a route param that's expected to be a Postgres uuid before it
// ever reaches a query — an malformed id (a truncated URL, a stale link)
// would otherwise surface as Postgres's raw "invalid input syntax for type
// uuid" error, reported as a confusing generic 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}
