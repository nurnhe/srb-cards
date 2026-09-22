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
  it('never leaks the raw user_id, and defaults the new word to mine/empty relations', async () => {
    const fakeSupabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 'w1', sr: 'hvala', ru: 'спасибо', example: null, user_id: 'me' },
              error: null,
            }),
          }),
        }),
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
    expect(body).toEqual({
      id: 'w1',
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
});
