import { supabase } from './supabase.js';

// Finds a tag by name (case-insensitive) or creates it. This used to consult
// only the browser's in-memory tag list, which meant a tag created elsewhere
// caused a duplicate-key failure; querying the table is correct regardless of
// what any client has loaded.
// Returns { tag, created } or { error }.
export async function ensureTag(name) {
  const clean = String(name ?? '').trim().toLowerCase();
  if (!clean) return { error: new Error('Tag name is required') };

  const existing = await supabase.from('tags').select('id, name').ilike('name', clean).limit(1);
  if (existing.error) return { error: existing.error };
  if (existing.data?.length) return { tag: existing.data[0], created: false };

  const inserted = await supabase.from('tags').insert({ name: clean }).select('id, name').single();
  if (!inserted.error && inserted.data) return { tag: inserted.data, created: true };

  // Someone inserted the same name between our select and insert — re-read it
  // rather than failing.
  const retry = await supabase.from('tags').select('id, name').ilike('name', clean).limit(1);
  if (retry.data?.length) return { tag: retry.data[0], created: false };
  return { error: inserted.error };
}
