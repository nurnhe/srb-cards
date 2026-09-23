import { describe, it, expect } from 'vitest';
import express from 'express';
import words from './words.js';

// router.param's isValidId guard rejects anything that isn't a real uuid —
// these stand in for a word id / a group id in every test below.
const WORD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const GROUP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function withApp(fakeSupabase, run) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.supabase = fakeSupabase;
    req.userId = 'me';
    next();
  });
  app.use('/api/words', words);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}/api/words`);
  } finally {
    server.close();
  }
}

describe('POST /api/words/:id/groups', () => {
  it('upserts a word_groups row', async () => {
    let upserted = null;
    let opts = null;
    const fakeSupabase = {
      from: () => ({
        upsert: (rows, options) => {
          upserted = rows;
          opts = options;
          return Promise.resolve({ error: null });
        },
      }),
    };
    const res = await withApp(fakeSupabase, (base) =>
      fetch(`${base}/${WORD_ID}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: GROUP_ID }),
      })
    );
    expect(res.status).toBe(200);
    expect(upserted).toEqual([{ word_id: WORD_ID, group_id: GROUP_ID }]);
    expect(opts).toEqual({ onConflict: 'word_id,group_id' });
  });

  it('rejects a missing/invalid groupId', async () => {
    const res = await withApp({}, (base) =>
      fetch(`${base}/${WORD_ID}/groups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/words/:wordId/groups/:groupId', () => {
  it('removes the sharing row', async () => {
    const eqCalls = [];
    const builder = {
      delete: () => builder,
      eq: (col, val) => {
        eqCalls.push([col, val]);
        return builder;
      },
      then: (resolve) => resolve({ error: null }),
    };
    const res = await withApp({ from: () => builder }, (base) =>
      fetch(`${base}/${WORD_ID}/groups/${GROUP_ID}`, { method: 'DELETE' })
    );
    expect(res.status).toBe(204);
    expect(eqCalls).toEqual([['word_id', WORD_ID], ['group_id', GROUP_ID]]);
  });
});

describe('POST /api/words/:id/answer', () => {
  it('calls increment_word_progress, not the old per-word RPC', async () => {
    let rpcArgs = null;
    const fakeSupabase = {
      rpc: async (name, args) => {
        rpcArgs = { name, args };
        return { data: [{ correct_count: 5, wrong_count: 1 }], error: null };
      },
    };
    const res = await withApp(fakeSupabase, (base) =>
      fetch(`${base}/${WORD_ID}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct: true }),
      })
    );
    expect(res.status).toBe(200);
    expect(rpcArgs).toEqual({ name: 'increment_word_progress', args: { p_word_id: WORD_ID, p_field: 'correct_count' } });
    expect(await res.json()).toEqual({ correct_count: 5, wrong_count: 1 });
  });

  it('404s when the RPC returns no row (word not visible to this caller)', async () => {
    const fakeSupabase = { rpc: async () => ({ data: [], error: null }) };
    const res = await withApp(fakeSupabase, (base) =>
      fetch(`${base}/${WORD_ID}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correct: false }),
      })
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/words (response shape)', () => {
  it('generates its own id and skips RETURNING (never leaks user_id, defaults to mine/empty relations)', async () => {
    let inserted = null;
    const fakeSupabase = {
      from: () => ({
        insert: (row) => {
          inserted = row;
          return Promise.resolve({ error: null });
        },
      }),
    };
    const res = await withApp(fakeSupabase, (base) =>
      fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sr: 'hvala', ru: 'спасибо' }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    // Insert carries a real generated uuid, and the RLS-safe insert never
    // calls .select() — this fake `from()` would throw if it did, since it
    // has no `select` method at all.
    expect(inserted).toMatchObject({ sr: 'hvala', ru: 'спасибо', example: null, user_id: 'me' });
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({
      id: inserted.id,
      sr: 'hvala',
      ru: 'спасибо',
      example: null,
      relatedIds: [],
      tagIds: [],
      groupIds: [],
      correct_count: 0,
      wrong_count: 0,
      mine: true,
    });
  });

  it('reports the database error rather than a generic failure', async () => {
    const fakeSupabase = { from: () => ({ insert: () => Promise.resolve({ error: { message: 'nope' } }) }) };
    const res = await withApp(fakeSupabase, (base) =>
      fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sr: 'hvala', ru: 'спасибо' }),
      })
    );
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/words/:id', () => {
  it('updates with a count request instead of .select(), and never calls .select()', async () => {
    let updatedFields = null;
    let updateOptions = null;
    let eqArgs = null;
    const fakeSupabase = {
      from: () => ({
        update: (fields, options) => {
          updatedFields = fields;
          updateOptions = options;
          return { eq: (col, val) => { eqArgs = [col, val]; return Promise.resolve({ error: null, count: 1 }); } };
        },
      }),
    };
    const res = await withApp(fakeSupabase, (base) =>
      fetch(`${base}/${WORD_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sr: 'hvala', ru: 'спасибо', example: 'Hvala ti.' }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(updatedFields).toEqual({ sr: 'hvala', ru: 'спасибо', example: 'Hvala ti.' });
    expect(updateOptions).toEqual({ count: 'exact' });
    expect(eqArgs).toEqual(['id', WORD_ID]);
    expect(body).toEqual({ id: WORD_ID, sr: 'hvala', ru: 'спасибо', example: 'Hvala ti.' });
  });

  it('404s when the count comes back zero (stale id, deleted, or someone else\'s word)', async () => {
    const fakeSupabase = {
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null, count: 0 }) }) }),
    };
    const res = await withApp(fakeSupabase, (base) =>
      fetch(`${base}/${WORD_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sr: 'hvala', ru: 'спасибо' }),
      })
    );
    expect(res.status).toBe(404);
  });

  it('reports the database error rather than a generic failure', async () => {
    const fakeSupabase = {
      from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: { message: 'nope' }, count: null }) }) }),
    };
    const res = await withApp(fakeSupabase, (base) =>
      fetch(`${base}/${WORD_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sr: 'hvala', ru: 'спасибо' }),
      })
    );
    expect(res.status).toBe(500);
  });
});
