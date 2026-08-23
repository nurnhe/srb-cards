import { Router } from 'express';
import { supabase } from '../supabase.js';
import { ensureTag } from '../tags.js';
import { route, fail, cleanWordFields, WORD_COLUMNS } from '../http.js';

const router = Router();

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
    // landed in the database rather than re-deriving it.
    const { data, error } = await supabase
      .from('words')
      .update(fields)
      .eq('id', req.params.id)
      .select(WORD_COLUMNS)
      .single();
    if (error || !data) return fail(res, 'PATCH /api/words/:id', error);

    res.json(data);
  })
);

// Records a practice attempt. Reading the current count here rather than
// trusting one sent by the browser keeps the increment off stale client state.
// Still read-modify-write, not an atomic increment — fine for a single user,
// not built for concurrent editors.
router.post(
  '/:id/answer',
  route(async (req, res) => {
    const { correct } = req.body || {};
    if (typeof correct !== 'boolean') {
      return res.status(400).json({ error: 'correct must be a boolean' });
    }
    const field = correct ? 'correct_count' : 'wrong_count';

    const current = await supabase
      .from('words')
      .select('correct_count, wrong_count')
      .eq('id', req.params.id)
      .single();
    if (current.error || !current.data) return fail(res, 'POST /api/words/:id/answer', current.error, 404);

    const { data, error } = await supabase
      .from('words')
      .update({ [field]: (current.data[field] || 0) + 1 })
      .eq('id', req.params.id)
      .select('correct_count, wrong_count')
      .single();
    if (error || !data) return fail(res, 'POST /api/words/:id/answer', error);

    res.json(data);
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
