import { Router } from 'express';
import { attachLinksAndTags } from '../shape.js';
import { route, fail, WORD_COLUMNS, fetchAllRows } from '../http.js';

const router = Router();

// Everything the app needs on startup, in one request. The browser used to make
// these four queries itself and stitch the results together. req.supabase is
// scoped to the caller's own JWT (see requireAuth), so RLS already limits
// every one of these to that user's own rows — no manual filtering needed.
router.get(
  '/',
  route(async (req, res) => {
    // Each list is fetched a page at a time (see fetchAllRows) — Supabase
    // cuts a single request off at 1000 rows, and links (two rows each) and
    // tag assignments add up faster than words do. Every query has a full
    // ordering so pages never overlap or skip rows.
    const exact = { count: 'exact' };
    const [wordsRes, linksRes, tagsRes, wordTagsRes] = await Promise.all([
      fetchAllRows((from, to) =>
        req.supabase
          .from('words')
          .select(WORD_COLUMNS, exact)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        req.supabase
          .from('word_links')
          .select('word_id, related_word_id', exact)
          .order('word_id', { ascending: true })
          .order('related_word_id', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        req.supabase
          .from('tags')
          .select('id, name', exact)
          .order('name', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        req.supabase
          .from('word_tags')
          .select('word_id, tag_id', exact)
          .order('word_id', { ascending: true })
          .order('tag_id', { ascending: true })
          .range(from, to)
      ),
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
