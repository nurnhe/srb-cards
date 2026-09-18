import { Router } from 'express';
import { supabase } from '../supabase.js';
import { ensureTag } from '../tags.js';
import { route, fail, cleanWordFields, WORD_COLUMNS, isValidId } from '../http.js';

const router = Router();

// Applied to every route below that takes an id in the URL — a malformed
// one (not a real uuid) is a client-side mistake, not a database error.
router.param('id', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'invalid id' })));
router.param('wordId', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'invalid id' })));
router.param('tagId', (req, res, next, id) => (isValidId(id) ? next() : res.status(400).json({ error: 'invalid id' })));

router.post(
  '/',
  route(async (req, res) => {
    const fields = cleanWordFields(req.body || {});
    if (!fields.sr || !fields.ru) {
      return res.status(400).json({ error: 'sr and ru are required' });
    }

    const { data, error } = await supabase.from('words').insert(fields).select(WORD_COLUMNS).single();
    if (error || !data) return fail(res, 'POST /api/words', error);

    res.status(201).json({ ...data, relatedIds: [], tagIds: [] });
  })
);

router.patch(
  '/:id',
  route(async (req, res) => {
    const fields = cleanWordFields(req.body || {});
    if (!fields.sr || !fields.ru) {
      return res.status(400).json({ error: 'sr and ru are required' });
    }

    // Returns the saved row so the browser updates its state from what actually
    // landed in the database rather than re-deriving it. maybeSingle (rather
    // than single) resolves with data: null and no error when the id simply
    // doesn't match any row, instead of Postgrest's ambiguous "no rows"
    // error — letting a stale/deleted id return a clean 404 instead of a
    // generic 500.
    const { data, error } = await supabase
      .from('words')
      .update(fields)
      .eq('id', req.params.id)
      .select(WORD_COLUMNS)
      .maybeSingle();
    if (error) return fail(res, 'PATCH /api/words/:id', error);
    if (!data) return fail(res, 'PATCH /api/words/:id', new Error('Word not found'), 404);

    res.json(data);
  })
);

// Records a practice attempt via an atomic increment (increment_word_answer,
// a Postgres function — see the DB schema notes) rather than a read-then-write
// from here, which could lose an increment between two rapid requests for the
// same word (a double-tap, or a client retry after a flaky response).
router.post(
  '/:id/answer',
  route(async (req, res) => {
    const { correct } = req.body || {};
    if (typeof correct !== 'boolean') {
      return res.status(400).json({ error: 'correct must be a boolean' });
    }
    const field = correct ? 'correct_count' : 'wrong_count';

    const { data, error } = await supabase.rpc('increment_word_answer', {
      p_word_id: req.params.id,
      p_field: field,
    });
    if (error) return fail(res, 'POST /api/words/:id/answer', error);
    // returns table(...) resolves to a row array — empty means the id
    // matched no word, the same "not found" case the old read-then-write
    // caught via its initial select.
    const row = data?.[0];
    if (!row) return fail(res, 'POST /api/words/:id/answer', new Error('Word not found'), 404);

    res.json(row);
  })
);

router.delete(
  '/:id',
  route(async (req, res) => {
    // word_links and word_tags rows go with it via the DB cascade.
    const { error } = await supabase.from('words').delete().eq('id', req.params.id);
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
    const { tag, created, error: tagError } = await ensureTag(req.body.name);
    if (tagError || !tag) return fail(res, 'POST /api/words/:id/tags', tagError);

    // Idempotent for the same reason links are — re-imports must not fail.
    const { error } = await supabase
      .from('word_tags')
      .upsert([{ word_id: req.params.id, tag_id: tag.id }], { onConflict: 'word_id,tag_id' });
    if (error) return fail(res, 'POST /api/words/:id/tags', error);

    res.json({ tag, created });
  })
);

router.delete(
  '/:wordId/tags/:tagId',
  route(async (req, res) => {
    const { error } = await supabase
      .from('word_tags')
      .delete()
      .eq('word_id', req.params.wordId)
      .eq('tag_id', req.params.tagId);
    if (error) return fail(res, 'DELETE /api/words/:wordId/tags/:tagId', error);
    res.status(204).end();
  })
);

export default router;
