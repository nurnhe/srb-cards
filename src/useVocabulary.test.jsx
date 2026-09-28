// @vitest-environment jsdom
//
// Exercises the data layer with no browser needed beyond jsdom's fake DOM —
// same rationale as wiktionary.test.js's own environment comment. `./api` is
// mocked so nothing here touches a real network or Supabase.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useVocabulary } from './useVocabulary';
import * as api from './api';

vi.mock('./api', () => ({
  getVocabulary: vi.fn(),
  createWord: vi.fn(),
  updateWord: vi.fn(),
  recordAnswer: vi.fn(),
  deleteWord: vi.fn(),
  linkWords: vi.fn(),
  unlinkWords: vi.fn(),
  tagWord: vi.fn(),
  untagWord: vi.fn(),
  shareWordToGroup: vi.fn(),
  unshareWordFromGroup: vi.fn(),
  createGroup: vi.fn(),
  joinGroup: vi.fn(),
  leaveGroup: vi.fn(),
}));
// wordsNeedingPartOfSpeech etc. pull in fetchPartsOfSpeechFromWiktionary
// transitively via wiktionary.js — none of the tests below trigger it
// (detectPartsOfSpeech/autoTagPartOfSpeech aren't called), so it's left
// unmocked rather than stubbing a module nothing here uses.

function renderVocabulary(initialAuthed) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest;
  function Harness({ authed }) {
    latest = useVocabulary(authed);
    return null;
  }
  act(() => {
    root.render(<Harness authed={initialAuthed} />);
  });
  return {
    get current() {
      return latest;
    },
    rerender(authed) {
      act(() => {
        root.render(<Harness authed={authed} />);
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const word = (overrides = {}) => ({
  id: 'w1',
  sr: 'hvala',
  ru: 'спасибо',
  example: null,
  relatedIds: [],
  tagIds: [],
  groupIds: [],
  correct_count: 0,
  wrong_count: 0,
  ...overrides,
});

describe('useVocabulary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts empty and not ready before authed is true', () => {
    const h = renderVocabulary(null);
    expect(h.current.words).toEqual([]);
    expect(h.current.ready).toBe(false);
    h.unmount();
  });

  it('loads words/tags/groups once authed and marks ready', async () => {
    api.getVocabulary.mockResolvedValue({
      data: { words: [word()], tags: [{ id: 't1', name: 'храна' }], groups: [{ id: 'g1', name: 'Клуб' }] },
      error: null,
    });
    const h = renderVocabulary(true);
    await act(async () => {});

    expect(api.getVocabulary).toHaveBeenCalledTimes(1);
    expect(h.current.ready).toBe(true);
    expect(h.current.words).toHaveLength(1);
    expect(h.current.tags).toEqual([{ id: 't1', name: 'храна' }]);
    expect(h.current.groups).toEqual([{ id: 'g1', name: 'Клуб' }]);
    expect(h.current.storageError).toBeNull();
    h.unmount();
  });

  it('sets a storage error when the load fails, but still becomes ready (so the shell renders with the error banner)', async () => {
    api.getVocabulary.mockResolvedValue({ data: null, error: new Error('network down') });
    const h = renderVocabulary(true);
    await act(async () => {});

    expect(h.current.ready).toBe(true);
    expect(h.current.storageError).toBe('Не могу да учитам речи. Покушајте поново.');
    h.unmount();
  });

  it('does not mark ready when the load failed with Unauthorized (a sign-out is about to happen)', async () => {
    api.getVocabulary.mockResolvedValue({ data: null, error: new Error('Unauthorized') });
    const h = renderVocabulary(true);
    await act(async () => {});

    expect(h.current.ready).toBe(false);
    h.unmount();
  });

  it('resets everything back to empty when authed goes false', async () => {
    api.getVocabulary.mockResolvedValue({ data: { words: [word()], tags: [], groups: [] }, error: null });
    const h = renderVocabulary(true);
    await act(async () => {});
    expect(h.current.words).toHaveLength(1);

    h.rerender(false);
    expect(h.current.words).toEqual([]);
    expect(h.current.ready).toBe(false);
    h.unmount();
  });

  it('addWord appends the saved word and clears any previous error', async () => {
    api.getVocabulary.mockResolvedValue({ data: { words: [], tags: [], groups: [] }, error: null });
    const h = renderVocabulary(true);
    await act(async () => {});

    api.createWord.mockResolvedValue({ data: word({ id: 'new' }), error: null });
    let result;
    await act(async () => {
      result = await h.current.addWord('hvala', 'спасибо', null);
    });

    expect(result.id).toBe('new');
    expect(h.current.words.map((w) => w.id)).toEqual(['new']);
    expect(h.current.storageError).toBeNull();
    h.unmount();
  });

  it('addWord sets a specific error and adds nothing when the field is too long', async () => {
    api.getVocabulary.mockResolvedValue({ data: { words: [], tags: [], groups: [] }, error: null });
    const h = renderVocabulary(true);
    await act(async () => {});

    api.createWord.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('sr is too long'), { code: 'too_long', field: 'sr', max: 100 }),
    });
    let result;
    await act(async () => {
      result = await h.current.addWord('a'.repeat(101), 'x', null);
    });

    expect(result).toBeNull();
    expect(h.current.words).toEqual([]);
    expect(h.current.storageError).toBe('Предугачак текст: „Реч“ може имати највише 100 знакова.');
    h.unmount();
  });

  it('deleteWord removes the word and strips it from any relatedIds', async () => {
    api.getVocabulary.mockResolvedValue({
      data: { words: [word({ id: 'a', relatedIds: ['b'] }), word({ id: 'b', relatedIds: ['a'] })], tags: [], groups: [] },
      error: null,
    });
    const h = renderVocabulary(true);
    await act(async () => {});

    api.deleteWord.mockResolvedValue({ error: null });
    await act(async () => {
      await h.current.deleteWord('a');
    });

    expect(h.current.words.map((w) => w.id)).toEqual(['b']);
    expect(h.current.words[0].relatedIds).toEqual([]);
    h.unmount();
  });

  it('tagWord adds a new tag once and links it to the word, deduping an already-known tag', async () => {
    api.getVocabulary.mockResolvedValue({
      data: { words: [word({ id: 'a' })], tags: [{ id: 't1', name: 'храна' }], groups: [] },
      error: null,
    });
    const h = renderVocabulary(true);
    await act(async () => {});

    api.tagWord.mockResolvedValue({ data: { tag: { id: 't1', name: 'храна' }, created: false }, error: null });
    await act(async () => {
      await h.current.tagWord('a', 'храна');
    });

    expect(h.current.tags).toEqual([{ id: 't1', name: 'храна' }]); // not duplicated
    expect(h.current.words[0].tagIds).toEqual(['t1']);
    h.unmount();
  });

  it('recordAnswer bumps the count optimistically then settles on the server value', async () => {
    api.getVocabulary.mockResolvedValue({ data: { words: [word({ id: 'a', correct_count: 2 })], tags: [], groups: [] }, error: null });
    const h = renderVocabulary(true);
    await act(async () => {});

    let resolveApi;
    api.recordAnswer.mockReturnValue(
      new Promise((resolve) => {
        resolveApi = resolve;
      })
    );
    let pending;
    act(() => {
      pending = h.current.recordAnswer('a', true);
    });
    // optimistic bump happens synchronously before the server responds
    expect(h.current.words[0].correct_count).toBe(3);

    await act(async () => {
      resolveApi({ data: { correct_count: 3, wrong_count: 0 }, error: null });
      await pending;
    });
    expect(h.current.words[0]).toMatchObject({ correct_count: 3, wrong_count: 0 });
    h.unmount();
  });

  it('recordAnswer rolls back the optimistic bump when the save fails', async () => {
    api.getVocabulary.mockResolvedValue({ data: { words: [word({ id: 'a', wrong_count: 1 })], tags: [], groups: [] }, error: null });
    const h = renderVocabulary(true);
    await act(async () => {});

    api.recordAnswer.mockResolvedValue({ data: null, error: new Error('save failed') });
    await act(async () => {
      await h.current.recordAnswer('a', false);
    });

    expect(h.current.words[0].wrong_count).toBe(1); // back to where it started
    expect(h.current.storageError).toBe('Не могу да сачувам одговор.');
    h.unmount();
  });
});
