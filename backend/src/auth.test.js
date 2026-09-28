import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearAuthCache } from './authCache.js';

const getUser = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser } }),
}));

// requireAuth reads these at import time.
process.env.SUPABASE_URL = 'https://example.test';
process.env.SUPABASE_ANON_KEY = 'anon-key';

const { requireAuth } = await import('./auth.js');

function fakeReqRes(token) {
  const req = { get: () => (token ? `Bearer ${token}` : undefined) };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  return { req, res };
}

describe('requireAuth caching', () => {
  beforeEach(() => {
    clearAuthCache();
    getUser.mockReset();
  });

  it('checks Supabase on the first request for a token', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
    const { req, res } = fakeReqRes('tok-1');
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe('user-a');
    expect(next).toHaveBeenCalled();
  });

  it('skips the Supabase check on a second request with the same token', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
    const next1 = vi.fn();
    await requireAuth(fakeReqRes('tok-1').req, fakeReqRes('tok-1').res, next1);
    expect(getUser).toHaveBeenCalledTimes(1);

    const { req, res } = fakeReqRes('tok-1');
    const next2 = vi.fn();
    await requireAuth(req, res, next2);

    expect(getUser).toHaveBeenCalledTimes(1); // still 1 — the cache answered this one
    expect(req.userId).toBe('user-a');
    expect(next2).toHaveBeenCalled();
  });

  it('checks Supabase again for a different token even after another one was cached', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'user-a' } }, error: null });
    await requireAuth(fakeReqRes('tok-1').req, fakeReqRes('tok-1').res, vi.fn());
    expect(getUser).toHaveBeenCalledTimes(1);

    getUser.mockResolvedValueOnce({ data: { user: { id: 'user-b' } }, error: null });
    const { req, res } = fakeReqRes('tok-2');
    await requireAuth(req, res, vi.fn());

    expect(getUser).toHaveBeenCalledTimes(2);
    expect(req.userId).toBe('user-b');
  });

  it('never caches a failed check, so the next request is checked fresh', async () => {
    getUser.mockResolvedValueOnce({ data: null, error: { message: 'bad token', status: 401 } });
    const { req: req1, res: res1 } = fakeReqRes('tok-1');
    await requireAuth(req1, res1, vi.fn());
    expect(res1.status).toHaveBeenCalledWith(401);

    getUser.mockResolvedValueOnce({ data: { user: { id: 'user-a' } }, error: null });
    const { req: req2, res: res2 } = fakeReqRes('tok-1');
    const next2 = vi.fn();
    await requireAuth(req2, res2, next2);

    expect(getUser).toHaveBeenCalledTimes(2);
    expect(next2).toHaveBeenCalled();
  });

  it('rejects a request with no token without calling Supabase at all', async () => {
    const { req, res } = fakeReqRes(null);
    await requireAuth(req, res, vi.fn());
    expect(getUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
