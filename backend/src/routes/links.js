import { Router } from 'express';
import { supabase } from '../supabase.js';
import { route, fail, isValidId } from '../http.js';

const router = Router();

// word_links is a symmetric relation: both directions are always written and
// removed together.
router.post(
  '/',
  route(async (req, res) => {
    const { idA, idB } = req.body || {};
    if (!idA || !idB) return res.status(400).json({ error: 'idA and idB are required' });
    if (idA === idB) return res.status(400).json({ error: 'A word cannot link to itself' });

    // Idempotent on purpose — re-importing a backup re-links pairs that already
    // exist, and that has to be a no-op rather than an error.
    const { error } = await supabase.from('word_links').upsert(
      [
        { word_id: idA, related_word_id: idB },
        { word_id: idB, related_word_id: idA },
      ],
      { onConflict: 'word_id,related_word_id' }
    );
    if (error) return fail(res, 'POST /api/links', error);
    res.status(204).end();
  })
);

router.delete(
  '/',
  route(async (req, res) => {
    const { a: idA, b: idB } = req.query;
    // Express parses a repeated query key (?a=1&a=2) into an array — isValidId
    // rejects that (and any other non-uuid value) the same as a missing one,
    // rather than silently passing an array into the query below.
    if (!isValidId(idA) || !isValidId(idB)) {
      return res.status(400).json({ error: 'a and b query params are required' });
    }

    // Both directions in one statement, matching how POST / writes them —
    // two independent delete calls (the previous approach) could partially
    // fail, leaving a one-way "link" that nothing would ever self-heal.
    const { error } = await supabase
      .from('word_links')
      .delete()
      .or(`and(word_id.eq.${idA},related_word_id.eq.${idB}),and(word_id.eq.${idB},related_word_id.eq.${idA})`);
    if (error) return fail(res, 'DELETE /api/links', error);
    res.status(204).end();
  })
);

export default router;
