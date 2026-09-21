import { describe, it, expect } from 'vitest';
import { authFailureStatus, fetchAllRows } from './http.js';
import { ensureTag } from './tags.js';

describe('authFailureStatus', () => {
  it('treats a rejected token as a real logout (401)', () => {
    expect(authFailureStatus({ name: 'AuthApiError', status: 401 })).toBe(401);
    expect(authFailureStatus({ name: 'AuthApiError', status: 403 })).toBe(401);
    expect(authFailureStatus({ name: 'AuthApiError', status: 400 })).toBe(401);
    expect(authFailureStatus({ name: 'AuthSessionMissingError' })).toBe(401);
  });

  it('does not log anyone out over a Supabase hiccup', () => {
    expect(authFailureStatus({ name: 'AuthRetryableFetchError', status: 0 })).toBe(503);
    expect(authFailureStatus({ name: 'AuthApiError', status: 500 })).toBe(503);
    expect(authFailureStatus({ name: 'AuthApiError', status: 502 })).toBe(503);
    expect(authFailureStatus({ name: 'AuthApiError', status: 429 })).toBe(503);
    expect(authFailureStatus({ name: 'AuthUnknownError' })).toBe(503);
  });

  it('treats a missing error as unauthorized', () => {
    expect(authFailureStatus(null)).toBe(401);
  });
});

describe('fetchAllRows', () => {
  // A fake table that, like Supabase, never returns more than `cap` rows.
  const fakeTable = (total, cap = 1000, { withCount = true } = {}) => {
    const all = Array.from({ length: total }, (_, i) => ({ n: i }));
    const calls = [];
    const build = async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, Math.min(to, from + cap - 1) + 1), error: null, count: withCount ? total : undefined };
    };
    return { build, calls };
  };

  it('returns everything when it fits in one page', async () => {
    const { build, calls } = fakeTable(50);
    const { data } = await fetchAllRows(build);
    expect(data).toHaveLength(50);
    expect(calls).toHaveLength(1);
  });

  it('keeps asking until every row has arrived, in order and without repeats', async () => {
    const { build } = fakeTable(2500);
    const { data, error } = await fetchAllRows(build);
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data.map((r) => r.n)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
  });

  it('copes with exactly a full page and with nothing at all', async () => {
    expect((await fetchAllRows(fakeTable(1000).build)).data).toHaveLength(1000);
    expect((await fetchAllRows(fakeTable(0).build)).data).toEqual([]);
  });

  it('still gets everything if the server caps pages below the requested size', async () => {
    const { build } = fakeTable(1300, 500);
    const { data } = await fetchAllRows(build);
    expect(data).toHaveLength(1300);
  });

  it('works without a total count', async () => {
    const { build } = fakeTable(2100, 1000, { withCount: false });
    expect((await fetchAllRows(build)).data).toHaveLength(2100);
  });

  it('reports an error from any page instead of returning partial data', async () => {
    let call = 0;
    const build = async () => {
      call += 1;
      if (call === 2) return { data: null, error: new Error('boom') };
      return { data: Array.from({ length: 1000 }, (_, i) => ({ n: i })), error: null, count: 3000 };
    };
    const result = await fetchAllRows(build);
    expect(result.data).toBeNull();
    expect(result.error.message).toBe('boom');
  });
});

describe('ensureTag', () => {
  const fakeClient = (existing, { insertError = null, racedTag = null } = {}) => {
    const rows = [...existing];
    let selects = 0;
    const inserts = [];
    return {
      inserts,
      from() {
        return {
          select: async () => {
            selects += 1;
            // A second read after a failed insert sees a tag someone else made.
            return { data: racedTag && selects > 1 ? [...rows, racedTag] : rows, error: null };
          },
          insert: (row) => ({
            select: () => ({
              single: async () => {
                inserts.push(row);
                if (insertError) return { data: null, error: insertError };
                const made = { id: `new-${inserts.length}`, name: row.name };
                rows.push(made);
                return { data: made, error: null };
              },
            }),
          }),
        };
      },
    };
  };

  it('finds an existing tag whatever its letter case', async () => {
    const client = fakeClient([{ id: 't1', name: 'Glagol' }]);
    const result = await ensureTag(client, 'u1', '  GLAGOL ');
    expect(result).toEqual({ tag: { id: 't1', name: 'Glagol' }, created: false });
    expect(client.inserts).toEqual([]);
  });

  it('does not mistake a name with % or _ for a different tag', async () => {
    const client = fakeClient([{ id: 't1', name: 'glagol' }]);
    for (const name of ['_lagol', 'gl%', '%', 'gl_gol', '*', 'gl*']) {
      const result = await ensureTag(client, 'u1', name);
      expect(result.created).toBe(true);
      expect(result.tag.name).toBe(name);
    }
  });

  it('creates a new tag owned by the caller', async () => {
    const client = fakeClient([]);
    const result = await ensureTag(client, 'user-7', 'imenica');
    expect(result.created).toBe(true);
    expect(client.inserts).toEqual([{ name: 'imenica', user_id: 'user-7' }]);
  });

  it('re-reads the tag if another request created it at the same moment', async () => {
    const client = fakeClient([], { insertError: new Error('duplicate'), racedTag: { id: 'r1', name: 'pridev' } });
    const result = await ensureTag(client, 'u1', 'pridev');
    expect(result).toEqual({ tag: { id: 'r1', name: 'pridev' }, created: false });
  });

  it('reports the error when the insert fails and nothing turns up', async () => {
    const client = fakeClient([], { insertError: new Error('nope') });
    const result = await ensureTag(client, 'u1', 'x');
    expect(result.error.message).toBe('nope');
  });

  it('rejects an empty name', async () => {
    expect((await ensureTag(fakeClient([]), 'u1', '   ')).error).toBeDefined();
  });
});

describe('GET /api/vocabulary with more than 1000 rows', () => {
  it('returns every word, link and tag assignment even though the database caps each answer', async () => {
    const { default: express } = await import('express');
    const { default: vocabulary } = await import('./routes/vocabulary.js');

    const CAP = 1000;
    const words = Array.from({ length: 1500 }, (_, i) => ({
      id: `w${String(i).padStart(4, '0')}`, sr: `r${i}`, ru: 'x', example: null, correct_count: 0, wrong_count: 0,
    }));
    const links = words.slice(1).map((w, i) => ({ word_id: words[i].id, related_word_id: w.id }));
    const wordTags = words.map((w) => ({ word_id: w.id, tag_id: 't1' }));
    const tables = { words, word_links: links, tags: [{ id: 't1', name: 'glagol' }], word_tags: wordTags };

    const fakeSupabase = {
      from(table) {
        const rows = tables[table];
        const q = {
          select: () => q,
          order: () => q,
          range: (from, to) => Promise.resolve({
            data: rows.slice(from, Math.min(to, from + CAP - 1) + 1),
            error: null,
            count: rows.length,
          }),
        };
        return q;
      },
    };

    const app = express();
    app.use((req, res, next) => { req.supabase = fakeSupabase; next(); });
    app.use('/api/vocabulary', vocabulary);
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/vocabulary`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.words).toHaveLength(1500);
      expect(body.words[1499].tagIds).toEqual(['t1']);
      expect(body.words[0].relatedIds).toEqual(['w0001']);
      expect(body.words[1499].relatedIds).toEqual([]);
      expect(body.tags).toEqual([{ id: 't1', name: 'glagol' }]);
    } finally {
      server.close();
    }
  });
});
