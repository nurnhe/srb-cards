import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client. Uses the service_role key, which bypasses RLS
// entirely — it must never be sent to the browser.
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    'Missing environment variables SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. ' +
      'Check your .env file — see .env.example.'
  );
  process.exit(1);
}

export const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
