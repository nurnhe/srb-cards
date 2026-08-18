// Pure, framework-free logic used by App.jsx — kept in its own module (no
// React, no Supabase) so it can be unit-tested in isolation.

// Decides whether a MyMemory translation-memory match is worth showing as
// a suggestion, vs. noise pulled in from an unrelated corpus (e.g. a Bible
// translation matching one word of a much longer verse). Two signals:
// - `match` (MyMemory's own 0-1 score for how well the matched segment
//   corresponds to the query) below 0.5 is treated as an unreliable hit.
// - For single-word input, a segment longer than 2 words is almost never
//   a direct word/short-phrase translation — it's a sentence that happens
//   to contain the word somewhere in it.
export function isRelevantTranslationMatch(match, inputWordCount) {
  const score = match?.match ?? 0;
  if (score < 0.5) return false;
  if (inputWordCount === 1) {
    const segmentWordCount = (match?.segment || '').trim().split(/\s+/).filter(Boolean).length;
    if (segmentWordCount > 2) return false;
  }
  return true;
}

// MyMemory occasionally returns text in the wrong language despite the
// sr|ru langpair being requested (e.g. the English "sin" instead of the
// Russian "грех" for the query "greh"). Genuine Russian text is always
// Cyrillic, so this catches that without needing real language detection.
export function isPlausibleRussianText(text) {
  return isCyrillic(text || '');
}

// ---- Serbian Cyrillic ↔ Latin transliteration ----
// Serbian has a well-defined 1:1 letter correspondence between scripts
// (a few multi-letter Latin digraphs: nj/lj/dž ↔ њ/љ/џ). This covers the
// vast majority of vocabulary correctly; a handful of morpheme-boundary
// edge cases (e.g. "nadživeti") aren't disambiguated, which is an accepted
// trade-off for a personal vocab app.
export const CYR_TO_LAT = [
  ['А', 'A'], ['Б', 'B'], ['В', 'V'], ['Г', 'G'], ['Д', 'D'], ['Ђ', 'Đ'],
  ['Е', 'E'], ['Ж', 'Ž'], ['З', 'Z'], ['И', 'I'], ['Ј', 'J'], ['К', 'K'],
  ['Л', 'L'], ['Љ', 'Lj'], ['М', 'M'], ['Н', 'N'], ['Њ', 'Nj'], ['О', 'O'],
  ['П', 'P'], ['Р', 'R'], ['С', 'S'], ['Т', 'T'], ['Ћ', 'Ć'], ['У', 'U'],
  ['Ф', 'F'], ['Х', 'H'], ['Ц', 'C'], ['Ч', 'Č'], ['Џ', 'Dž'], ['Ш', 'Š'],
];

const DIGRAPH_UPPER = { Lj: 'LJ', Nj: 'NJ', Dž: 'DŽ' };

export function cyrillicToLatin(str) {
  if (!str) return str;
  const isAllUpper = str === str.toUpperCase() && str !== str.toLowerCase();
  let out = '';
  for (const ch of str) {
    const upper = ch.toUpperCase();
    const isUpper = ch === upper && ch !== ch.toLowerCase();
    const pair = CYR_TO_LAT.find(([cyr]) => cyr === upper);
    if (!pair) {
      out += ch;
      continue;
    }
    let lat = pair[1];
    if (lat.length === 2) {
      if (isAllUpper) lat = DIGRAPH_UPPER[lat];
      else if (!isUpper) lat = lat.toLowerCase();
      // else: keep title-case ("Lj") for a standalone capital letter
    } else if (!isUpper) {
      lat = lat.toLowerCase();
    }
    out += lat;
  }
  return out;
}

// longest-match-first Latin sequences, each paired with its Cyrillic letter
export const LAT_TO_CYR = [
  ['Lj', 'Љ'], ['Nj', 'Њ'], ['Dž', 'Џ'],
  ['A', 'А'], ['B', 'Б'], ['V', 'В'], ['G', 'Г'], ['D', 'Д'], ['Đ', 'Ђ'],
  ['E', 'Е'], ['Ž', 'Ж'], ['Z', 'З'], ['I', 'И'], ['J', 'Ј'], ['K', 'К'],
  ['L', 'Л'], ['M', 'М'], ['N', 'Н'], ['O', 'О'], ['P', 'П'], ['R', 'Р'],
  ['S', 'С'], ['T', 'Т'], ['Ć', 'Ћ'], ['U', 'У'], ['F', 'Ф'], ['H', 'Х'],
  ['C', 'Ц'], ['Č', 'Ч'], ['Š', 'Ш'],
].sort((a, b) => b[0].length - a[0].length);

export function latinToCyrillic(str) {
  if (!str) return str;
  let out = '';
  let i = 0;
  while (i < str.length) {
    let matched = false;
    for (const [lat, cyr] of LAT_TO_CYR) {
      const slice = str.slice(i, i + lat.length);
      if (slice.length === lat.length && slice.toUpperCase() === lat.toUpperCase()) {
        const firstIsUpper = slice[0] === slice[0].toUpperCase() && slice[0] !== slice[0].toLowerCase();
        out += firstIsUpper ? cyr : cyr.toLowerCase();
        i += lat.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += str[i];
      i += 1;
    }
  }
  return out;
}

export function isCyrillic(str) {
  return /[Ѐ-ӿ]/.test(str);
}

// Given a Serbian word/phrase in either script, returns its counterpart in
// the other script (or null if there's nothing script-specific to convert).
export function otherScript(sr) {
  if (!sr || !sr.trim()) return null;
  return isCyrillic(sr) ? cyrillicToLatin(sr) : latinToCyrillic(sr);
}

export function normalize(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]/g, '');
}

// splits "answer1, answer2" into accepted alternatives
export function acceptedAnswers(str) {
  return str
    .split(',')
    .map((s) => normalize(s))
    .filter(Boolean);
}

export function parseVariants(str) {
  return (str || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Fisher–Yates shuffle
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Builds a shuffled deck of word ids where words with more wrong answers
// appear more often — lightweight stand-in for spaced repetition. A word
// with N wrong answers is entered (1 + min(N, 5)) times, so a struggling
// word shows up up to 6x more often than a clean one, without letting a
// single very-hard word swallow the whole deck.
export function buildWeightedDeck(pool) {
  const ids = [];
  pool.forEach((w) => {
    const weight = 1 + Math.min(w.wrong_count || 0, 5);
    for (let i = 0; i < weight; i++) ids.push(w.id);
  });
  const shuffled = shuffle(ids);
  // avoid two copies of the same word landing back-to-back
  for (let i = 1; i < shuffled.length; i++) {
    if (shuffled[i] === shuffled[i - 1]) {
      const swapIdx = shuffled.findIndex((id, j) => j > i && id !== shuffled[i]);
      if (swapIdx !== -1) [shuffled[i], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[i]];
    }
  }
  return shuffled;
}

// Re-inserts a just-missed word into the *remaining* current-cycle deck so
// it resurfaces again within the same session — not immediately (that's
// annoying and doesn't test retention), and not only at the next full
// cycle rebuild (too late to feel like a consequence of the mistake).
// Modeled on how Duolingo requeues a missed item a handful of questions
// later within the same lesson. The gap is randomized within a range and
// clamped to the deck's actual remaining length, so a miss near the end
// of a cycle just requeues near the end rather than overflowing.
export function requeueMissedWord(deck, wordId, { minGap = 3, maxGap = 7 } = {}) {
  // Nothing left in this cycle to insert "later" into — forcing it in here
  // would mean an immediate repeat. Let the next cycle's weighted rebuild
  // pick it up instead (wrong_count is already updated by then).
  if (deck.length === 0) return deck;
  const gap = minGap + Math.floor(Math.random() * (maxGap - minGap + 1));
  const insertAt = Math.min(gap, deck.length);
  const next = [...deck];
  next.splice(insertAt, 0, wordId);
  return next;
}

// Matches an entered sr word against existing words, accounting for both
// Cyrillic and Latin spellings (typing either script should still catch
// a duplicate stored in the other script). Returns the matching word, or
// null if there's no duplicate.
export function findDuplicateWord(sr, words) {
  const t = (sr || '').trim();
  if (!t) return null;
  const targets = [normalize(t), normalize(otherScript(t) || '')].filter(Boolean);
  return (
    (words || []).find((w) => {
      const existing = [normalize(w.sr), normalize(otherScript(w.sr) || '')].filter(Boolean);
      return existing.some((e) => targets.includes(e));
    }) || null
  );
}

// Suggests tags for a word being added, based on tags already applied to
// related words the user has picked to link (only words that already exist
// in the dictionary carry tags at this point — newly-added related words
// don't have any yet). Preserves first-seen order, dedupes, and skips
// tags already selected for the new word.
export function suggestTagsFromRelatedWords(relatedSrList, words, tags, excludeTagNames = []) {
  const excluded = new Set((excludeTagNames || []).map((n) => n.toLowerCase()));
  const tagNameById = Object.fromEntries((tags || []).map((t) => [t.id, t.name]));
  const seen = new Set();
  const suggestions = [];
  (relatedSrList || []).forEach((sr) => {
    const word = findDuplicateWord(sr, words);
    (word?.tagIds || []).forEach((tagId) => {
      const name = tagNameById[tagId];
      if (!name || excluded.has(name.toLowerCase()) || seen.has(name)) return;
      seen.add(name);
      suggestions.push(name);
    });
  });
  return suggestions;
}

// Filters words for the Words-list search box — matches if the query is a
// substring of the sr word (either script) or the ru translation text. An
// empty/whitespace query matches everything.
export function filterWordsByQuery(words, query) {
  const q = normalize(query || '');
  if (!q) return words || [];
  return (words || []).filter((w) => {
    const haystacks = [w.sr, otherScript(w.sr), w.ru].filter(Boolean).map(normalize);
    return haystacks.some((h) => h.includes(q));
  });
}

// Checks a typed practice answer against the current card, accepting either
// script for sr-direction answers and any saved translation variant for
// ru-direction answers.
export function isAnswerCorrect(direction, current, input) {
  if (direction === 'sr-ru') {
    return acceptedAnswers(current.ru).includes(normalize(input));
  }
  const alt = otherScript(current.sr);
  const targets = [current.sr, alt].filter(Boolean);
  return targets.some((t) => normalize(t) === normalize(input));
}
