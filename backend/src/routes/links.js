import { Router } from 'express';
import { supabase } from '../supabase.js';
import { route, fail } from '../http.js';

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
    if (!idA || !idB) return res.status(400).json({ error: 'a and b query params are required' });

    const [first, second] = await Promise.all([
      supabase.from('word_links').delete().eq('word_id', idA).eq('related_word_id', idB),
      supabase.from('word_links').delete().eq('word_id', idB).eq('related_word_id', idA),
    ]);
    const failed = [first, second].find((r) => r.error);
    if (failed) return fail(res, 'DELETE /api/links', failed.error);
    res.status(204).end();
  })
);

export default router;
