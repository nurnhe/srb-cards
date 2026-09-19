import { createClient } from '@supabase/supabase-js';

// Used only for auth (sign in/out, session lookup) — the app's own data
// still goes through the Express backend (src/api.js), not straight to
// Supabase from the browser. The anon key is the one Supabase key that's
// meant to be public client-side; row-level security is what actually
// keeps one user's data away from another's, not secrecy of this key.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
