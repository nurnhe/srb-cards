-- Full database schema for Serbian Cards, for setting up a FRESH Supabase
-- project (for example the separate test database). Paste the whole file into
-- Supabase -> SQL Editor and run it once. Safe to re-run.
--
-- This describes the finished state of the production database, including
-- per-user ownership and row-level security. When production's schema changes,
-- update this file in the same change so the test database can be rebuilt.

-- Words ---------------------------------------------------------------------
create table if not exists public.words (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  sr            text not null,
  ru            text not null,
  example       text,
  correct_count integer not null default 0,
  wrong_count   integer not null default 0,
  created_at    timestamptz not null default now()
);

-- Links between words of the same root (both directions are stored) ---------
create table if not exists public.word_links (
  word_id         uuid not null references public.words(id) on delete cascade,
  related_word_id uuid not null references public.words(id) on delete cascade,
  primary key (word_id, related_word_id)
);

-- Tags, unique per person (not across the whole app) ------------------------
create table if not exists public.tags (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name    text not null
);
create unique index if not exists tags_user_name_unique_idx
  on public.tags (user_id, lower(name));

create table if not exists public.word_tags (
  word_id uuid not null references public.words(id) on delete cascade,
  tag_id  uuid not null references public.tags(id) on delete cascade,
  primary key (word_id, tag_id)
);

-- Atomic practice-answer counter (runs with the caller's rights, so row-level
-- security applies: someone else's word id updates 0 rows) -------------------
create or replace function public.increment_word_answer(p_word_id uuid, p_field text)
returns table (correct_count integer, wrong_count integer)
language plpgsql
as $$
begin
  if p_field not in ('correct_count', 'wrong_count') then
    raise exception 'invalid field: %', p_field;
  end if;
  return query execute format(
    'update public.words set %I = %I + 1 where id = $1 returning correct_count, wrong_count',
    p_field, p_field
  ) using p_word_id;
end;
$$;

-- Row-level security: each person sees and changes only their own data -------
alter table public.words enable row level security;
drop policy if exists "users manage their own words" on public.words;
create policy "users manage their own words" on public.words
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.tags enable row level security;
drop policy if exists "users manage their own tags" on public.tags;
create policy "users manage their own tags" on public.tags
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.word_links enable row level security;
drop policy if exists "users manage links between their own words" on public.word_links;
create policy "users manage links between their own words" on public.word_links
  for all
  using (
    exists (select 1 from public.words w where w.id = word_id and w.user_id = auth.uid())
    and exists (select 1 from public.words w where w.id = related_word_id and w.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.words w where w.id = word_id and w.user_id = auth.uid())
    and exists (select 1 from public.words w where w.id = related_word_id and w.user_id = auth.uid())
  );

alter table public.word_tags enable row level security;
drop policy if exists "users manage tags on their own words" on public.word_tags;
create policy "users manage tags on their own words" on public.word_tags
  for all
  using (
    exists (select 1 from public.words w where w.id = word_id and w.user_id = auth.uid())
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.words w where w.id = word_id and w.user_id = auth.uid())
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
  );
