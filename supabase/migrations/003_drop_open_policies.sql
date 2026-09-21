-- 003: remove the original "anyone can do anything" policies. Postgres allows a
-- row if ANY policy allows it, so leaving these in place made every person see
-- everyone's words (found in the first two-account test).
drop policy if exists "public access" on public.words;
drop policy if exists "public access" on public.tags;
drop policy if exists "public access" on public.word_links;
drop policy if exists "public access" on public.word_tags;
