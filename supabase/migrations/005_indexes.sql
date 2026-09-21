-- 005: indexes for the lookups the security rules and deletes rely on.
-- (tags needs none: its unique index on (user_id, lower(name)) already starts
-- with user_id. word_links and word_tags are already covered by their primary
-- keys for lookups by word_id.)
create index if not exists words_user_id_idx           on public.words (user_id);
create index if not exists word_tags_tag_id_idx        on public.word_tags (tag_id);
create index if not exists word_links_related_word_idx on public.word_links (related_word_id);
