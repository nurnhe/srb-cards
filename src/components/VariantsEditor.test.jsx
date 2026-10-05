// @vitest-environment jsdom
//
// The "Предложи" part of VariantsEditor, rendered for real in a simulated
// browser (jsdom) with React's own tools — no extra testing library needed.
// Both suggestion sources are answered by a fake `fetch`, so nothing goes to
// the network.
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VariantsEditor } from './VariantsEditor';
import { clearWiktionaryCache } from '../wiktionary';

// Tells React this is a test, so `act` waits for its updates.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---- Fake answers from the two sources --------------------------------------

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const failed = { ok: false, status: 503, json: async () => ({}) };

// MyMemory: the first text is its main answer, the rest come as extra matches.
const myMemorySays = (...texts) =>
  ok({
    responseData: { translatedText: texts[0] || '' },
    matches: texts.slice(1).map((t) => ({ translation: t, segment: 'lep', match: 1 })),
  });

// Russian Wiktionary: one page with a Serbian section listing these meanings.
const wiktionarySays = (title, ...meanings) =>
  ok({
    query: {
      pages: [
        {
          title,
          revisions: [
            { slots: { main: { content: `= {{-sr-}} =\n==== Значение ====\n# ${meanings.map((m) => `[[${m}]]`).join(', ')}` } } },
          ],
        },
      ],
    },
  });
const wiktionaryHasNothing = ok({ query: { pages: [{ title: 'xqzw', missing: true }] } });

let asked;
function answer({ myMemory, wiktionary }) {
  asked = [];
  globalThis.fetch = async (url) => {
    const { host } = new URL(url);
    asked.push(host);
    if (host === 'api.mymemory.translated.net') return typeof myMemory === 'function' ? myMemory() : myMemory;
    if (host === 'ru.wiktionary.org') return wiktionary;
    throw new Error(`unexpected request to ${host}`);
  };
}

// ---- Rendering the component --------------------------------------------------

let container;
let root;
let onChangeCalls;

// Holds the chosen translations itself, like the Add Word form does.
function Harness({ srWord, initialVariants }) {
  const [variants, setVariants] = useState(initialVariants);
  return (
    <VariantsEditor
      variants={variants}
      srWord={srWord}
      onChange={(next) => {
        onChangeCalls.push(next);
        setVariants(next);
      }}
    />
  );
}

async function render(srWord, initialVariants = []) {
  await act(async () => root.render(<Harness srWord={srWord} initialVariants={initialVariants} />));
}

// Lets every pending request and React update finish.
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function clickSuggest() {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Предложи'));
  await act(async () => button.click());
  await settle();
}

const wikiLink = () => container.querySelector('a[href^="https://ru.wiktionary.org/"]');
const chipButtons = () => [...container.querySelectorAll('button')].filter((b) => b.textContent.startsWith('+ '));
const chipText = (b) => b.textContent.slice(2);
const wikiChips = () => (wikiLink() ? [...wikiLink().parentElement.querySelectorAll('button')].map(chipText) : []);
const myMemoryChips = () => chipButtons().map(chipText).filter((t) => !wikiChips().includes(t));
const text = () => container.textContent;

beforeEach(() => {
  clearWiktionaryCache();
  onChangeCalls = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

let originalFetch = globalThis.fetch;
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

// ---- Tests ------------------------------------------------------------------------

describe('VariantsEditor — "Предложи"', () => {
  it('asks both sources and shows MyMemory first, then Wiktionary in its own "WIKI" row', async () => {
    answer({ myMemory: myMemorySays('красивый', 'прекрасный'), wiktionary: wiktionarySays('леп', 'красивый', 'милый') });
    await render('lep');
    await clickSuggest();

    expect(asked.sort()).toEqual(['api.mymemory.translated.net', 'ru.wiktionary.org']);
    expect(myMemoryChips()).toEqual(['красивый', 'прекрасный']);
    // "красивый" is already offered by MyMemory, so the Wiktionary row doesn't repeat it.
    expect(wikiChips()).toEqual(['милый']);
    // The MyMemory row comes before the Wiktionary row.
    const firstMyMemoryChip = chipButtons().find((b) => chipText(b) === 'прекрасный');
    expect(firstMyMemoryChip.compareDocumentPosition(wikiLink()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('labels the Wiktionary row "WIKI" and links it to the article the meanings came from', async () => {
    answer({ myMemory: myMemorySays(''), wiktionary: wiktionarySays('леп', 'милый') });
    await render('lep');
    await clickSuggest();

    expect(wikiLink().textContent).toBe('WIKI');
    expect(wikiLink().getAttribute('href')).toBe(`https://ru.wiktionary.org/wiki/${encodeURIComponent('леп')}`);
    expect(wikiLink().getAttribute('target')).toBe('_blank');
  });

  it('shows only the Wiktionary row when MyMemory has nothing', async () => {
    // MyMemory sometimes answers in English; that is filtered out, leaving nothing.
    answer({ myMemory: myMemorySays('beautiful'), wiktionary: wiktionarySays('леп', 'красивый') });
    await render('lep');
    await clickSuggest();

    expect(myMemoryChips()).toEqual([]);
    expect(wikiChips()).toEqual(['красивый']);
    expect(text()).not.toContain('Ништа ново није пронађено');
  });

  it('shows MyMemory as before when Wiktionary has nothing or fails — no "WIKI" row, no error', async () => {
    answer({ myMemory: myMemorySays('красивый'), wiktionary: wiktionaryHasNothing });
    await render('lep');
    await clickSuggest();
    expect(myMemoryChips()).toEqual(['красивый']);
    expect(wikiLink()).toBeNull();

    clearWiktionaryCache();
    answer({ myMemory: myMemorySays('красивый'), wiktionary: failed });
    await clickSuggest();
    expect(myMemoryChips()).toEqual(['красивый']);
    expect(wikiLink()).toBeNull();
    expect(text()).not.toContain('Претрага тренутно није доступна');
  });

  it('says nothing new was found when neither source has anything', async () => {
    answer({ myMemory: myMemorySays(''), wiktionary: wiktionaryHasNothing });
    await render('xqzw');
    await clickSuggest();

    expect(chipButtons()).toEqual([]);
    expect(text()).toContain('Ништа ново није пронађено');
  });

  it('says search is unavailable only when both sources fail', async () => {
    answer({ myMemory: failed, wiktionary: failed });
    await render('lep');
    await clickSuggest();

    expect(chipButtons()).toEqual([]);
    expect(text()).toContain('Претрага тренутно није доступна');
  });

  it("doesn't suggest a translation that is already chosen", async () => {
    answer({ myMemory: myMemorySays('красивый'), wiktionary: wiktionarySays('леп', 'красивый', 'милый') });
    await render('lep', ['милый']);
    await clickSuggest();

    expect(myMemoryChips()).toEqual(['красивый']);
    expect(wikiChips()).toEqual([]);
  });

  it('clicking a suggestion adds it and takes it off the list', async () => {
    answer({ myMemory: myMemorySays('красивый'), wiktionary: wiktionarySays('леп', 'милый') });
    await render('lep');
    await clickSuggest();

    const chip = chipButtons().find((b) => chipText(b) === 'милый');
    await act(async () => chip.click());

    expect(onChangeCalls.at(-1)).toEqual(['милый']);
    expect(wikiChips()).toEqual([]);
    expect(myMemoryChips()).toEqual(['красивый']);
  });

  it('ignores a late answer for a word that has since been changed', async () => {
    let answerMyMemory;
    answer({
      myMemory: () => new Promise((resolve) => (answerMyMemory = () => resolve(myMemorySays('красивый')))),
      wiktionary: wiktionarySays('леп', 'милый'),
    });
    await render('lep');
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Предложи'));
    await act(async () => button.click());

    // The Serbian word is changed before the answers for "lep" arrive.
    await render('pas');
    answerMyMemory();
    await settle();

    expect(chipButtons()).toEqual([]);
    expect(wikiLink()).toBeNull();
  });
});
