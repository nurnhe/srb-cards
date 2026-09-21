-- 004: once only the new version of the app is running (it always sets the
-- owner), make the owner column mandatory. Run 002 again first if any word or
-- tag was added by the old version in the meantime.
alter table public.words alter column user_id set not null;
alter table public.tags  alter column user_id set not null;
