// Finds a tag by name (case-insensitive, scoped to the caller's own tags via
// RLS) or creates it. This used to consult only the browser's in-memory tag
// list, which meant a tag created elsewhere caused a duplicate-key failure;
// querying the table is correct regardless of what any client has loaded.
// Returns { tag, created } or { error }.
//
// The name is compared here in code rather than with a database ilike: ilike
// treats % _ and * as wildcards, so a tag named "_lagol" would have matched
// "glagol". A person has a few dozen tags at most, so reading them all is cheap.
async function findTagByName(supabaseClient, cleanName) {
  const { data, error } = await supabaseClient.from('tags').select('id, name');
  if (error) return { error };
  const tag = (data || []).find((t) => t.name.toLowerCase() === cleanName);
  return { tag: tag || null };
}

export async function ensureTag(supabaseClient, userId, name) {
  const clean = String(name ?? '').trim().toLowerCase();
  if (!clean) return { error: new Error('Tag name is required') };

  const existing = await findTagByName(supabaseClient, clean);
  if (existing.error) return { error: existing.error };
  if (existing.tag) return { tag: existing.tag, created: false };

  const inserted = await supabaseClient
    .from('tags')
    .insert({ name: clean, user_id: userId })
    .select('id, name')
    .single();
  if (!inserted.error && inserted.data) return { tag: inserted.data, created: true };

  // Someone inserted the same name between our select and insert — re-read it
  // rather than failing.
  const retry = await findTagByName(supabaseClient, clean);
  if (retry.tag) return { tag: retry.tag, created: false };
  return { error: inserted.error };
}
