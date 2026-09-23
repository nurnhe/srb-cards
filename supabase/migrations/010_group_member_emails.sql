-- 010: lets a group member see who else is in the group. group_members only
-- has a raw auth.users id per row, and auth.users itself isn't reachable
-- through ordinary RLS-scoped queries (Postgrest doesn't expose the auth
-- schema, and this app has no service_role key to read it another way) — so,
-- same pattern as create_group/join_group_by_code, a narrow security definer
-- function is the deliberate exception. It returns only `email` (the one
-- identifier this app's accounts actually have — there's no display-name
-- field), and only for group ids the caller is themselves a member of; a
-- group id the caller doesn't belong to yields no rows for it, the same
-- "invisible" behavior RLS gives everywhere else in this app.
create or replace function public.group_member_emails(p_group_ids uuid[])
returns table (group_id uuid, user_id uuid, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select gm.group_id, gm.user_id, u.email
  from public.group_members gm
  join auth.users u on u.id = gm.user_id
  where gm.group_id = any(p_group_ids)
    and exists (
      select 1 from public.group_members caller
      where caller.group_id = gm.group_id and caller.user_id = auth.uid()
    );
$$;
