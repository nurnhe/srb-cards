// Pure, framework-free logic used by App.jsx — kept in its own module (no
// React, no Supabase) so it can be unit-tested in isolation.

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
