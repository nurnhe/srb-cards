// Turns the flat junction-table rows from Postgres into the shape the frontend
// works with: each word carries its own arrays of related-word ids and tag ids.
// This used to happen in App.jsx after four separate queries.

function groupBy(rows, keyField, valueField) {
  const map = {};
  (rows || []).forEach((row) => {
    if (!map[row[keyField]]) map[row[keyField]] = [];
    map[row[keyField]].push(row[valueField]);
  });
  return map;
}

export function attachLinksAndTags(wordRows, linkRows, tagLinkRows) {
  const links = groupBy(linkRows, 'word_id', 'related_word_id');
  const tags = groupBy(tagLinkRows, 'word_id', 'tag_id');
  return (wordRows || []).map((w) => ({
    ...w,
    relatedIds: links[w.id] || [],
    tagIds: tags[w.id] || [],
  }));
}

// Replaces each word row's raw owner id with a simple `mine` boolean, and
// strips the raw id out — the client only ever needs "is this mine", not
// another person's raw user id (nothing else in this app exposes one user's
// id to another; there's no reason to start with this one).
export function attachOwnership(wordRows, callerId) {
  return (wordRows || []).map(({ user_id, ...rest }) => ({ ...rest, mine: user_id === callerId }));
}

// Stitches on which groups a word is shared to, and the caller's own
// practice progress on it (word_progress is per-caller already, since the
// query it comes from is scoped by RLS to `user_id = auth.uid()` — see
// routes/vocabulary.js). A word with no progress row yet (never practiced)
// defaults to 0/0, same as a brand-new word always has.
export function attachGroupsAndProgress(wordRows, wordGroupRows, progressRows) {
  const groupIds = groupBy(wordGroupRows, 'word_id', 'group_id');
  const progressByWord = {};
  (progressRows || []).forEach((p) => {
    progressByWord[p.word_id] = p;
  });
  return (wordRows || []).map((w) => {
    const progress = progressByWord[w.id];
    return {
      ...w,
      groupIds: groupIds[w.id] || [],
      correct_count: progress?.correct_count || 0,
      wrong_count: progress?.wrong_count || 0,
    };
  });
}
