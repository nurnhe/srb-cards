import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Отсутствуют переменные окружения VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Проверь файл .env (локально) или настройки Environment variables в Netlify (на сайте).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
