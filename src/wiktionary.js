// Lookups against outside websites (Wiktionary, MyMemory, Tatoeba) and
// the browser's speech voices. Everything here is best-effort: a word that isn't
// found is an expected result, not a bug. Moved out of App.jsx unchanged.

import {
  isRelevantTranslationMatch,
  isPlausibleRussianText,
  stripPitchAccent,
  isCyrillic,
  cyrillicToLatin,
  latinToCyrillic,
  posTagNamesFromHeadingIds,
} from './logic';

// Best-effort lookup of a plain Serbian example sentence from the free
// Tatoeba sentence corpus (no translation required — just usage in context).
// Uses Tatoeba's newer API host, which allows requests from a browser; the
// older tatoeba.org/eng/api_v0 address redirects without the permission
// header browsers require, so it was silently blocked. Returns null if
// nothing is found — that's expected fairly often for Serbian.
export async function fetchExample(srWord) {
  try {
    const url = `https://api.tatoeba.org/unstable/sentences?lang=srp&q=${encodeURIComponent(
      srWord
    )}&sort=relevance&limit=5`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const withText = (json.data || []).find((r) => r.text && r.text.trim());
    return withText ? withText.text.trim() : null;
  } catch (e) {
    return null;
  }
}

// ---- Reading Wiktionary pages --------------------------------------------
//
// Four lookups (related words, part of speech, IPA, declension/conjugation
// tables) all read the same page, so the page is fetched once and shared: the
// first request for a title is kept for the rest of the session and any other
// lookup of the same title reuses it. A failed request (429, 5xx, network) is
// not kept, so trying again really tries again. A 404 ("no such page") is
// kept — asking again would only get the same answer.

const pageCache = new Map();
const PAGE_CACHE_LIMIT = 30;
// Same idea for Russian Wiktionary lookups (fetchRuWiktionarySuggestions below).
const ruWiktionaryCache = new Map();

export function clearWiktionaryCache() {
  pageCache.clear();
  ruWiktionaryCache.clear();
}

// Resolves to the parsed page, or null when the page doesn't exist. Rejects on
// any other failure, so callers can tell "not there" from "try again later".
export function fetchWiktionaryDoc(title) {
  const cached = pageCache.get(title);
  if (cached) return cached;

  const request = (async () => {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(title)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Wiktionary request failed (${res.status})`);
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  })();

  pageCache.set(title, request);
  request.catch(() => {
    if (pageCache.get(title) === request) pageCache.delete(title);
  });
  if (pageCache.size > PAGE_CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value);
  return request;
}

// Serbian is filed on English Wiktionary under the merged "Serbo-Croatian"
// language section. Returns that section of a parsed page, or null when the
// page has none.
export function serboCroatianSection(doc) {
  return doc?.getElementById('Serbo-Croatian')?.closest('section') || null;
}

async function loadSection(title) {
  const doc = await fetchWiktionaryDoc(title);
  return doc ? serboCroatianSection(doc) : null;
}

// The parsers below only read the section they are given (they never change
// it), because the same parsed page is shared between lookups.

// Related / derived terms. Returns null when the section lists none.
export function parseRelatedTerms(section) {
  const terms = [];
  const seen = new Set();
  // ids get a "_2", "_3" suffix etc. when a word has multiple
  // etymologies/senses, each with their own Related/Derived terms list
  section.querySelectorAll('[id^="Related_terms"], [id^="Derived_terms"]').forEach((h) => {
    const list = h.parentElement?.querySelector('ul');
    (list ? Array.from(list.querySelectorAll('li')) : []).forEach((li) => {
      // The link's `title` attribute holds the plain spelling (e.g.
      // "doraditi"); the visible text carries pitch-accent marks (e.g.
      // "doráditi") that aren't used in normal typing, and some entries
      // have a trailing aspect abbreviation (e.g. "pf") as a sibling
      // element that li.textContent would otherwise pick up too.
      li.querySelectorAll('a[title]').forEach((a) => {
        const text = a.getAttribute('title').trim();
        const key = text.toLowerCase();
        if (text && !seen.has(key)) {
          seen.add(key);
          terms.push(text);
        }
      });
    });
  });
  return terms.length > 0 ? terms : null;
}

// Part(s) of speech as Serbian tag names — see posTagNamesFromHeadingIds.
export function parsePartsOfSpeech(section) {
  return posTagNamesFromHeadingIds(Array.from(section.querySelectorAll('h3, h4, h5')).map((h) => h.id));
}

// The first IPA span in the section rather than trying to disambiguate
// multiple etymologies — good enough for a best-effort hint, not meant to be
// exhaustive.
export function parseIpa(section) {
  const text = section.querySelector('.IPA')?.textContent?.trim();
  return text || null;
}

// Declension (nouns/adjectives) or conjugation (verbs) tables. Each cell
// prefers its <a title="..."> (clean spelling, same trick used for related
// words) and falls back to stripPitchAccent on the visible text otherwise —
// needed for cells that link back to the headword itself (no title on a
// self-link) and any cell with no link at all (e.g. an em dash for a form that
// doesn't exist). A word can have more than one table (multiple
// etymologies/senses each with their own), so this returns all of them.
export function parseInflectionTables(section) {
  const cellText = (cell) => {
    const link = cell.querySelector('a[title]');
    if (link) return link.getAttribute('title').trim();
    // row labels like "pluperfect" carry a Wiktionary footnote-reference
    // <sup> (e.g. "pluperfect³") that reads as a typo without the actual
    // footnote text alongside it — drop it rather than show a stray digit
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('sup').forEach((sup) => sup.remove());
    const text = clone.textContent.replace(/\s+/g, ' ').trim();
    return text && text !== '—' ? stripPitchAccent(text) : text;
  };

  const tables = [];
  section.querySelectorAll('table.inflection-table').forEach((table) => {
    const caption = table.querySelector('caption')?.textContent?.trim() || '';
    const rows = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = Array.from(tr.children)
        .filter((cell) => !cell.classList.contains('separator') && !cell.classList.contains('blank-end-row'))
        .map((cell) => ({
          text: cellText(cell),
          isHeader: cell.tagName === 'TH',
          colSpan: cell.colSpan || 1,
          rowSpan: cell.rowSpan || 1,
        }));
      if (cells.length > 0) rows.push({ cells });
    });
    if (rows.length > 0) tables.push({ caption, rows });
  });
  return tables.length > 0 ? tables : null;
}

// ---- The lookups the app calls --------------------------------------------
// Best-effort: not finding a word is expected fairly often, not a bug. Each
// resolves to null (or [] for parts of speech) when there is nothing, and
// rejects on a real failure.

export async function fetchRelatedWordsFromWiktionary(srWord) {
  const section = await loadSection(srWord);
  return section ? parseRelatedTerms(section) : null;
}

// Cyrillic spellings are looked up in Latin, and a reflexive "…ti se" falls
// back to the plain verb's page.
export async function fetchPartsOfSpeechFromWiktionary(srWord) {
  const clean = stripPitchAccent(String(srWord).trim());
  const latin = isCyrillic(clean) ? cyrillicToLatin(clean) : clean;
  const titles = [latin];
  if (/\s+se$/i.test(latin)) titles.push(latin.replace(/\s+se$/i, ''));

  for (const title of titles) {
    const section = await loadSection(title);
    if (!section) continue;
    const names = parsePartsOfSpeech(section);
    if (names.length > 0) return names;
  }
  return [];
}

export async function fetchIpaFromWiktionary(srWord) {
  const section = await loadSection(srWord);
  return section ? parseIpa(section) : null;
}

export async function fetchInflectionTables(srWord) {
  const section = await loadSection(srWord);
  return section ? parseInflectionTables(section) : null;
}

// Best-effort translation suggestions (sr → ru) via the free, CORS-enabled
// MyMemory API. Returns a short list of distinct candidate translations —
// quality varies since it's crowdsourced/machine translation, so these are
// suggestions to review and pick from, not guaranteed-correct answers.
// Noisy matches (e.g. a Bible-translation sentence that happens to contain
// the queried word) are filtered out — see isRelevantTranslationMatch.
// Wrong-language results (MyMemory occasionally returns English despite
// the sr|ru langpair) are filtered out too — see isPlausibleRussianText.
export async function fetchTranslationSuggestions(srWord) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(srWord)}&langpair=sr|ru`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('mymemory request failed');
  const json = await res.json();
  const candidates = [];
  const seen = new Set();
  const add = (text) => {
    const t = text?.trim();
    if (!t || !isPlausibleRussianText(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(t);
  };
  const inputWordCount = srWord.trim().split(/\s+/).filter(Boolean).length;
  add(json.responseData?.translatedText);
  (json.matches || [])
    .filter((m) => isRelevantTranslationMatch(m, inputWordCount))
    .sort((a, b) => (b.match || 0) - (a.match || 0) || (b.quality || 0) - (a.quality || 0))
    .forEach((m) => add(m.translation));
  return candidates.slice(0, 5);
}

// ---- Russian Wiktionary: Serbian words with their meanings in Russian ------
//
// Second source of "Предложи" suggestions, shown after MyMemory's in a row
// labelled "WIKI". Russian Wiktionary has a Serbian section on many (not all)
// common words, and gives the meanings directly in Russian. Its text is
// CC BY-SA, which is why the row links to the article it came from. Only one
// word at a time, on request — never copy the dictionary in bulk.
//
// No Api-User-Agent header on purpose: a custom header makes the browser send
// an extra preflight request before every lookup (Wikimedia doesn't let it be
// remembered). Add one — without contact details — only if requests start
// being refused.

const MAX_RU_MEANINGS = 6;

// A level-1 language heading, e.g. "= {{-sr-}} =" or "= {{-ru-|nocat}} =".
const LANGUAGE_HEADING_RE = /^=(?!=)\s*\{\{-([^|}]+?)-(?:\|[^}]*)?\}\}\s*=\s*$/;

// Drops every {{template}}, including templates nested inside one another
// (examples often contain {{выдел|…}}).
function stripTemplates(text) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('{{', i)) {
      depth++;
      i++;
    } else if (depth > 0 && text.startsWith('}}', i)) {
      depth--;
      i++;
    } else if (depth === 0) {
      out += text[i];
    }
  }
  return out;
}

// The meaning lines ("# ...") under every "Значение" heading of the Serbian
// section, or [] when the page has no Serbian section.
function serbianMeaningLines(wikitext) {
  const lines = [];
  let inSerbian = false;
  let inMeanings = false;
  for (const line of (wikitext || '').split('\n')) {
    const language = line.match(LANGUAGE_HEADING_RE);
    if (language) {
      inSerbian = language[1] === 'sr';
      inMeanings = false;
    } else if (!inSerbian) {
      continue;
    } else if (/^=+/.test(line)) {
      inMeanings = /^=+\s*Значение\s*=+\s*$/.test(line);
    } else if (inMeanings && /^#+(?![:*])/.test(line)) {
      lines.push(line.replace(/^#+/, ''));
    }
  }
  return lines;
}

// Russian meanings of the Serbian word on one Russian Wiktionary page, cleaned
// up for use as translation suggestions. `title` is the page's title — needed
// for {{as ru}} ("same as the Russian word"), as on the page "рука".
export function parseRuWiktionaryMeanings(wikitext, title) {
  const meanings = [];
  const seen = new Set();
  const add = (text) => {
    const t = text.replace(/́/g, '').replace(/\s+/g, ' ').replace(/^[\s.:–—-]+|[\s.:–—-]+$/g, '');
    // Longer than a few words is a description of the meaning, not a translation.
    if (!t || t.split(' ').length > 4 || !isPlausibleRussianText(t)) return;
    // Only a joining word left over from removed brackets, e.g. "и".
    if (/^(и|или|а|но)$/i.test(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    meanings.push(t);
  };
  for (const line of serbianMeaningLines(wikitext)) {
    if (/\{\{\s*as ru\s*(\|[^}]*)?\}\}/.test(line) && title) {
      add(isCyrillic(title) ? title : latinToCyrillic(title));
    }
    const text = stripTemplates(
      line
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<ref[^>]*\/>/g, '')
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    )
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/'{2,}/g, '')
      .replace(/\([^)]*\)/g, '')
      // Sense numbers ("1 (влага) и 2 (…)") are left over once the brackets go.
      .replace(/(^|\s)\d+(?=\s|$)/g, ' ');
    text.split(/[,;]/).forEach(add);
  }
  return meanings.slice(0, MAX_RU_MEANINGS);
}

// Looks a word up in Russian Wiktionary, under both of its spellings (Serbian
// pages there are titled in Cyrillic or in Latin), in one request. Resolves to
// { suggestions, title } — title is the page the meanings came from, for the
// link — or { suggestions: [], title: null } when neither page has a Serbian
// section. Rejects when the request fails, so the caller can tell "nothing
// there" from "couldn't ask". Results are kept like Wiktionary pages above: a
// "nothing there" answer is remembered, a failure is not.
export function fetchRuWiktionarySuggestions(srWord) {
  const word = (srWord || '').trim().toLowerCase();
  if (!word) return Promise.resolve({ suggestions: [], title: null });
  const cached = ruWiktionaryCache.get(word);
  if (cached) return cached;

  const cyrillic = isCyrillic(word) ? word : latinToCyrillic(word);
  const latin = isCyrillic(word) ? cyrillicToLatin(word) : word;
  const titles = [...new Set([cyrillic, latin])];

  const request = (async () => {
    const params = new URLSearchParams({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      format: 'json',
      formatversion: '2',
      origin: '*',
      titles: titles.join('|'),
    });
    const res = await fetch(`https://ru.wiktionary.org/w/api.php?${params}`);
    if (!res.ok) throw new Error(`Russian Wiktionary request failed (${res.status})`);
    const json = await res.json();
    if (json.error) throw new Error(`Russian Wiktionary: ${json.error.code}`);

    // Cyrillic page first: it's the usual home of a Serbian entry.
    const pages = (json.query?.pages || [])
      .filter((p) => !p.missing)
      .sort((a, b) => Number(isCyrillic(b.title)) - Number(isCyrillic(a.title)));
    const suggestions = [];
    let title = null;
    for (const page of pages) {
      const found = parseRuWiktionaryMeanings(page.revisions?.[0]?.slots?.main?.content, page.title);
      for (const m of found) {
        if (!suggestions.some((s) => s.toLowerCase() === m.toLowerCase())) suggestions.push(m);
      }
      if (found.length > 0 && !title) title = page.title;
    }
    return { suggestions: suggestions.slice(0, MAX_RU_MEANINGS), title };
  })();

  ruWiktionaryCache.set(word, request);
  request.catch(() => {
    if (ruWiktionaryCache.get(word) === request) ruWiktionaryCache.delete(word);
  });
  if (ruWiktionaryCache.size > PAGE_CACHE_LIMIT) ruWiktionaryCache.delete(ruWiktionaryCache.keys().next().value);
  return request;
}

// The one translation pre-filled for a related word on the Add Word form:
// MyMemory's first suggestion, as before; Russian Wiktionary's only when
// MyMemory has nothing or fails. '' when neither has one — never rejects.
export async function firstTranslationSuggestion(srWord) {
  try {
    const [first] = await fetchTranslationSuggestions(srWord);
    if (first) return first;
  } catch (e) {
    // fall through to Wiktionary
  }
  try {
    const { suggestions } = await fetchRuWiktionarySuggestions(srWord);
    return suggestions[0] || '';
  } catch (e) {
    return '';
  }
}

// speechSynthesis.getVoices() often returns an empty list on the very
// first call — voices load asynchronously and fire a 'voiceschanged'
// event once ready. Waits for that (with a timeout fallback, since some
// browsers — notably older Safari — don't reliably fire it).
export function getVoicesAsync() {
  return new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, 500);
  });
}
