import { describe, it, expect } from 'vitest';
import express from 'express';
import groups from './groups.js';

// Same style as the GET /api/vocabulary integration test in backend.test.js:
// a real Express app wired to a fake req.supabase, hit with real HTTP calls.
async function withApp(fakeSupabase, userId, run) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.supabase = fakeSupabase;
    req.userId = userId;
    next();
  });
  app.use('/api/groups', groups);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}/api/groups`);
  } finally {
    server.close();
  }
}

describe('GET /api/groups', () => {
  it('returns groups with their full membership', async () => {
    const groupRows = [{ id: 'g1', name: 'Друштво', invite_code: 'ABC', created_by: 'me', created_at: 't' }];
    const memberRows = [{ group_id: 'g1', user_id: 'me', joined_at: 't' }, { group_id: 'g1', user_id: 'them', joined_at: 't2' }];
    let inArg = null;
    const fakeSupabase = {
      from(table) {
        if (table === 'groups') {
          return { select: () => ({ order: async () => ({ data: groupRows, error: null }) }) };
        }
        return { select: () => ({ in: async (col, ids) => { inArg = ids; return { data: memberRows, error: null }; } }) };
      },
    };
    const body = await withApp(fakeSupabase, 'me', async (base) => (await fetch(base)).json());
    expect(body.groups).toEqual(groupRows);
    expect(body.members).toEqual(memberRows);
    expect(inArg).toEqual(['g1']);
  });

  it('skips the membership query entirely when there are no groups', async () => {
    let memberQueried = false;
    const fakeSupabase = {
      from(table) {
        if (table === 'groups') return { select: () => ({ order: async () => ({ data: [], error: null }) }) };
        memberQueried = true;
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
      },
    };
    const body = await withApp(fakeSupabase, 'me', async (base) => (await fetch(base)).json());
    expect(body).toEqual({ groups: [], members: [] });
    expect(memberQueried).toBe(false);
  });
});

describe('POST /api/groups', () => {
  it('creates a group via the create_group RPC', async () => {
    let rpcArgs = null;
    const fakeSupabase = {
      rpc: async (name, args) => {
        rpcArgs = { name, args };
        return { data: { id: 'g1', name: 'Друштво', invite_code: 'ABC123XY' }, error: null };
      },
    };
    const res = await withApp(fakeSupabase, 'me', (base) =>
      fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Друштво' }) })
    );
    expect(res.status).toBe(201);
    expect(rpcArgs).toEqual({ name: 'create_group', args: { p_name: 'Друштво' } });
    expect(await res.json()).toEqual({ id: 'g1', name: 'Друштво', invite_code: 'ABC123XY' });
  });

  it('rejects an empty name without calling the database', async () => {
    let called = false;
    const fakeSupabase = { rpc: async () => { called = true; } };
    const res = await withApp(fakeSupabase, 'me', (base) =>
      fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '  ' }) })
    );
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});

describe('POST /api/groups/join', () => {
  it('joins via the join_group_by_code RPC', async () => {
    let rpcArgs = null;
    const fakeSupabase = {
      rpc: async (name, args) => {
        rpcArgs = { name, args };
        return { data: { id: 'g1', name: 'Друштво' }, error: null };
      },
    };
    const res = await withApp(fakeSupabase, 'me', (base) =>
      fetch(base + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'abc123xy' }) })
    );
    expect(res.status).toBe(200);
    expect(rpcArgs).toEqual({ name: 'join_group_by_code', args: { p_code: 'abc123xy' } });
  });

  it('maps a bad-code exception (P0001) to 400, not a generic 500', async () => {
    const fakeSupabase = { rpc: async () => ({ data: null, error: { code: 'P0001', message: 'No group found for that code' } }) };
    const res = await withApp(fakeSupabase, 'me', (base) =>
      fetch(base + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'nope' }) })
    );
    expect(res.status).toBe(400);
  });

  it('a genuine server error still reports 500', async () => {
    const fakeSupabase = { rpc: async () => ({ data: null, error: { code: '08006', message: 'connection lost' } }) };
    const res = await withApp(fakeSupabase, 'me', (base) =>
      fetch(base + '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'abc' }) })
    );
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/groups/:id/membership', () => {
  it('removes only the caller\'s own membership row', async () => {
    const eqCalls = [];
    const builder = {
      delete: () => builder,
      eq: (col, val) => {
        eqCalls.push([col, val]);
        return builder;
      },
      then: (resolve) => resolve({ error: null }),
    };
    const fakeSupabase = { from: () => builder };
    const groupId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const res = await withApp(fakeSupabase, 'me', (base) => fetch(`${base}/${groupId}/membership`, { method: 'DELETE' }));
    expect(res.status).toBe(204);
    expect(eqCalls).toEqual([['group_id', groupId], ['user_id', 'me']]);
  });
});
