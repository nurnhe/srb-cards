import { Router } from 'express';
import { attachLinksAndTags, attachOwnership, attachGroupsAndProgress } from '../shape.js';
import { route, fail, WORD_COLUMNS, fetchAllRows } from '../http.js';

const router = Router();

// Everything the app needs on startup, in one request. The browser used to make
// these four queries itself and stitch the results together. req.supabase is
// scoped to the caller's own JWT (see requireAuth), so RLS already limits
// every one of these to that user's own rows — no manual filtering needed.
// Since words' RLS was broadened for study groups, "every one of these" now
// includes words/links/tags on a shared word too, not just ones this caller
// created themselves — word_progress is the one query that stays strictly
// personal (its own RLS is `user_id = auth.uid()`, not word_is_visible), which
// is what keeps practice stats per-user even on a shared word.
router.get(
  '/',
  route(async (req, res) => {
    // Each list is fetched a page at a time (see fetchAllRows) — Supabase
    // cuts a single request off at 1000 rows, and links (two rows each) and
    // tag assignments add up faster than words do. Every query has a full
    // ordering so pages never overlap or skip rows.
    const exact = { count: 'exact' };
    const [wordsRes, linksRes, tagsRes, wordTagsRes, wordGroupsRes, progressRes, groupsRes] = await Promise.all([
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
      fetchAllRows((from, to) =>
        req.supabase
          .from('word_groups')
          .select('word_id, group_id', exact)
          .order('word_id', { ascending: true })
          .order('group_id', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        req.supabase
          .from('word_progress')
          .select('word_id, correct_count, wrong_count', exact)
          .order('word_id', { ascending: true })
          .range(from, to)
      ),
      // Minimal — just enough for the scope-selector pill rows used across
      // the app. GET /api/groups carries the richer detail (invite code,
      // membership) for the dedicated Groups screen.
      fetchAllRows((from, to) =>
        req.supabase
          .from('groups')
          .select('id, name', exact)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      ),
    ]);

    const failed = [wordsRes, linksRes, tagsRes, wordTagsRes, wordGroupsRes, progressRes, groupsRes].find(
      (r) => r.error
    );
    if (failed) return fail(res, 'GET /api/vocabulary', failed.error);

    const withLinksAndTags = attachLinksAndTags(wordsRes.data, linksRes.data, wordTagsRes.data);
    const withOwnership = attachOwnership(withLinksAndTags, req.userId);
    const words = attachGroupsAndProgress(withOwnership, wordGroupsRes.data, progressRes.data);

    res.json({ words, tags: tagsRes.data || [], groups: groupsRes.data || [] });
  })
);

export default router;
