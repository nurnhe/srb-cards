import { Router } from 'express';
import { ensureTag } from '../tags.js';
import { route, fail, cleanWordFields, isValidId } from '../http.js';

const router = Router();

// Applied to every route below that takes an id in the URL — a malformed
// one (not a real uuid) is a client-side mistake, not a database error.
router.param('id', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'invalid id' })));
router.param('wordId', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'invalid id' })));
router.param('tagId', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'invalid id' })));
router.param('groupId', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'invalid id' })));

// Neither of the next two routes asks Postgres for the row back via
// .select() (RETURNING) — see the long comment on POST below for why that's
// deliberate, not an oversight.
router.post(
  '/',
  route(async (req, res) => {
    const fields = cleanWordFields(req.body || {});
    if (!fields.sr || !fields.ru) {
      return res.status(400).json({ error: 'sr and ru are required' });
    }

    // Generated here instead of left to the column's default(gen_random_uuid())
    // and read back via .select().single() (INSERT ... RETURNING) — that
    // combination hits a genuine Postgres RLS gotcha once a table's SELECT
    // policy is anything more than a plain column comparison: words' SELECT
    // policy is `word_is_visible(id)`, and that function does its own nested
    // `select ... from words` to check group-sharing. A row inserted earlier
    // in the SAME command isn't visible yet to a nested query inside that
    // command's own RLS check — regardless of the function being `security
    // definer` (that only affects privileges, not this per-command
    // visibility rule) — so RETURNING fails with "new row violates
    // row-level security policy" even though the row is perfectly valid and
    // owned by the caller. A *separate* follow-up statement sees it fine
    // (proven while debugging this live), which is exactly why generating
    // the id ourselves and skipping RETURNING sidesteps the whole problem —
    // we already know every field we'd otherwise be reading back.
    const id = crypto.randomUUID();
    const { error } = await req.supabase.from('words').insert({ id, ...fields, user_id: req.userId });
    if (error) return fail(res, 'POST /api/words', error);

    // A word you just created is trivially yours — no query needed to know
    // that. user_id itself is never sent to the client (see attachOwnership
    // in shape.js) — nothing else in this app exposes one user's id to
    // another, and there's no reason to start with this one.
    res.status(201).json({ id, ...fields, relatedIds: [], tagIds: [], groupIds: [], correct_count: 0, wrong_count: 0, mine: true });
  })
);

router.patch(
  '/:id',
  route(async (req, res) => {
    const fields = cleanWordFields(req.body || {});
    if (!fields.sr || !fields.ru) {
      return res.status(400).json({ error: 'sr and ru are required' });
    }

    // { count: 'exact' } asks PostgREST for how many rows matched, via a
    // separate `Prefer: count=exact` header — NOT the same as .select(),
    // so it doesn't trigger the RETURNING+RLS issue described on POST above.
    // A stale/deleted id (or someone else's word, which RLS makes invisible
    // to this query) matches zero rows rather than erroring, which is what
    // used to come from maybeSingle() resolving to data: null — same "not
    // found" signal, just from a count instead of a missing row.
    const { error, count } = await req.supabase
      .from('words')
      .update(fields, { count: 'exact' })
      .eq('id', req.params.id);
    if (error) return fail(res, 'PATCH /api/words/:id', error);
    if (!count) return fail(res, 'PATCH /api/words/:id', new Error('Word not found'), 404);

    // Ownership doesn't change on edit; we already know every field we just
    // wrote, so there's nothing RETURNING would have told us anyway.
    res.json({ id: req.params.id, ...fields });
  })
);

// Records a practice attempt via an atomic increment (increment_word_progress,
// a Postgres function — see the DB schema notes) rather than a read-then-write
// from here, which could lose an increment between two rapid requests for the
// same word (a double-tap, or a client retry after a flaky response). Progress
// is per-caller (word_progress), not per-word, so two people sharing a word
// each keep their own counts.
router.post(
  '/:id/answer',
  route(async (req, res) => {
    const { correct } = req.body || {};
    if (typeof correct !== 'boolean') {
      return res.status(400).json({ error: 'correct must be a boolean' });
    }
    const field = correct ? 'correct_count' : 'wrong_count';

    const { data, error } = await req.supabase.rpc('increment_word_progress', {
      p_word_id: req.params.id,
      p_field: field,
    });
    if (error) return fail(res, 'POST /api/words/:id/answer', error);
    // returns table(...) resolves to a row array — empty means the id
    // matched no word (or one RLS hides from this user), the same "not
    // found" case the old read-then-write caught via its initial select.
    const row = data?.[0];
    if (!row) return fail(res, 'POST /api/words/:id/answer', new Error('Word not found'), 404);

    res.json(row);
  })
);

router.delete(
  '/:id',
  route(async (req, res) => {
    // word_links and word_tags rows go with it via the DB cascade.
    const { error } = await req.supabase.from('words').delete().eq('id', req.params.id);
    if (error) return fail(res, 'DELETE /api/words/:id', error);
    res.status(204).end();
  })
);

// Tags a word by name, creating the tag if it does not exist yet. Returns the
// tag so the browser can update both its tag list and the word's tagIds.
router.post(
  '/:id/tags',
  route(async (req, res) => {
    if (!String(req.body?.name ?? '').trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const { tag, created, error: tagError } = await ensureTag(req.supabase, req.userId, req.body.name);
    if (tagError || !tag) return fail(res, 'POST /api/words/:id/tags', tagError);

    // Idempotent for the same reason links are — re-imports must not fail.
    const { error } = await req.supabase
      .from('word_tags')
      .upsert([{ word_id: req.params.id, tag_id: tag.id }], { onConflict: 'word_id,tag_id' });
    if (error) return fail(res, 'POST /api/words/:id/tags', error);

    res.json({ tag, created });
  })
);

router.delete(
  '/:wordId/tags/:tagId',
  route(async (req, res) => {
    const { error } = await req.supabase
      .from('word_tags')
      .delete()
      .eq('word_id', req.params.wordId)
      .eq('tag_id', req.params.tagId);
    if (error) return fail(res, 'DELETE /api/words/:wordId/tags/:tagId', error);
    res.status(204).end();
  })
);

// Shares a word into a group (or re-shares — upsert). RLS on word_groups
// (caller must belong to the group AND be able to see the word already) does
// the real authorization; this just performs the write.
router.post(
  '/:id/groups',
  route(async (req, res) => {
    if (!isValidId(req.body?.groupId)) {
      return res.status(400).json({ error: 'groupId is required' });
    }
    const { error } = await req.supabase
      .from('word_groups')
      .upsert([{ word_id: req.params.id, group_id: req.body.groupId }], { onConflict: 'word_id,group_id' });
    if (error) return fail(res, 'POST /api/words/:id/groups', error);
    res.json({ groupId: req.body.groupId });
  })
);

router.delete(
  '/:wordId/groups/:groupId',
  route(async (req, res) => {
    const { error } = await req.supabase
      .from('word_groups')
      .delete()
      .eq('word_id', req.params.wordId)
      .eq('group_id', req.params.groupId);
    if (error) return fail(res, 'DELETE /api/words/:wordId/groups/:groupId', error);
    res.status(204).end();
  })
);

export default router;
