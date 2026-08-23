import { Router } from 'express';
import { supabase } from '../supabase.js';
import { attachLinksAndTags } from '../shape.js';
import { route, fail, WORD_COLUMNS } from '../http.js';

const router = Router();

// Everything the app needs on startup, in one request. The browser used to make
// these four queries itself and stitch the results together.
router.get(
  '/',
  route(async (req, res) => {
    const [wordsRes, linksRes, tagsRes, wordTagsRes] = await Promise.all([
      supabase.from('words').select(WORD_COLUMNS).order('created_at', { ascending: true }),
      supabase.from('word_links').select('word_id, related_word_id'),
      supabase.from('tags').select('id, name').order('name', { ascending: true }),
      supabase.from('word_tags').select('word_id, tag_id'),
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
