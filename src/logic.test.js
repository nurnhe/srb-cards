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
  requeueMissedWord,
  findDuplicateWord,
  isAnswerCorrect,
  isRelevantTranslationMatch,
  isPlausibleRussianText,
  suggestTagsFromRelatedWords,
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

describe('requeueMissedWord', () => {
  it('inserts the missed word somewhere later in the deck, not at the very front', () => {
    const deck = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const result = requeueMissedWord(deck, 'missed', { minGap: 3, maxGap: 7 });
    const insertedAt = result.indexOf('missed');
    expect(insertedAt).toBeGreaterThanOrEqual(3);
    expect(insertedAt).toBeLessThanOrEqual(7);
  });

  it('never inserts at position 0 (never an immediate repeat) across many runs', () => {
    const deck = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    for (let i = 0; i < 50; i++) {
      const result = requeueMissedWord(deck, 'missed');
      expect(result.indexOf('missed')).toBeGreaterThan(0);
    }
  });

  it('clamps the insertion point to the end of a short deck instead of throwing', () => {
    const deck = ['a'];
    const result = requeueMissedWord(deck, 'missed', { minGap: 3, maxGap: 7 });
    expect(result).toEqual(['a', 'missed']);
  });

  it('leaves an already-empty deck untouched (defers to the next cycle instead of forcing an immediate repeat)', () => {
    const result = requeueMissedWord([], 'missed');
    expect(result).toEqual([]);
  });

  it('does not mutate the original deck', () => {
    const deck = ['a', 'b', 'c'];
    requeueMissedWord(deck, 'missed');
    expect(deck).toEqual(['a', 'b', 'c']);
  });

  it('can insert multiple times for repeated misses of the same word', () => {
    let deck = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    deck = requeueMissedWord(deck, 'x', { minGap: 1, maxGap: 1 });
    deck = requeueMissedWord(deck, 'x', { minGap: 1, maxGap: 1 });
    expect(deck.filter((id) => id === 'x')).toHaveLength(2);
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

describe('suggestTagsFromRelatedWords', () => {
  const tags = [
    { id: 't1', name: 'imenica' },
    { id: 't2', name: 'kretanje' },
    { id: 't3', name: 'glagol' },
  ];
  const words = [
    { id: '1', sr: 'izlaz', tagIds: ['t1', 't2'] },
    { id: '2', sr: 'izlaziti', tagIds: ['t3', 't2'] },
    { id: '3', sr: 'ulaz', tagIds: [] },
  ];

  it('collects tags from existing related words, deduped', () => {
    expect(suggestTagsFromRelatedWords(['izlaz', 'izlaziti'], words, tags)).toEqual([
      'imenica',
      'kretanje',
      'glagol',
    ]);
  });

  it('excludes tags already selected for the new word', () => {
    expect(suggestTagsFromRelatedWords(['izlaz', 'izlaziti'], words, tags, ['kretanje'])).toEqual([
      'imenica',
      'glagol',
    ]);
  });

  it('ignores related words not yet in the dictionary', () => {
    expect(suggestTagsFromRelatedWords(['nova-rec'], words, tags)).toEqual([]);
  });

  it('ignores related words with no tags', () => {
    expect(suggestTagsFromRelatedWords(['ulaz'], words, tags)).toEqual([]);
  });

  it('matches related words typed in the other script', () => {
    expect(suggestTagsFromRelatedWords(['излаз'], words, tags)).toEqual(['imenica', 'kretanje']);
  });

  it('returns an empty array when nothing is selected', () => {
    expect(suggestTagsFromRelatedWords([], words, tags)).toEqual([]);
  });

  it('excludes tags case-insensitively', () => {
    expect(suggestTagsFromRelatedWords(['izlaz'], words, tags, ['Imenica', 'KRETANJE'])).toEqual([]);
  });

  it('skips a tagId with no matching tag (e.g. a deleted tag)', () => {
    const wordsWithOrphanTag = [{ id: '4', sr: 'radnja', tagIds: ['t1', 'does-not-exist'] }];
    expect(suggestTagsFromRelatedWords(['radnja'], wordsWithOrphanTag, tags)).toEqual(['imenica']);
  });

  it('does not duplicate a tag when the same related word is listed twice', () => {
    expect(suggestTagsFromRelatedWords(['izlaz', 'izlaz'], words, tags)).toEqual(['imenica', 'kretanje']);
  });

  it('handles a missing tags list without throwing', () => {
    expect(suggestTagsFromRelatedWords(['izlaz'], words, null)).toEqual([]);
  });

  it('handles a missing words list without throwing', () => {
    expect(suggestTagsFromRelatedWords(['izlaz'], null, tags)).toEqual([]);
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

describe('isRelevantTranslationMatch', () => {
  // Fixtures are real MyMemory API responses for sr|ru queries, captured
  // while investigating the "Bible quotes" noise task.
  const cleanWordMatch = {
    segment: 'spasenje',
    translation: 'спасение',
    match: 0.85,
  };
  const bibleVerseMatch1 = {
    segment: 'Jer videe oèi moje spasenje Tvoje,',
    translation: 'ибо видели очи мои спасение Твое,',
    match: 0.34,
  };
  const bibleVerseMatch2 = {
    segment: 'Primajuæi kraj svoje vere, spasenje duama.',
    translation: 'достигая наконец веры спасения душ.',
    match: 0.3,
  };
  const borderlineSentenceMatch = {
    segment: 'Budite joj prijatelj.',
    translation: 'будьте ей другом.',
    match: 0.56,
  };

  it('accepts a clean single-word match for single-word input', () => {
    expect(isRelevantTranslationMatch(cleanWordMatch, 1)).toBe(true);
  });

  it('rejects long, low-match sentence matches (the Bible-quote case)', () => {
    expect(isRelevantTranslationMatch(bibleVerseMatch1, 1)).toBe(false);
    expect(isRelevantTranslationMatch(bibleVerseMatch2, 1)).toBe(false);
  });

  it('rejects a short-ish sentence match for single-word input even with a decent match score', () => {
    // 3-word segment for a 1-word query — match score alone (0.56) isn't
    // enough; this is still a sentence, not a word/short-phrase match.
    expect(isRelevantTranslationMatch(borderlineSentenceMatch, 1)).toBe(false);
  });

  it('does not apply the segment-length cap for multi-word input', () => {
    expect(isRelevantTranslationMatch(borderlineSentenceMatch, 3)).toBe(true);
  });

  it('rejects a low match score regardless of segment length', () => {
    expect(isRelevantTranslationMatch({ segment: 'x', translation: 'y', match: 0.1 }, 1)).toBe(false);
  });

  it('treats a missing match score as unreliable', () => {
    expect(isRelevantTranslationMatch({ segment: 'x', translation: 'y' }, 1)).toBe(false);
  });
});

describe('isPlausibleRussianText', () => {
  it('accepts genuine Cyrillic Russian text', () => {
    expect(isPlausibleRussianText('грех')).toBe(true);
    expect(isPlausibleRussianText('спасибо, благодарю')).toBe(true);
  });

  it('rejects English text MyMemory sometimes returns despite the sr|ru langpair', () => {
    // Real bug: querying "greh" returned responseData.translatedText "sin"
    // (English) instead of "грех" (Russian) — see the "English translation
    // is suggested" bug report.
    expect(isPlausibleRussianText('sin')).toBe(false);
  });

  it('rejects empty/missing text', () => {
    expect(isPlausibleRussianText('')).toBe(false);
    expect(isPlausibleRussianText(undefined)).toBe(false);
  });
});
