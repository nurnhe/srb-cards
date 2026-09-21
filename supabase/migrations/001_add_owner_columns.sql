-- 001: every word and tag gets an owner. Nullable at first so the old
-- (single-user) version of the app kept working while the new one was rolled out.
alter table public.words add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.tags  add column if not exists user_id uuid references auth.users(id) on delete cascade;
