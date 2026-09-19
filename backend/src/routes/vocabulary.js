import { Router } from 'express';
import { attachLinksAndTags } from '../shape.js';
import { route, fail, WORD_COLUMNS } from '../http.js';

const router = Router();

// Everything the app needs on startup, in one request. The browser used to make
// these four queries itself and stitch the results together. req.supabase is
// scoped to the caller's own JWT (see requireAuth), so RLS already limits
// every one of these to that user's own rows — no manual filtering needed.
router.get(
  '/',
  route(async (req, res) => {
    const [wordsRes, linksRes, tagsRes, wordTagsRes] = await Promise.all([
      req.supabase.from('words').select(WORD_COLUMNS).order('created_at', { ascending: true }),
      req.supabase.from('word_links').select('word_id, related_word_id'),
      req.supabase.from('tags').select('id, name').order('name', { ascending: true }),
      req.supabase.from('word_tags').select('word_id, tag_id'),
    ]);

    const failed = [wordsRes, linksRes, tagsRes, wordTagsRes].find((r) => r.error);
    if (failed) return fail(res, 'GET /api/vocabulary', failed.error);

    res.json({
      words: attachLinksAndTags(wordsRes.data, linksRes.data, wordTagsRes.data),
      tags: tagsRes.data || [],
    });
  })
);

export default router;
