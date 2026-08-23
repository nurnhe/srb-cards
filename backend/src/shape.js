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
