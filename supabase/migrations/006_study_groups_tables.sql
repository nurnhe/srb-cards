-- 006: study groups with joint dictionaries — new tables only. Purely
-- additive: nothing here changes what the existing words/tags/word_links/
-- word_tags tables do, so this is safe to run well before the matching
-- backend code is deployed (unlike 007, see that file's note).

-- Groups ----------------------------------------------------------------
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  invite_code text unique not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_id_idx on public.group_members (user_id);

-- Presence of a row here means that word is shared into that group, in
-- addition to always showing in its creator's own personal list
-- (words.user_id is unchanged in meaning — see 007).
create table if not exists public.word_groups (
  word_id  uuid not null references public.words(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  primary key (word_id, group_id)
);
create index if not exists word_groups_group_id_idx on public.word_groups (group_id);

-- Per-user practice progress. Replaces words.correct_count/wrong_count as the
-- source of truth for ALL words, shared or not, so there is only one code
-- path (see increment_word_progress below and 008's data migration).
create table if not exists public.word_progress (
  word_id       uuid not null references public.words(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  correct_count integer not null default 0,
  wrong_count   integer not null default 0,
  primary key (word_id, user_id)
);
create index if not exists word_progress_user_id_idx on public.word_progress (user_id);

-- Helper functions --------------------------------------------------------
-- Both are `security definer` so their own internal queries bypass row-level
-- security entirely (this app's tables have no `force row level security`,
-- so the owning role — which created these functions — already bypasses RLS
-- by default). That is what breaks two different recursion cycles a plain
-- (security invoker) version of either would hit:
--   - is_group_member(group_id) is used both by group_members' OWN "can I
--     see fellow members" policy (a table checking itself, which hits
--     Postgres's "infinite recursion detected in policy" if written as a
--     plain self-referencing subquery) and by groups'/word_groups' policies.
--   - word_is_visible(word_id) is used by words' OWN policies (broadened in
--     007) and by word_groups' policy. Since word_groups' policy needs to
--     check word visibility, and word visibility (once broadened) needs to
--     check word_groups, a plain version of either hits the same class of
--     recursion error, just across two tables instead of one.
-- Both still resolve to the real caller regardless of the security-definer
-- context, because they check auth.uid() — Postgres's session-level JWT
-- claim — inside their own body, not anything passed in from outside.
-- `set search_path` pins name resolution to `public` so a same-named object
-- earlier in some other search_path can't be substituted in — standard
-- hardening for security definer functions, not specific to this feature.
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = auth.uid()
  );
$$;

create or replace function public.word_is_visible(p_word_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.words w
    where w.id = p_word_id
      and (
        w.user_id = auth.uid()
        or exists (
          select 1 from public.word_groups wg
          where wg.word_id = w.id and public.is_group_member(wg.group_id)
        )
      )
  );
$$;

-- Self-service group creation/joining. There is no service_role key in this
-- app (see CLAUDE.md), so there is no elevated client that could look up a
-- group by invite code before its caller is a member — a permissive
-- `using (true)` select on groups would leak every invite code to every
-- signed-in user, defeating the point of a secret code. These two functions
-- are the narrow, deliberate exception: both are security definer so they
-- can do the one lookup/insert a brand-new member or group genuinely needs,
-- while groups/group_members otherwise stay locked down to plain
-- member-only RLS below.
create or replace function public.create_group(p_name text)
returns public.groups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group public.groups;
  v_code  text;
begin
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Group name is required';
  end if;

  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    begin
      insert into public.groups (name, invite_code, created_by)
      values (trim(p_name), v_code, auth.uid())
      returning * into v_group;
      exit;
    exception when unique_violation then
      -- invite_code collided (astronomically unlikely) — try another
    end;
  end loop;

  insert into public.group_members (group_id, user_id) values (v_group.id, auth.uid());

  return v_group;
end;
$$;

create or replace function public.join_group_by_code(p_code text)
returns public.groups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group public.groups;
begin
  select * into v_group from public.groups where invite_code = upper(trim(p_code));
  if v_group.id is null then
    raise exception 'No group found for that code';
  end if;

  insert into public.group_members (group_id, user_id)
  values (v_group.id, auth.uid())
  on conflict do nothing;

  return v_group;
end;
$$;

-- Atomic per-user practice-answer counter — the word_progress equivalent of
-- increment_word_answer (kept as-is for now; see 007's note on why it isn't
-- dropped yet). Unlike create_group/join_group_by_code, this is `security
-- invoker` on purpose: there is no reason for it to bypass RLS, only to
-- create the caller's own zero row on demand.
create or replace function public.increment_word_progress(p_word_id uuid, p_field text)
returns table (correct_count integer, wrong_count integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_field not in ('correct_count', 'wrong_count') then
    raise exception 'invalid field: %', p_field;
  end if;

  -- No progress row for someone who can't (or no longer can) see this word —
  -- resolve to no rows, same "not found" signal increment_word_answer gave
  -- when RLS hid someone else's word id.
  if not public.word_is_visible(p_word_id) then
    return;
  end if;

  insert into public.word_progress (word_id, user_id)
  values (p_word_id, auth.uid())
  on conflict (word_id, user_id) do nothing;

  return query execute format(
    'update public.word_progress set %I = %I + 1 where word_id = $1 and user_id = $2 returning correct_count, wrong_count',
    p_field, p_field
  ) using p_word_id, auth.uid();
end;
$$;

-- Row-level security --------------------------------------------------------
alter table public.groups enable row level security;
drop policy if exists "members see their own groups" on public.groups;
create policy "members see their own groups" on public.groups
  for select using (public.is_group_member(id));
-- Deliberately no insert/update/delete policy: the only way to create a
-- group is create_group() (above), and phase 1 has no rename/delete UI —
-- removing or renaming is a deferred simplification, do by hand in SQL if
-- it's ever needed.

alter table public.group_members enable row level security;
drop policy if exists "members see fellow members of their groups" on public.group_members;
create policy "members see fellow members of their groups" on public.group_members
  for select using (public.is_group_member(group_id));
drop policy if exists "members can leave a group themselves" on public.group_members;
create policy "members can leave a group themselves" on public.group_members
  for delete using (user_id = auth.uid());
-- No insert policy: the only way to join is join_group_by_code() (above), or
-- create_group() creating the creator's own membership. No policy allowing a
-- member to remove ANOTHER member either — deferred, same as above.

alter table public.word_groups enable row level security;
drop policy if exists "share a word with a group either belongs to" on public.word_groups;
create policy "share a word with a group either belongs to" on public.word_groups
  for all
  using (public.is_group_member(group_id) and public.word_is_visible(word_id))
  with check (public.is_group_member(group_id) and public.word_is_visible(word_id));

alter table public.word_progress enable row level security;
drop policy if exists "users see only their own progress" on public.word_progress;
create policy "users see only their own progress" on public.word_progress
  for select using (user_id = auth.uid());
drop policy if exists "users update only their own progress" on public.word_progress;
create policy "users update only their own progress" on public.word_progress
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users start progress only on a word they can see" on public.word_progress;
create policy "users start progress only on a word they can see" on public.word_progress
  for insert with check (user_id = auth.uid() and public.word_is_visible(word_id));
