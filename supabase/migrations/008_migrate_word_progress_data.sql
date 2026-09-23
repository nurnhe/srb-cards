-- 008: backfill word_progress from words' existing counters, for every word
-- that actually has practice history — a fresh row per word/owner pair, so
-- existing progress carries over instead of starting back at 0/0. Safe to
-- re-run — on conflict do nothing skips rows already migrated.
insert into public.word_progress (word_id, user_id, correct_count, wrong_count)
select id, user_id, correct_count, wrong_count
from public.words
where correct_count > 0 or wrong_count > 0
on conflict (word_id, user_id) do nothing;
