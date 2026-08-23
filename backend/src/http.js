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

// Shared input handling: sr/ru are lowercased on save so "Blag"/"blag" collapse
// to one entry; example is a full sentence and is left alone.
export function cleanWordFields({ sr, ru, example }) {
  return {
    sr: String(sr ?? '').trim().toLowerCase(),
    ru: String(ru ?? '').trim().toLowerCase(),
    example: String(example ?? '').trim() || null,
  };
}

export const WORD_COLUMNS = 'id, sr, ru, example, correct_count, wrong_count';
