// A tiny in-memory cache of "this token belongs to this user id", so a burst
// of requests carrying the same token (an import, the part-of-speech pass —
// one request per word) doesn't ask Supabase Auth "who is this?" over the
// network every single time. Measured cost of that one check: ~70-160ms,
// occasionally much more — pure overhead before any real work starts.
//
// Trade-off, accepted on purpose: a token that's just been revoked (signed
// out elsewhere, deleted account) can still be accepted here for up to
// CACHE_TTL_MS. That's no looser than what already happens one layer down —
// every actual data query still goes through PostgREST, which validates the
// same JWT's signature and expiry itself and enforces row-level security
// from its own claims, independent of this cache. This cache only skips a
// redundant *extra* round trip to the Auth service, not any real check.
//
// Deliberately just a Map with lazy expiry (checked on read/write), no
// periodic sweep — a personal app has a handful of users and tokens, so an
// unbounded-looking Map never actually grows large, and letting a stale
// entry sit until it's next looked up costs nothing.
const CACHE_TTL_MS = 60_000;

const cache = new Map(); // token -> { userId, expiresAt }

export function getCachedUserId(token) {
  const entry = cache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(token);
    return null;
  }
  return entry.userId;
}

export function setCachedUserId(token, userId) {
  cache.set(token, { userId, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Test-only: drop everything, so one test's tokens can't leak into another's.
export function clearAuthCache() {
  cache.clear();
}
