import { createClient } from '@supabase/supabase-js';

// Used only for auth (sign in/out, session lookup) — the app's own data
// still goes through the Express backend (src/api.js), not straight to
// Supabase from the browser. The URL and anon key are fetched from the
// backend at run time rather than baked in at build time, so building the
// site needs no settings. The anon key is the one Supabase key that's meant
// to be public; row-level security is what keeps one user's data away from
// another's, not secrecy of this key.
const BASE = import.meta.env.VITE_API_URL || '';

let clientPromise;

export function getSupabase() {
  if (!clientPromise) {
    clientPromise = fetch(`${BASE}/api/config`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(({ supabaseUrl, supabaseAnonKey }) => {
        if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase settings missing on the server');
        return createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true },
        });
      })
      .catch((err) => {
        // Let the next call try again instead of caching the failure.
        clientPromise = undefined;
        throw err;
      });
  }
  return clientPromise;
}
