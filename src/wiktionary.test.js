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
