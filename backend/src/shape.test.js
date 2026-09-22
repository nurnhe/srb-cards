import { describe, it, expect } from 'vitest';
import { attachLinksAndTags, attachOwnership, attachGroupsAndProgress } from './shape.js';

describe('attachLinksAndTags', () => {
  it('attaches related-word ids and tag ids by matching word_id', () => {
    const words = [{ id: 'w1' }, { id: 'w2' }];
    const links = [{ word_id: 'w1', related_word_id: 'w2' }];
    const wordTags = [{ word_id: 'w1', tag_id: 't1' }];
    const result = attachLinksAndTags(words, links, wordTags);
    expect(result).toEqual([
      { id: 'w1', relatedIds: ['w2'], tagIds: ['t1'] },
      { id: 'w2', relatedIds: [], tagIds: [] },
    ]);
  });

  it('copes with empty/missing inputs', () => {
    expect(attachLinksAndTags([], [], [])).toEqual([]);
    expect(attachLinksAndTags(null, null, null)).toEqual([]);
  });
});

describe('attachOwnership', () => {
  it('replaces user_id with a mine boolean, and never leaks the raw id', () => {
    const result = attachOwnership([{ id: 'w1', user_id: 'me' }, { id: 'w2', user_id: 'them' }], 'me');
    expect(result).toEqual([
      { id: 'w1', mine: true },
      { id: 'w2', mine: false },
    ]);
    expect(result.some((w) => 'user_id' in w)).toBe(false);
  });

  it('copes with an empty list', () => {
    expect(attachOwnership([], 'me')).toEqual([]);
  });
});

describe('attachGroupsAndProgress', () => {
  it('attaches group ids and the caller\'s own progress by word_id', () => {
    const words = [{ id: 'w1' }, { id: 'w2' }];
    const wordGroups = [{ word_id: 'w1', group_id: 'g1' }, { word_id: 'w1', group_id: 'g2' }];
    const progress = [{ word_id: 'w1', correct_count: 3, wrong_count: 1 }];
    const result = attachGroupsAndProgress(words, wordGroups, progress);
    expect(result).toEqual([
      { id: 'w1', groupIds: ['g1', 'g2'], correct_count: 3, wrong_count: 1 },
      { id: 'w2', groupIds: [], correct_count: 0, wrong_count: 0 },
    ]);
  });

  it('defaults a never-practiced word to 0/0 rather than leaving progress undefined', () => {
    const result = attachGroupsAndProgress([{ id: 'w1' }], [], []);
    expect(result).toEqual([{ id: 'w1', groupIds: [], correct_count: 0, wrong_count: 0 }]);
  });
});
