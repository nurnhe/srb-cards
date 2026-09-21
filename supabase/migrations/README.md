# SQL that has been run against the databases

There is no migration tool. Changes to the database are pasted into
Supabase -> SQL Editor by hand, in **both** projects (real and test). This folder is
the record of that SQL, in order, so the two projects can be compared and a new
one rebuilt. `../schema.sql` is the finished result, for a brand-new project.

Every file is safe to run twice. Whenever the database changes, add the next
numbered file here **and** update `../schema.sql` in the same change.

Anything before 001 (the original tables and the `increment_word_answer`
function) predates this record; it is described in `../schema.sql`.

| File | What it does | Real project | Test project |
| --- | --- | --- | --- |
| 001_add_owner_columns.sql | owner column on words and tags | run | built from schema.sql |
| 002_assign_owner_and_secure.sql | assign owner, per-person tags, security rules | run | built from schema.sql |
| 003_drop_open_policies.sql | remove the old open policies | run | not needed (never had them) |
| 004_require_owner.sql | owner column mandatory | reported done — verify (query below) | built from schema.sql |
| 005_indexes.sql | three indexes | **not run yet** | **not run yet** |

Update the two right-hand columns when a file is run.

## Checks

Owner column mandatory (004) — `is_nullable` should be `NO` for both rows:

```sql
select table_name, is_nullable from information_schema.columns
where table_schema = 'public' and column_name = 'user_id' and table_name in ('words', 'tags');
```

Only the four per-person policies should exist (003):

```sql
select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2;
```

Indexes present (005):

```sql
select indexname from pg_indexes where schemaname = 'public' order by 1;
```
