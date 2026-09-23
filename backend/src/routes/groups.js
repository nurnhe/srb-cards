import { Router } from 'express';
import { route, fail, isValidId } from '../http.js';

const router = Router();
router.param('id', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'invalid id' })));

// Full detail for the dedicated Groups screen — GET /api/vocabulary already
// carries the minimal {id, name} list used everywhere else (the scope
// selectors on Words/Practice don't need invite codes or membership).
router.get(
  '/',
  route(async (req, res) => {
    const { data: rawGroups, error } = await req.supabase
      .from('groups')
      .select('id, name, invite_code, created_by, created_at')
      .order('created_at', { ascending: true });
    if (error) return fail(res, 'GET /api/groups', error);

    // Same reasoning as the member-shaping below (and attachOwnership in
    // shape.js): a fellow member's raw account id never needs to reach the
    // browser. There's no "only the creator can rename/delete" UI yet, but
    // if there ever is, `mine` is what it would gate on anyway.
    const groups = (rawGroups || []).map(({ created_by, ...rest }) => ({
      ...rest,
      mine: created_by === req.userId,
    }));

    const groupIds = groups.map((g) => g.id);
    let members = [];
    if (groupIds.length > 0) {
      const { data, error: membersError } = await req.supabase
        .from('group_members')
        .select('group_id, user_id, joined_at')
        .in('group_id', groupIds);
      if (membersError) return fail(res, 'GET /api/groups', membersError);
      // Same reasoning as attachOwnership in shape.js: a groupmate's raw
      // user id never needs to reach the browser, only whether a given row
      // is the caller's own membership.
      members = (data || []).map(({ user_id, ...rest }) => ({ ...rest, mine: user_id === req.userId }));
    }
    res.json({ groups: groups || [], members });
  })
);

// create_group is a Postgres function (security definer — see the DB schema
// notes) rather than a plain insert: it also generates the invite code and
// adds the caller as the first member, atomically.
router.post(
  '/',
  route(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { data, error } = await req.supabase.rpc('create_group', { p_name: name });
    if (error) return fail(res, 'POST /api/groups', error);
    res.status(201).json(data);
  })
);

// join_group_by_code is also security definer — it's the one place a caller
// can resolve an invite code to a group before they're a member, without
// exposing every group's code to every signed-in user (see the DB schema
// notes on why there's no service_role key to do this another way).
router.post(
  '/join',
  route(async (req, res) => {
    const code = String(req.body?.code ?? '').trim();
    if (!code) return res.status(400).json({ error: 'code is required' });
    const { data, error } = await req.supabase.rpc('join_group_by_code', { p_code: code });
    // A raised Postgres exception (join_group_by_code's "no such code")
    // surfaces as code P0001 — that's a bad-input case, not a server problem.
    if (error) return fail(res, 'POST /api/groups/join', error, error.code === 'P0001' ? 400 : 500);
    res.json(data);
  })
);

router.delete(
  '/:id/membership',
  route(async (req, res) => {
    const { error } = await req.supabase
      .from('group_members')
      .delete()
      .eq('group_id', req.params.id)
      .eq('user_id', req.userId);
    if (error) return fail(res, 'DELETE /api/groups/:id/membership', error);
    res.status(204).end();
  })
);

export default router;
