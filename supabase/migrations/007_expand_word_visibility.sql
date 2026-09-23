-- 007: broadens who can see/edit a word from "its owner" to "its owner OR
-- anyone in a group it's shared to" (word_is_visible, from 006). Run this
-- right before deploying the matching backend code, not long before —
-- unlike other migrations here, this one changes behavior for the CURRENT
-- (old) backend too: increment_word_answer (still present) updates
-- words.correct_count/wrong_count under whatever the words UPDATE policy
-- allows, and this file makes that policy broader. If the old backend is
-- still live for a while after this runs, a practice answer on a
-- since-shared word could touch the old shared counter instead of being
-- blocked — the opposite of what per-user progress (word_progress) is for.
-- Minimize the gap between running this and deploying.

alter table public.words enable row level security;
drop policy if exists "users manage their own words" on public.words;

-- Split from one `for all` into per-command policies: creating a word is
-- still owner-only, but seeing/editing/deleting one now follows
-- word_is_visible — any member of a group a word is shared to can edit or
-- delete it too (not just its creator), matching this feature's
-- collaborative-by-design intent.
drop policy if exists "words are created by their owner" on public.words;
create policy "words are created by their owner" on public.words
  for insert with check (user_id = auth.uid());

drop policy if exists "words are visible to whoever can see them" on public.words;
create policy "words are visible to whoever can see them" on public.words
  for select using (public.word_is_visible(id));

drop policy if exists "words are editable by whoever can see them" on public.words;
create policy "words are editable by whoever can see them" on public.words
  for update using (public.word_is_visible(id)) with check (public.word_is_visible(id));

drop policy if exists "words are deletable by whoever can see them" on public.words;
create policy "words are deletable by whoever can see them" on public.words
  for delete using (public.word_is_visible(id));

-- word_links: a word-family relationship is part of a word's content, same
-- as the word itself — broadened the same way as words' own select/update.
-- (Judgment call, not one of the confirmed decisions — revisit if wrong.)
alter table public.word_links enable row level security;
drop policy if exists "users manage links between their own words" on public.word_links;
drop policy if exists "users manage links between visible words" on public.word_links;
create policy "users manage links between visible words" on public.word_links
  for all
  using (public.word_is_visible(word_id) and public.word_is_visible(related_word_id))
  with check (public.word_is_visible(word_id) and public.word_is_visible(related_word_id));

-- word_tags: only the WORD side is broadened. The TAG side stays
-- `t.user_id = auth.uid()` — tags remain a strictly personal namespace, even
-- on a shared word. Known phase-1 limitation, not a bug: each member can tag
-- a shared word with their own tags, but won't see a groupmate's tags on it.
alter table public.word_tags enable row level security;
drop policy if exists "users manage tags on their own words" on public.word_tags;
drop policy if exists "users manage their own tags on visible words" on public.word_tags;
create policy "users manage their own tags on visible words" on public.word_tags
  for all
  using (
    public.word_is_visible(word_id)
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
  )
  with check (
    public.word_is_visible(word_id)
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
  );
