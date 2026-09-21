import { createClient } from '@supabase/supabase-js';
import { authFailureStatus } from './http.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Verifies the caller's Supabase session and, on success, attaches a
// Supabase client scoped to *that user's* own JWT rather than the shared
// service_role client — this is what makes row-level security apply as
// them instead of bypassing it. Every route handler uses req.supabase
// for its queries; none of them need to filter by user_id manually,
// since RLS policies on each table already restrict what a given user's
// client can see or touch (see CLAUDE.md's schema notes).
export async function requireAuth(req, res, next) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[auth] SUPABASE_URL / SUPABASE_ANON_KEY not set — refusing all API requests');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  // getUser() must be given the token explicitly — called with no argument
  // it reads the client's own internal session state instead, which this
  // fresh per-request client never has (every request would 401).
  const { data, error } = await userClient.auth.getUser(token);
  if (error) {
    const status = authFailureStatus(error);
    if (status === 503) {
      console.error('[auth] could not check the login:', error.message);
      return res.status(503).json({ error: 'Login service unavailable, try again' });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!data?.user) return res.status(401).json({ error: 'Unauthorized' });

  req.supabase = userClient;
  req.userId = data.user.id;
  next();
}
