-- 009: drop the two now-dead columns on words — word_progress (006/008) has
-- been the source of truth since the matching backend shipped. RUN THIS ONLY
-- AFTER confirming that backend is deployed and working (same reasoning as
-- 004 deferring the owner column's NOT NULL) — dropping these while old code
-- is still reading/writing them would break it instantly.
alter table public.words drop column if exists correct_count;
alter table public.words drop column if exists wrong_count;

-- increment_word_answer is dead from here too (nothing calls it once the new
-- backend is live, and it updates columns that no longer exist) — drop it in
-- the same deferred step, for the same reason.
drop function if exists public.increment_word_answer(uuid, text);
