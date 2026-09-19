// Finds a tag by name (case-insensitive, scoped to the caller's own tags via
// RLS) or creates it. This used to consult only the browser's in-memory tag
// list, which meant a tag created elsewhere caused a duplicate-key failure;
// querying the table is correct regardless of what any client has loaded.
// Returns { tag, created } or { error }.
export async function ensureTag(supabaseClient, userId, name) {
  const clean = String(name ?? '').trim().toLowerCase();
  if (!clean) return { error: new Error('Tag name is required') };

  const existing = await supabaseClient.from('tags').select('id, name').ilike('name', clean).limit(1);
  if (existing.error) return { error: existing.error };
  if (existing.data?.length) return { tag: existing.data[0], created: false };

  const inserted = await supabaseClient
    .from('tags')
    .insert({ name: clean, user_id: userId })
    .select('id, name')
    .single();
  if (!inserted.error && inserted.data) return { tag: inserted.data, created: true };

  // Someone inserted the same name between our select and insert — re-read it
  // rather than failing.
  const retry = await supabaseClient.from('tags').select('id, name').ilike('name', clean).limit(1);
  if (retry.data?.length) return { tag: retry.data[0], created: false };
  return { error: inserted.error };
}
