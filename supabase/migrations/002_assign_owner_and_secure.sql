-- 002: give the existing words and tags to their owner, make tag names unique
-- per person, and turn on row-level security so each person only sees their own.
-- Replace <OWNER-USER-ID> with the user id from Supabase -> Authentication -> Users.

update public.words set user_id = '<OWNER-USER-ID>' where user_id is null;
update public.tags  set user_id = '<OWNER-USER-ID>' where user_id is null;

drop index if exists public.tags_name_unique_idx;
create unique index if not exists tags_user_name_unique_idx on public.tags (user_id, lower(name));

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
