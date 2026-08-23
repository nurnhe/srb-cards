import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client. Uses the service_role key, which bypasses RLS
// entirely — it must never be sent to the browser, and this backend must not be
// exposed publicly until it has some form of auth in front of it.
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    'Отсутствуют переменные окружения SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. ' +
      'Проверь файл .env — смотри .env.example.\n' +
      'Missing environment variables SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. ' +
      'Check your .env file — see .env.example.'
  );
  process.exit(1);
}

export const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
