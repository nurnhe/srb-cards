import { describe, it, expect } from 'vitest';
import {
  cyrillicToLatin,
  latinToCyrillic,
  isCyrillic,
  otherScript,
  normalize,
  acceptedAnswers,
  parseVariants,
  shuffle,
  buildWeightedDeck,
  findDuplicateWord,
  isAnswerCorrect,
} from './logic';

describe('isCyrillic', () => {
  it('detects Cyrillic text', () => {
    expect(isCyrillic('хвала')).toBe(true);
  });
  it('detects Latin text as not Cyrillic', () => {
    expect(isCyrillic('hvala')).toBe(false);
  });
});

describe('cyrillicToLatin / latinToCyrillic', () => {
  it('converts basic words round-trip', () => {
    expect(cyrillicToLatin('хвала')).toBe('hvala');
    expect(latinToCyrillic('hvala')).toBe('хвала');
  });

  it('handles digraphs nj/lj/dž', () => {
    expect(cyrillicToLatin('његов')).toBe('njegov');
    expect(cyrillicToLatin('љубав')).toBe('ljubav');
    expect(cyrillicToLatin('џак')).toBe('džak');
    expect(latinToCyrillic('njegov')).toBe('његов');
    expect(latinToCyrillic('ljubav')).toBe('љубав');
    expect(latinToCyrillic('džak')).toBe('џак');
  });

  it('handles đ/č/ć/š/ž', () => {
    expect(cyrillicToLatin('ђак')).toBe('đak');
    expect(cyrillicToLatin('чај')).toBe('čaj');
    expect(cyrillicToLatin('ћирилица')).toBe('ćirilica');
    expect(cyrillicToLatin('шума')).toBe('šuma');
    expect(cyrillicToLatin('жуto')).toBe('žuto'); // guards against stray latin chars passing through
  });

  it('preserves capitalization, including digraph title-case', () => {
    expect(cyrillicToLatin('Његов')).toBe('Njegov');
    expect(cyrillicToLatin('ЊЕГОВ')).toBe('NJEGOV');
    expect(latinToCyrillic('Njegov')).toBe('Његов');
  });

  it('round-trips a full sentence unchanged in meaning', () => {
    const cyr = 'Хвала на помоћи, много си љубазан.';
    const lat = cyrillicToLatin(cyr);
    expect(latinToCyrillic(lat)).toBe(cyr);
  });

  it('leaves empty/falsy input unchanged', () => {
    expect(cyrillicToLatin('')).toBe('');
    expect(latinToCyrillic('')).toBe('');
  });
});

describe('otherScript', () => {
  it('returns the Latin form for Cyrillic input', () => {
    expect(otherScript('хвала')).toBe('hvala');
  });
  it('returns the Cyrillic form for Latin input', () => {
    expect(otherScript('hvala')).toBe('хвала');
  });
  it('returns null for empty input', () => {
    expect(otherScript('')).toBeNull();
    expect(otherScript('   ')).toBeNull();
  });
});

describe('normalize', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalize('  Hvala   lepo  ')).toBe('hvala lepo');
  });
  it('strips common punctuation', () => {
    expect(normalize('Hvala, lepo!')).toBe('hvala lepo');
  });
});

describe('acceptedAnswers', () => {
  it('splits a comma-separated list into normalized alternatives', () => {
    expect(acceptedAnswers('Спасибо, благодарю')).toEqual(['спасибо', 'благодарю']);
  });
  it('drops empty entries', () => {
    expect(acceptedAnswers('спасибо, , ')).toEqual(['спасибо']);
  });
});

describe('parseVariants', () => {
  it('splits and trims without lowercasing', () => {
    expect(parseVariants('Спасибо, Благодарю ')).toEqual(['Спасибо', 'Благодарю']);
  });
});

describe('shuffle', () => {
  it('returns a permutation with the same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle(arr);
    expect(result).toHaveLength(arr.length);
    expect([...result].sort()).toEqual([...arr].sort());
  });
  it('does not mutate the input array', () => {
    const arr = [1, 2, 3];
    shuffle(arr);
    expect(arr).toEqual([1, 2, 3]);
  });
});

describe('buildWeightedDeck', () => {
  it('gives struggling words more entries than clean ones', () => {
    const pool = [
      { id: 'clean', wrong_count: 0 },
      { id: 'hard', wrong_count: 3 },
    ];
    const deck = buildWeightedDeck(pool);
    const cleanCount = deck.filter((id) => id === 'clean').length;
    const hardCount = deck.filter((id) => id === 'hard').length;
    expect(cleanCount).toBe(1);
    expect(hardCount).toBe(4); // 1 + min(3, 5)
  });

  it('caps the extra weight so one very-hard word cannot swallow the deck', () => {
    const pool = [{ id: 'very-hard', wrong_count: 999 }];
    const deck = buildWeightedDeck(pool);
    expect(deck).toHaveLength(6); // 1 + min(999, 5)
  });

  it('includes every word at least once', () => {
    const pool = [
      { id: 'a', wrong_count: 0 },
      { id: 'b', wrong_count: 2 },
      { id: 'c', wrong_count: 5 },
    ];
    const deck = buildWeightedDeck(pool);
    expect(new Set(deck)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('reduces (though does not perfectly guarantee) back-to-back repeats of the same word', () => {
    // The anti-adjacency step is a single best-effort left-to-right swap
    // pass, not a full guaranteed rearrangement — for a heavily skewed
    // pool it measurably helps (~2.6 -> ~1.4 avg adjacent repeats per
    // deck in manual sampling) but doesn't reach zero. This test checks
    // it stays below the unmitigated baseline, not that repeats vanish.
    const pool = [
      { id: 'a', wrong_count: 5 }, // weight 6
      { id: 'b', wrong_count: 0 },
      { id: 'c', wrong_count: 0 },
      { id: 'd', wrong_count: 0 },
      { id: 'e', wrong_count: 0 },
      { id: 'f', wrong_count: 0 },
    ];
    let adjacentRepeats = 0;
    const runs = 200;
    for (let i = 0; i < runs; i++) {
      const deck = buildWeightedDeck(pool);
      for (let j = 1; j < deck.length; j++) {
        if (deck[j] === deck[j - 1]) adjacentRepeats++;
      }
    }
    expect(adjacentRepeats / runs).toBeLessThan(2);
  });
});

describe('findDuplicateWord', () => {
  const words = [{ id: '1', sr: 'хвала', ru: 'спасибо' }];

  it('finds an exact match', () => {
    expect(findDuplicateWord('хвала', words)?.id).toBe('1');
  });

  it('finds a match typed in the other script', () => {
    expect(findDuplicateWord('hvala', words)?.id).toBe('1');
  });

  it('finds a match differing only in case', () => {
    expect(findDuplicateWord('Хвала', words)?.id).toBe('1');
  });

  it('returns null for a genuinely new word', () => {
    expect(findDuplicateWord('molim', words)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(findDuplicateWord('', words)).toBeNull();
    expect(findDuplicateWord('   ', words)).toBeNull();
  });
});

describe('isAnswerCorrect', () => {
  const current = { sr: 'хвала', ru: 'спасибо, благодарю' };

  it('accepts any translation variant for sr-ru direction', () => {
    expect(isAnswerCorrect('sr-ru', current, 'спасибо')).toBe(true);
    expect(isAnswerCorrect('sr-ru', current, 'благодарю')).toBe(true);
    expect(isAnswerCorrect('sr-ru', current, 'пожалуйста')).toBe(false);
  });

  it('accepts either script for ru-sr direction', () => {
    expect(isAnswerCorrect('ru-sr', current, 'хвала')).toBe(true);
    expect(isAnswerCorrect('ru-sr', current, 'hvala')).toBe(true);
    expect(isAnswerCorrect('ru-sr', current, 'molim')).toBe(false);
  });

  it('ignores case and punctuation differences', () => {
    expect(isAnswerCorrect('sr-ru', current, ' Спасибо! ')).toBe(true);
  });
});
