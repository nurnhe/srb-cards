// @vitest-environment jsdom
//
// Runs the Wiktionary parsers against real pages saved earlier under
// src/__fixtures__/wiktionary/ (see that folder's README) — no network calls,
// so this can't flake and doesn't hammer Wiktionary. If Wiktionary changes its
// page markup, these are the tests most likely to catch it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  fetchWiktionaryDoc,
  serboCroatianSection,
  parseRelatedTerms,
  parsePartsOfSpeech,
  parseIpa,
  parseInflectionTables,
  fetchRelatedWordsFromWiktionary,
  fetchPartsOfSpeechFromWiktionary,
  fetchIpaFromWiktionary,
  fetchInflectionTables,
  clearWiktionaryCache,
  parseRuWiktionaryMeanings,
  fetchRuWiktionarySuggestions,
  firstTranslationSuggestion,
} from './wiktionary';

const FIXTURE_DIR = path.join(__dirname, '__fixtures__/wiktionary');
const fixtureHtml = (word) => fs.readFileSync(path.join(FIXTURE_DIR, `${word}.html`), 'utf8');

function sectionFor(word) {
  const doc = new DOMParser().parseFromString(fixtureHtml(word), 'text/html');
  return serboCroatianSection(doc);
}

let originalFetch;
beforeEach(() => {
  clearWiktionaryCache();
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('parseRelatedTerms (fixtures)', () => {
  it('finds derived/related terms, cleaned of pitch-accent marks', () => {
    const terms = parseRelatedTerms(sectionFor('raditi'));
    expect(terms).toEqual(expect.arrayContaining(['doraditi', 'uraditi', 'obraditi']));
    expect(terms.some((t) => /[a-z]́|̏|̀/i.test(t))).toBe(false);
  });

  it('returns null for a word with no related-terms section', () => {
    expect(parseRelatedTerms(sectionFor('ponositi'))).toBeNull();
  });
});

describe('parsePartsOfSpeech (fixtures)', () => {
  it('reads a verb as glagol', () => {
    expect(parsePartsOfSpeech(sectionFor('raditi'))).toEqual(['glagol']);
  });
  it('reads a noun as imenica', () => {
    expect(parsePartsOfSpeech(sectionFor('ponos'))).toEqual(['imenica']);
    expect(parsePartsOfSpeech(sectionFor('izlaz'))).toEqual(['imenica']);
  });
  it('reads a reflexive verb (ponositi / гордиться) as glagol', () => {
    expect(parsePartsOfSpeech(sectionFor('ponositi'))).toEqual(['glagol']);
  });
  it('reads an adjective as pridev', () => {
    expect(parsePartsOfSpeech(sectionFor('lep'))).toEqual(['pridev']);
  });
});

describe('parseIpa (fixtures)', () => {
  it('reads the pronunciation for each saved word', () => {
    expect(parseIpa(sectionFor('raditi'))).toBe('/rǎːditi/');
    expect(parseIpa(sectionFor('ponos'))).toBe('/pǒnos/');
    expect(parseIpa(sectionFor('izlaz'))).toBe('/îzlaːz/');
    expect(parseIpa(sectionFor('lep'))).toBe('/lêːp/');
  });
});

describe('parseInflectionTables (fixtures)', () => {
  it('reads a verb conjugation table with rows and headers', () => {
    const [table] = parseInflectionTables(sectionFor('raditi'));
    expect(table.caption).toBe('Conjugation of raditi');
    expect(table.rows.length).toBeGreaterThan(5);
    expect(table.rows.some((r) => r.cells.some((c) => c.isHeader))).toBe(true);
  });

  it('reads a noun declension table', () => {
    const [table] = parseInflectionTables(sectionFor('ponos'));
    expect(table.caption).toBe('Declension of ponos');
  });

  it('reads all four tables of a word with several forms (lep)', () => {
    const tables = parseInflectionTables(sectionFor('lep'));
    expect(tables).toHaveLength(4);
    expect(tables.map((t) => t.caption)).toEqual([
      'positive indefinite forms',
      'positive definite forms',
      'comparative forms',
      'superlative forms',
    ]);
  });
});

describe('the four lookups share one request per title', () => {
  function mockFetchCounting(word) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => fixtureHtml(word) };
    };
    return () => calls;
  }

  it('fetching the same word from all four lookups makes exactly one network request', async () => {
    const calls = mockFetchCounting('raditi');
    await fetchRelatedWordsFromWiktionary('raditi');
    await fetchPartsOfSpeechFromWiktionary('raditi');
    await fetchIpaFromWiktionary('raditi');
    await fetchInflectionTables('raditi');
    expect(calls()).toBe(1);
  });

  it('matches the pre-refactor results exactly for every saved word', async () => {
    for (const word of ['raditi', 'ponos', 'ponositi', 'izlaz', 'lep']) {
      clearWiktionaryCache();
      mockFetchCounting(word);
      expect(await fetchRelatedWordsFromWiktionary(word)).toEqual(parseRelatedTerms(sectionFor(word)) ?? null);
      expect(await fetchPartsOfSpeechFromWiktionary(word)).toEqual(parsePartsOfSpeech(sectionFor(word)));
      expect(await fetchIpaFromWiktionary(word)).toBe(parseIpa(sectionFor(word)));
      expect(await fetchInflectionTables(word)).toEqual(parseInflectionTables(sectionFor(word)));
    }
  });

  it('a 404 is treated as "not found", not cached as an error, and never parsed', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: false, status: 404, text: async () => '' };
    };
    expect(await fetchRelatedWordsFromWiktionary('nonexistentword')).toBeNull();
    expect(await fetchPartsOfSpeechFromWiktionary('nonexistentword')).toEqual([]);
    expect(await fetchIpaFromWiktionary('nonexistentword')).toBeNull();
    expect(await fetchInflectionTables('nonexistentword')).toBeNull();
    // All four asked about the same title, and a 404 is remembered as
    // "doesn't exist" rather than retried — so this is one request, not four.
    expect(calls).toBe(1);
  });

  it('a real failure (5xx) is not cached — a retry tries the network again', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 500, text: async () => '' };
      return { ok: true, status: 200, text: async () => fixtureHtml('raditi') };
    };
    await expect(fetchPartsOfSpeechFromWiktionary('raditi')).rejects.toThrow();
    expect(await fetchPartsOfSpeechFromWiktionary('raditi')).toEqual(['glagol']);
    expect(calls).toBe(2);
  });

  it('two lookups started at the same time for the same word still only fetch once', async () => {
    const calls = mockFetchCounting('raditi');
    const [related, pos] = await Promise.all([
      fetchRelatedWordsFromWiktionary('raditi'),
      fetchPartsOfSpeechFromWiktionary('raditi'),
    ]);
    expect(calls()).toBe(1);
    expect(related).toEqual(expect.arrayContaining(['doraditi']));
    expect(pos).toEqual(['glagol']);
  });
});

// ---- Russian Wiktionary ---------------------------------------------------
// Real pages saved under src/__fixtures__/ruwiktionary/ (see that folder's
// README), each one entry of the MediaWiki API's `query.pages`.

const RU_FIXTURE_DIR = path.join(__dirname, '__fixtures__/ruwiktionary');
const ruPage = (name) => JSON.parse(fs.readFileSync(path.join(RU_FIXTURE_DIR, `${name}.json`), 'utf8'));
const ruMeanings = (name) => {
  const page = ruPage(name);
  return parseRuWiktionaryMeanings(page.revisions[0].slots.main.content, page.title);
};

describe('parseRuWiktionaryMeanings (fixtures)', () => {
  it('reads the meanings, without the label or the example', () => {
    expect(ruMeanings('jesti-cyrillic')).toEqual(['есть', 'кушать']);
  });

  it('reads a page titled in Latin', () => {
    expect(ruMeanings('jesti-latin')).toEqual(['есть', 'кушать']);
  });

  it('takes only the Serbian section and only its meanings, not synonyms or other languages', () => {
    const meanings = ruMeanings('lep');
    expect(meanings).toEqual(['красивый', 'милый', 'хорошенький']);
    // Kazakh meanings on the same page, and a Serbian synonym listed further down.
    expect(meanings).not.toEqual(expect.arrayContaining(['дуновение']));
    expect(meanings).not.toEqual(expect.arrayContaining(['красан']));
  });

  it('drops an example even when a template is nested inside it', () => {
    expect(ruMeanings('lepota')).toEqual(['красота']);
  });

  it('reads {{as ru}} as "the same word as in Russian"', () => {
    expect(ruMeanings('ruka')).toEqual(['рука']);
  });

  it('finds nothing on a page without a Serbian section', () => {
    expect(ruMeanings('uciti')).toEqual([]);
  });
});

describe('parseRuWiktionaryMeanings (edge cases)', () => {
  const page = [
    '= {{-hr-}} =',
    '==== Значение ====',
    '# [[хлеб]]',
    '= {{-sr-}} =',
    '=== Семантические свойства ===',
    '==== Значение ====',
    '# {{помета.|sr}} [[дом]] (жилое здание), [[домашний очаг|очаг]] {{пример|Ово је кућа|перевод=Это дом, он {{выдел|большой}}}}',
    '# [[ме́сто]]; [[участок]]<ref>источник</ref>',
    '# действие по значению глагола строить',
    '#: Пример, который не значение',
    '# ',
    '==== Синонимы ====',
    '# [[зграда]]',
    '= {{-ru-|nocat}} =',
    '==== Значение ====',
    '# [[что-то русское]]',
  ].join('\n');

  it('cleans links, brackets, stress marks and references, and skips long descriptions', () => {
    expect(parseRuWiktionaryMeanings(page, 'кућа')).toEqual(['дом', 'очаг', 'место', 'участок']);
  });

  it('turns {{as ru}} on a Latin-titled page into the Cyrillic word', () => {
    expect(parseRuWiktionaryMeanings('= {{-sr-}} =\n==== Значение ====\n# {{as ru}}', 'ruka')).toEqual(['рука']);
  });

  it('copes with an empty page', () => {
    expect(parseRuWiktionaryMeanings(undefined, 'x')).toEqual([]);
  });
});

describe('fetchRuWiktionarySuggestions', () => {
  function answerWith(pages) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: new URL(url), init });
      return { ok: true, status: 200, json: async () => ({ query: { pages } }) };
    };
    return calls;
  }

  it('asks for both spellings in one request, with no extra headers', async () => {
    const calls = answerWith([ruPage('jesti-cyrillic'), ruPage('jesti-latin')]);
    const result = await fetchRuWiktionarySuggestions('Jesti ');
    expect(calls).toHaveLength(1);
    expect(calls[0].url.host).toBe('ru.wiktionary.org');
    expect(calls[0].url.searchParams.get('titles')).toBe('јести|jesti');
    expect(calls[0].url.searchParams.get('origin')).toBe('*');
    expect(calls[0].init).toBeUndefined();
    // Both pages say the same thing; the Cyrillic one is the one linked to.
    expect(result).toEqual({ suggestions: ['есть', 'кушать'], title: 'јести' });
  });

  it('works the same when the word is typed in Cyrillic', async () => {
    const calls = answerWith([ruPage('lep'), { title: 'lep', missing: true }]);
    expect(await fetchRuWiktionarySuggestions('леп')).toEqual({
      suggestions: ['красивый', 'милый', 'хорошенький'],
      title: 'леп',
    });
    expect(calls[0].url.searchParams.get('titles')).toBe('леп|lep');
  });

  it('answers "nothing" when no page has a Serbian section, and remembers it', async () => {
    const calls = answerWith([ruPage('uciti'), { title: 'učiti', missing: true }]);
    expect(await fetchRuWiktionarySuggestions('učiti')).toEqual({ suggestions: [], title: null });
    expect(await fetchRuWiktionarySuggestions('učiti')).toEqual({ suggestions: [], title: null });
    expect(calls).toHaveLength(1);
  });

  it('fails on a server error, and does not remember the failure', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ query: { pages: [ruPage('ruka')] } }) };
    };
    await expect(fetchRuWiktionarySuggestions('ruka')).rejects.toThrow();
    expect(await fetchRuWiktionarySuggestions('ruka')).toEqual({ suggestions: ['рука'], title: 'рука' });
    expect(calls).toBe(2);
  });

  it('does not ask at all for an empty word', async () => {
    const calls = answerWith([]);
    expect(await fetchRuWiktionarySuggestions('  ')).toEqual({ suggestions: [], title: null });
    expect(calls).toHaveLength(0);
  });
});

describe('firstTranslationSuggestion (pre-fill for related words)', () => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const failed = { ok: false, status: 503, json: async () => ({}) };
  const myMemorySays = (text) => ok({ responseData: { translatedText: text }, matches: [] });
  const wiktionarySays = ok({ query: { pages: [ruPage('lep')] } });

  // Answers MyMemory and Russian Wiktionary separately, and records who was asked.
  function answer({ myMemory, wiktionary }) {
    const asked = [];
    globalThis.fetch = async (url) => {
      const { host } = new URL(url);
      asked.push(host);
      if (host === 'api.mymemory.translated.net') return myMemory;
      if (host === 'ru.wiktionary.org') return wiktionary;
      throw new Error(`unexpected request to ${host}`);
    };
    return asked;
  }

  it("uses MyMemory's first suggestion and doesn't ask Wiktionary", async () => {
    const asked = answer({ myMemory: myMemorySays('прекрасный'), wiktionary: wiktionarySays });
    expect(await firstTranslationSuggestion('lep')).toBe('прекрасный');
    expect(asked).toEqual(['api.mymemory.translated.net']);
  });

  it('falls back to Wiktionary when MyMemory has nothing usable', async () => {
    // MyMemory sometimes answers in English; that is filtered out, leaving nothing.
    answer({ myMemory: myMemorySays('beautiful'), wiktionary: wiktionarySays });
    expect(await firstTranslationSuggestion('lep')).toBe('красивый');
  });

  it('falls back to Wiktionary when MyMemory fails', async () => {
    answer({ myMemory: failed, wiktionary: wiktionarySays });
    expect(await firstTranslationSuggestion('lep')).toBe('красивый');
  });

  it('gives an empty string, without failing, when neither source has anything', async () => {
    answer({ myMemory: failed, wiktionary: failed });
    await expect(firstTranslationSuggestion('lep')).resolves.toBe('');
    clearWiktionaryCache();
    answer({ myMemory: myMemorySays(''), wiktionary: ok({ query: { pages: [ruPage('uciti')] } }) });
    expect(await firstTranslationSuggestion('učiti')).toBe('');
  });
});
