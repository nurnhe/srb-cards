// Lookups against outside websites (Wiktionary, MyMemory, Tatoeba, Glosbe) and
// the browser's speech voices. Everything here is best-effort: a word that isn't
// found is an expected result, not a bug. Moved out of App.jsx unchanged.

import {
  isRelevantTranslationMatch,
  isPlausibleRussianText,
  stripPitchAccent,
  isCyrillic,
  cyrillicToLatin,
  posTagNamesFromHeadingIds,
} from './logic';

// Best-effort lookup of a plain Serbian example sentence from the free
// Tatoeba sentence corpus (no translation required — just usage in context).
async function fetchExampleFromTatoeba(srWord) {
  const url = `https://tatoeba.org/eng/api_v0/search?from=srp&query=${encodeURIComponent(srWord)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('tatoeba request failed');
  const json = await res.json();
  const results = json.results || [];
  const withText = results.find((r) => r.text);
  return withText ? withText.text : null;
}

// Fallback source: Glosbe's translation-memory endpoint, which pulls from
// parallel corpora and often has broader (if messier) Serbian coverage than
// Tatoeba. This is an unofficial/undocumented endpoint, so it's wrapped
// defensively — if it changes or gets blocked, we just fall through.
async function fetchExampleFromGlosbe(srWord) {
  const url = `https://glosbe.com/gapi/tm?from=srp&dest=eng&format=json&pretty=true&phrase=${encodeURIComponent(
    srWord
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('glosbe request failed');
  const json = await res.json();
  const tm = json.tm || [];
  const withText = tm.find((t) => t.phrase && t.phrase.trim());
  return withText ? withText.phrase.trim() : null;
}

// Tries Tatoeba first, then Glosbe as a fallback. Returns null if neither
// source has anything — that's expected fairly often for Serbian.
export async function fetchExample(srWord) {
  try {
    const fromTatoeba = await fetchExampleFromTatoeba(srWord);
    if (fromTatoeba) return fromTatoeba;
  } catch (e) {
    // fall through to the next source
  }
  try {
    const fromGlosbe = await fetchExampleFromGlosbe(srWord);
    if (fromGlosbe) return fromGlosbe;
  } catch (e) {
    // both sources failed or found nothing
  }
  return null;
}

// Best-effort lookup of related/derived words from English Wiktionary —
// Serbian is filed there under the merged "Serbo-Croatian" (sh) language
// section. CORS-enabled, no backend needed. Returns null if the word
// isn't found there at all, or has no Serbo-Croatian section, or has no
// related/derived terms listed — all expected fairly often, not a bug.
export async function fetchRelatedWordsFromWiktionary(srWord) {
  const url = `https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(srWord)}`;
  const res = await fetch(url);
  // A 404 genuinely means "no such page" — treated as not-found by callers.
  // Anything else non-ok (429 rate-limited, a 5xx blip) is a different
  // situation and should surface as an error state ("try again"), not get
  // shown identically to "nothing exists for this word".
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wiktionary request failed (${res.status})`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const heading = doc.getElementById('Serbo-Croatian');
  const section = heading?.closest('section');
  if (!section) return null;

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

// Best-effort lookup of a word's part(s) of speech from English Wiktionary:
// the headings (Verb, Noun, Adjective...) inside the Serbo-Croatian section,
// returned as Serbian tag names — see posTagNamesFromHeadingIds. Returns []
// when the word has no page or no recognisable heading (expected fairly often,
// not a bug) and throws on a real failure (429, 5xx, network) so callers can
// tell "not there" from "try again later". Cyrillic spellings are looked up in
// Latin, and a reflexive "…ti se" falls back to the plain verb's page.
export async function fetchPartsOfSpeechFromWiktionary(srWord) {
  const clean = stripPitchAccent(String(srWord).trim());
  const latin = isCyrillic(clean) ? cyrillicToLatin(clean) : clean;
  const titles = [latin];
  if (/\s+se$/i.test(latin)) titles.push(latin.replace(/\s+se$/i, ''));

  for (const title of titles) {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(title)}`);
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Wiktionary request failed (${res.status})`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const section = doc.getElementById('Serbo-Croatian')?.closest('section');
    if (!section) continue;
    const names = posTagNamesFromHeadingIds(Array.from(section.querySelectorAll('h3, h4, h5')).map((h) => h.id));
    if (names.length > 0) return names;
  }
  return [];
}

// Best-effort IPA pronunciation lookup, reusing the same Wiktionary REST
// endpoint/section as the related-words lookup above (a separate request,
// though, since this one fires opportunistically off the pronounce button
// rather than requiring a user to click "Прикажи повезане речи" first).
// Grabs the first IPA span in the Serbo-Croatian section rather than
// trying to disambiguate multiple etymologies — good enough for a
// best-effort hint, not meant to be exhaustive.
export async function fetchIpaFromWiktionary(srWord) {
  const url = `https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(srWord)}`;
  const res = await fetch(url);
  // A 404 genuinely means "no such page" — treated as not-found by callers.
  // Anything else non-ok (429 rate-limited, a 5xx blip) is a different
  // situation and should surface as an error state ("try again"), not get
  // shown identically to "nothing exists for this word".
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wiktionary request failed (${res.status})`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const heading = doc.getElementById('Serbo-Croatian');
  const section = heading?.closest('section');
  if (!section) return null;
  const ipaEl = section.querySelector('.IPA');
  const text = ipaEl?.textContent?.trim();
  return text || null;
}

// Best-effort declension (nouns/adjectives) or conjugation (verbs) table
// lookup — reuses the same Wiktionary REST endpoint/section as the other
// lookups above. Each cell prefers its <a title="..."> (clean spelling,
// same trick used for related words) and falls back to stripPitchAccent
// on the visible text otherwise — needed for cells that link back to the
// headword itself (no title on a self-link) and any cell with no link at
// all (e.g. an em dash for a form that doesn't exist). A word can have
// more than one table (multiple etymologies/senses each with their own),
// so this returns all of them rather than just the first.
export async function fetchInflectionTables(srWord) {
  const url = `https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(srWord)}`;
  const res = await fetch(url);
  // A 404 genuinely means "no such page" — treated as not-found by callers.
  // Anything else non-ok (429 rate-limited, a 5xx blip) is a different
  // situation and should surface as an error state ("try again"), not get
  // shown identically to "nothing exists for this word".
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Wiktionary request failed (${res.status})`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const heading = doc.getElementById('Serbo-Croatian');
  const section = heading?.closest('section');
  if (!section) return null;

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
