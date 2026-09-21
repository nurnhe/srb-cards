// Moved out of App.jsx unchanged (part of the file split).

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Search, Check, Plus } from 'lucide-react';
import { FONT_MONO, FONT_DISPLAY, FONT_BODY } from './theme';
import { fetchPartsOfSpeechFromWiktionary, fetchTranslationSuggestions, fetchRelatedWordsFromWiktionary, fetchInflectionTables, fetchExample } from './wiktionary';
import { findDuplicateWord, findLikelyTypoOf, suggestTagsFromRelatedWords, otherScript } from './logic';
import { PronounceButton } from './components/PronounceButton';
import { IpaText } from './components/IpaText';
import { InflectionTables } from './components/InflectionTables';
import { VariantsEditor } from './components/VariantsEditor';
import { TagFilterPill } from './components/Pills';

/* ---------------- ADD WORD ---------------- */

export function AddWord({ onAdd, goToList, words, tags }) {
  const [sr, setSr] = useState('');
  const [ruVariants, setRuVariants] = useState([]);
  // Bumped on every successful submit so VariantsEditor below remounts with
  // fresh internal state — its own uncommitted draft text and suggestions
  // aren't part of `ruVariants`, so clearing that prop alone leaves them
  // sitting there looking like part of the next word.
  const [variantsResetKey, setVariantsResetKey] = useState(0);
  const [example, setExample] = useState('');
  const [justAdded, setJustAdded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [lookupState, setLookupState] = useState('idle'); // idle | loading | notfound | error
  const [relatedWords, setRelatedWords] = useState([]);
  const [relatedState, setRelatedState] = useState('idle'); // idle | loading | notfound | error
  const [inflectionTables, setInflectionTables] = useState(null);
  const [inflectionState, setInflectionState] = useState('idle'); // idle | loading | notfound | error
  // Related words the user has picked to also add to the dictionary —
  // { [word]: { ru: string, status: 'loading' | 'idle' } }
  const [relatedSelections, setRelatedSelections] = useState({});
  const [selectedTagNames, setSelectedTagNames] = useState([]);
  const [tagQuery, setTagQuery] = useState('');
  // Per-tag: which words (by sr, or '__main__' for the word being added)
  // are explicitly excluded from that specific tag — everything not in a
  // tag's set is included by default, so each tag applies to the whole
  // group (main word + related words) unless opted out, and different
  // tags can apply to different subsets. { [tagName]: Set<key> }
  const [tagExclusions, setTagExclusions] = useState({});
  const srRef = useRef(null);
  // Part-of-speech tags (glagol, imenica...) suggested from Wiktionary while
  // the word is being typed. `autoPosRef` mirrors the state for use inside the
  // async lookup; `dismissedPosRef` remembers tags the user clicked away so a
  // later lookup for the same word doesn't put them back.
  const [autoPosNames, setAutoPosNames] = useState([]);
  const autoPosRef = useRef([]);
  const dismissedPosRef = useRef(new Set());
  const posLookedUpForRef = useRef('');
  const selectedTagNamesRef = useRef([]);
  selectedTagNamesRef.current = selectedTagNames;
  // Lookups below are async and keyed to whatever `sr` was at the time they
  // started — this tracks the *current* value so a response that resolves
  // after the user has since changed the word can tell it's stale and back
  // off, instead of silently repopulating state for a word no longer shown.
  const srLiveRef = useRef('');
  // Guards the related-word translation-suggestion fetch the same way, but
  // per related word rather than per sr — see toggleRelatedSelection.
  const relatedFetchSeqRef = useRef({});

  const addTagName = (name) => {
    const clean = name.trim().toLowerCase();
    if (!clean || selectedTagNames.includes(clean)) return;
    setSelectedTagNames((prev) => [...prev, clean]);
    setTagExclusions((prev) => ({ ...prev, [clean]: new Set() }));
    setTagQuery('');
  };

  const removeTagName = (name) => {
    if (autoPosRef.current.includes(name)) {
      dismissedPosRef.current.add(name);
      autoPosRef.current = autoPosRef.current.filter((n) => n !== name);
      setAutoPosNames(autoPosRef.current);
    }
    setSelectedTagNames((prev) => prev.filter((t) => t !== name));
    setTagExclusions((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  // Suggests the word's part of speech as a tag shortly after the user stops
  // typing. Best-effort: a word Wiktionary doesn't know, or a failed lookup,
  // just means no suggestion. Tags added here can be clicked away like any
  // other, and are dropped again if the word is changed to one with a
  // different part of speech.
  useEffect(() => {
    const word = sr.trim();
    const dropQuietly = (name) => {
      setSelectedTagNames((prev) => prev.filter((t) => t !== name));
      setTagExclusions((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    };
    if (word.length < 2) {
      autoPosRef.current.forEach(dropQuietly);
      autoPosRef.current = [];
      setAutoPosNames([]);
      posLookedUpForRef.current = '';
      return undefined;
    }
    if (posLookedUpForRef.current === word) return undefined;
    const timer = setTimeout(async () => {
      if (srLiveRef.current !== word) return;
      let names;
      try {
        names = await fetchPartsOfSpeechFromWiktionary(word);
      } catch (err) {
        return;
      }
      if (srLiveRef.current !== word) return;
      if (posLookedUpForRef.current !== word) {
        dismissedPosRef.current = new Set();
        posLookedUpForRef.current = word;
      }
      const keep = autoPosRef.current.filter((n) => names.includes(n));
      autoPosRef.current.filter((n) => !names.includes(n)).forEach(dropQuietly);
      const added = [];
      for (const name of names) {
        if (dismissedPosRef.current.has(name)) continue;
        if (keep.includes(name)) continue;
        // Already picked by the user themselves — leave it as theirs.
        if (selectedTagNamesRef.current.includes(name)) continue;
        setSelectedTagNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
        setTagExclusions((prev) => ({ ...prev, [name]: prev[name] || new Set() }));
        added.push(name);
      }
      autoPosRef.current = [...keep, ...added];
      setAutoPosNames(autoPosRef.current);
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sr]);

  const toggleTagTarget = (tagName, key) => {
    setTagExclusions((prev) => {
      const set = new Set(prev[tagName]);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return { ...prev, [tagName]: set };
    });
  };

  // Matches an entered sr word against existing words, accounting for both
  // Cyrillic and Latin spellings (typing either script should still catch
  // a duplicate stored in the other script).
  const duplicate = findDuplicateWord(sr, words);
  // Softer signal than `duplicate` — a near-miss typo of an existing word,
  // not an exact match. Only checked when it's not already an exact
  // duplicate, and never blocks submission (this app's vocabulary is full
  // of real words no external dictionary would recognize, so this is a
  // "did you mean" nudge, not a validator).
  const likelyTypoOf = !duplicate ? findLikelyTypoOf(sr, words) : null;

  // Tags already on related words the user picked to link — a low-effort
  // signal for "this new word probably belongs to the same category",
  // without needing any new lookup or API.
  const suggestedTagNames = suggestTagsFromRelatedWords(
    Object.keys(relatedSelections),
    words,
    tags,
    selectedTagNames
  );

  const toggleRelatedSelection = async (word) => {
    // A word already in the dictionary doesn't need a translation lookup —
    // it already has one, and will just be linked rather than created.
    const existing = findDuplicateWord(word, words);
    let wasAlreadySelected = false;
    setRelatedSelections((prev) => {
      if (prev[word]) {
        wasAlreadySelected = true;
        const next = { ...prev };
        delete next[word];
        return next;
      }
      if (existing) {
        return { ...prev, [word]: { ru: existing.ru, status: 'idle', alreadyExists: true } };
      }
      return { ...prev, [word]: { ru: '', status: 'loading' } };
    });
    if (wasAlreadySelected) {
      // Deselecting no longer means anything for this word's per-tag
      // exclusions — drop it so it doesn't silently come back pre-excluded
      // if the same word is selected again later in the same session.
      setTagExclusions((prev) => {
        let changed = false;
        const next = {};
        for (const [tagName, set] of Object.entries(prev)) {
          if (set.has(word)) {
            changed = true;
            const copy = new Set(set);
            copy.delete(word);
            next[tagName] = copy;
          } else {
            next[tagName] = set;
          }
        }
        return changed ? next : prev;
      });
      return;
    }
    if (existing) return;
    const seq = (relatedFetchSeqRef.current[word] || 0) + 1;
    relatedFetchSeqRef.current[word] = seq;
    // Only apply the fetched suggestion if this is still the latest request
    // for this word and the user hasn't already typed their own value —
    // otherwise a slow response can silently clobber something newer.
    const stillCurrent = (prev) =>
      prev[word] && !prev[word].edited && relatedFetchSeqRef.current[word] === seq;
    try {
      const suggestions = await fetchTranslationSuggestions(word);
      setRelatedSelections((prev) =>
        stillCurrent(prev) ? { ...prev, [word]: { ru: suggestions[0] || '', status: 'idle' } } : prev
      );
    } catch (e) {
      setRelatedSelections((prev) => (stillCurrent(prev) ? { ...prev, [word]: { ru: '', status: 'idle' } } : prev));
    }
  };

  const setRelatedTranslation = (word, ru) => {
    setRelatedSelections((prev) => (prev[word] ? { ...prev, [word]: { ...prev[word], ru, edited: true } } : prev));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving || !sr.trim() || ruVariants.length === 0 || duplicate) return;
    const relatedToAdd = Object.entries(relatedSelections).map(([relSr, sel]) => ({
      sr: relSr,
      ru: sel.ru,
      tagNames: selectedTagNames.filter((name) => !tagExclusions[name]?.has(relSr)),
    }));
    const mainTagNames = selectedTagNames.filter((name) => !tagExclusions[name]?.has('__main__'));
    // The form is only cleared once the word is really saved — clearing it
    // first meant a failed save (server down, network drop) also threw away
    // everything that had been typed.
    setSaving(true);
    setSaveFailed(false);
    let saved = false;
    try {
      saved = await onAdd(sr, ruVariants.join(', '), example, relatedToAdd, mainTagNames);
    } finally {
      setSaving(false);
    }
    if (!saved) {
      setSaveFailed(true);
      return;
    }
    srLiveRef.current = '';
    autoPosRef.current = [];
    dismissedPosRef.current = new Set();
    posLookedUpForRef.current = '';
    setAutoPosNames([]);
    setSr('');
    setRuVariants([]);
    setVariantsResetKey((k) => k + 1);
    setExample('');
    setLookupState('idle');
    setRelatedWords([]);
    setRelatedState('idle');
    setRelatedSelections({});
    setSelectedTagNames([]);
    setTagQuery('');
    setTagExclusions({});
    setInflectionTables(null);
    setInflectionState('idle');
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
    srRef.current?.focus();
  };

  const lookupRelatedWords = async () => {
    const word = sr.trim();
    if (!word) return;
    setRelatedState('loading');
    try {
      const found = await fetchRelatedWordsFromWiktionary(word);
      // The word field may have changed while this was in flight — a late
      // response for a word no longer shown must not overwrite what's
      // currently on screen (and, if submitted, get attached to the wrong
      // word).
      if (srLiveRef.current !== word) return;
      if (found) {
        setRelatedWords(found);
        setRelatedState('idle');
        // Related words already in the dictionary are auto-selected for
        // linking — no click or translation needed, they already have one.
        const autoIncluded = {};
        found.forEach((w) => {
          const existing = findDuplicateWord(w, words);
          if (existing) autoIncluded[w] = { ru: existing.ru, status: 'idle', alreadyExists: true };
        });
        setRelatedSelections(autoIncluded);
      } else {
        setRelatedWords([]);
        setRelatedState('notfound');
        setRelatedSelections({});
      }
    } catch (e) {
      if (srLiveRef.current !== word) return;
      setRelatedWords([]);
      setRelatedState('error');
      setRelatedSelections({});
    }
  };

  const lookupInflectionTables = async () => {
    const word = sr.trim();
    if (!word) return;
    setInflectionState('loading');
    try {
      const found = await fetchInflectionTables(word);
      if (srLiveRef.current !== word) return;
      if (found) {
        setInflectionTables(found);
        setInflectionState('idle');
      } else {
        setInflectionTables(null);
        setInflectionState('notfound');
      }
    } catch (e) {
      if (srLiveRef.current !== word) return;
      setInflectionTables(null);
      setInflectionState('error');
    }
  };

  const lookupExample = async () => {
    const word = sr.trim();
    if (!word) return;
    setLookupState('loading');
    try {
      const found = await fetchExample(word);
      if (srLiveRef.current !== word) return;
      if (found) {
        setExample(found);
        setLookupState('idle');
      } else {
        setLookupState('notfound');
      }
    } catch (e) {
      if (srLiveRef.current !== word) return;
      setLookupState('error');
    }
  };

  const canSubmit = sr.trim() && ruVariants.length > 0 && !duplicate;

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl px-6 py-7"
      style={{ background: '#1B2440', border: '1px solid #2A3355' }}
    >
      <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
        СРПСКИ
      </label>
      <div className="flex items-center gap-2 mt-1.5 mb-1.5">
        <input
          ref={srRef}
          value={sr}
          onChange={(e) => {
            srLiveRef.current = e.target.value.trim();
            setSr(e.target.value);
            // Everything below is only valid for the word it was looked up
            // for — clear it all so stale results from a previous word
            // can't be mistaken for (or saved under) this one's.
            setRelatedWords([]);
            setRelatedState('idle');
            setRelatedSelections({});
            setTagExclusions({});
            setInflectionTables(null);
            setInflectionState('idle');
            setExample('');
            setLookupState('idle');
          }}
          placeholder="нпр. хвала"
          autoComplete="off"
          className="flex-1 rounded-lg px-3.5 py-2.5 outline-none"
          style={{ fontFamily: FONT_DISPLAY, fontSize: '1.05rem', background: '#F5F1E8', color: '#1C2333', border: '1.5px solid transparent' }}
        />
        <PronounceButton text={sr} size={18} />
        <IpaText text={sr} size="0.85rem" />
      </div>
      {duplicate ? (
        <p style={{ color: '#E28B95', fontSize: '0.78rem', marginBottom: 12 }}>
          Ова реч већ постоји: <span style={{ color: '#F5F1E8', fontWeight: 600 }}>{duplicate.sr}</span> →{' '}
          {duplicate.ru}. Иди на картицу „Речи" да је уредиш уместо да правиш дупликат.
        </p>
      ) : likelyTypoOf ? (
        <p style={{ color: '#C9A24B', fontSize: '0.78rem', marginBottom: 12 }}>
          Можда си мислио/ла на{' '}
          <span style={{ color: '#F5F1E8', fontWeight: 600 }}>{likelyTypoOf.sr}</span> ({likelyTypoOf.ru})? Ако је
          ово стварно нова реч, слободно настави.
        </p>
      ) : otherScript(sr) ? (
        <p style={{ color: '#5C6690', fontSize: '0.78rem', marginBottom: 12 }}>
          Друго писмо: <span style={{ color: '#8892AE' }}>{otherScript(sr)}</span> — додаје се
          аутоматски, обе варијанте важе на картици.
        </p>
      ) : (
        <div style={{ marginBottom: 12 }} />
      )}

      <div className="flex items-center justify-between mb-1.5">
        <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
          ПОВЕЗАНЕ РЕЧИ (WIKTIONARY, НЕОБАВЕЗНО)
        </label>
        <button
          type="button"
          onClick={lookupRelatedWords}
          disabled={!sr.trim() || relatedState === 'loading'}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1"
          style={{
            fontFamily: FONT_BODY,
            fontSize: '0.72rem',
            color: sr.trim() ? '#D4A54A' : '#4B5680',
            background: 'transparent',
          }}
          title="Потражи повезане/изведене речи на Wiktionary-ју (може не наћи ништа)"
        >
          {relatedState === 'loading' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Search size={13} />
          )}
          Прикажи повезане речи
        </button>
      </div>
      {relatedWords.length > 0 && (
        <>
          <p style={{ color: '#5C6690', fontSize: '0.72rem', marginBottom: 6 }}>
            Речи које већ постоје у речнику биће аутоматски повезане. Кликни на остале да их и њих додаш:
          </p>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {relatedWords.map((w) => {
              const selected = !!relatedSelections[w];
              const alreadyInDict = findDuplicateWord(w, words);
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleRelatedSelection(w)}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
                  style={{
                    background: selected ? '#D4A54A' : '#12192E',
                    border: `1px solid ${selected ? '#D4A54A' : '#2A3355'}`,
                    color: selected ? '#1C2333' : '#8892AE',
                    fontSize: '0.8rem',
                    fontWeight: selected ? 600 : 400,
                  }}
                  title={
                    alreadyInDict
                      ? 'Већ постоји у речнику — биће аутоматски повезана (клик да откажеш)'
                      : undefined
                  }
                >
                  {selected && <Check size={11} />}
                  {w}
                  {alreadyInDict && (
                    <span style={{ color: selected ? '#5c4a1f' : '#5C6690', fontSize: '0.68rem' }}>
                      • у речнику
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {Object.keys(relatedSelections).length > 0 && (
            <div className="flex flex-col gap-1.5 mb-1.5">
              {Object.entries(relatedSelections).map(([relSr, sel]) => (
                <div key={relSr} className="flex items-center gap-2">
                  <span style={{ color: '#F5F1E8', fontSize: '0.82rem', minWidth: 90 }}>{relSr}</span>
                  <span style={{ color: '#5C6690' }}>→</span>
                  {sel.alreadyExists ? (
                    <span style={{ color: '#8892AE', fontSize: '0.82rem' }}>
                      {sel.ru}{' '}
                      <span style={{ color: '#5C6690', fontSize: '0.7rem' }}>(већ у речнику — само повезивање)</span>
                    </span>
                  ) : sel.status === 'loading' ? (
                    <span style={{ color: '#5C6690', fontSize: '0.78rem' }} className="flex items-center gap-1.5">
                      <Loader2 size={12} className="animate-spin" /> тражим превод…
                    </span>
                  ) : (
                    <input
                      value={sel.ru}
                      onChange={(e) => setRelatedTranslation(relSr, e.target.value)}
                      placeholder="превод (обавезно да би се додало)"
                      autoComplete="off"
                      className="rounded-md px-2.5 py-1 outline-none flex-1"
                      style={{ fontSize: '0.82rem', background: '#F5F1E8', color: '#1C2333', border: '1.5px solid transparent' }}
                    />
                  )}
                </div>
              ))}
              <p style={{ color: '#5C6690', fontSize: '0.7rem' }}>
                Означене нове речи без превода неће бити додате — упиши превод ручно ако ништа није пронађено.
              </p>
            </div>
          )}
        </>
      )}
      {relatedState === 'notfound' && (
        <p style={{ color: '#8892AE', fontSize: '0.72rem', marginBottom: 8 }}>
          Ништа нађено на Wiktionary-ју — реч можда тамо не постоји или нема наведене повезане речи.
        </p>
      )}
      {relatedState === 'error' && (
        <p style={{ color: '#8892AE', fontSize: '0.72rem', marginBottom: 8 }}>
          Претрага тренутно није доступна.
        </p>
      )}
      {sr.trim() && (
        <a
          href={`https://en.wiktionary.org/wiki/${encodeURIComponent(sr.trim())}#Serbo-Croatian`}
          target="_blank"
          rel="noreferrer"
          style={{ color: '#5C6690', fontSize: '0.72rem', marginBottom: 12, display: 'inline-block' }}
        >
          Отвори пуну одредницу на Wiktionary-ју →
        </a>
      )}

      {sr.trim() && (
        <div className="flex items-center justify-between mb-1.5">
          <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
            ПРОМЕНЕ ПО ПАДЕЖИМА/ЛИЦИМА (WIKTIONARY, НЕОБАВЕЗНО)
          </label>
          <button
            type="button"
            onClick={lookupInflectionTables}
            disabled={inflectionState === 'loading'}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1"
            style={{ fontFamily: FONT_BODY, fontSize: '0.72rem', color: '#D4A54A', background: 'transparent' }}
            title="Потражи табелу деклинације/конјугације на Wiktionary-ју (може не наћи ништа)"
          >
            {inflectionState === 'loading' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Search size={13} />
            )}
            Прикажи промене
          </button>
        </div>
      )}
      {inflectionTables && (
        <div className="mb-3">
          <InflectionTables tables={inflectionTables} />
        </div>
      )}
      {inflectionState === 'notfound' && (
        <p style={{ color: '#8892AE', fontSize: '0.72rem', marginBottom: 8 }}>
          Ништа нађено на Wiktionary-ју — реч можда тамо не постоји или нема наведену табелу.
        </p>
      )}
      {inflectionState === 'error' && (
        <p style={{ color: '#8892AE', fontSize: '0.72rem', marginBottom: 8 }}>
          Претрага тренутно није доступна.
        </p>
      )}
      <div style={{ marginBottom: 12 }} />

      <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
        ПРЕВОДИ (МОЖЕ ВИШЕ)
      </label>
      <div className="mt-1.5 mb-1">
        <VariantsEditor key={variantsResetKey} variants={ruVariants} onChange={setRuVariants} srWord={sr} />
      </div>
      <p style={{ color: '#5C6690', fontSize: '0.75rem', marginBottom: 20 }}>
        На картици ће се рачунати тачним било који од ових превода.
      </p>

      <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
        ТАГОВИ (НЕОБАВЕЗНО)
      </label>
      <div className="mt-1.5 mb-1.5">
        <input
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && tagQuery.trim()) {
              e.preventDefault();
              addTagName(tagQuery);
              setTagQuery('');
            }
          }}
          placeholder="претражи или направи нови таг…"
          autoComplete="off"
          className="w-full rounded-lg px-3.5 py-2.5 mb-1.5 outline-none"
          style={{ fontFamily: FONT_DISPLAY, fontSize: '1rem', background: '#F5F1E8', color: '#1C2333', border: '1.5px solid transparent' }}
        />
        {autoPosNames.length > 0 && (
          <p style={{ color: '#8892AE', fontSize: '0.78rem', marginBottom: 6 }}>
            Врста речи са Wiktionary-ја: <span style={{ color: '#D4A54A' }}>{autoPosNames.join(', ')}</span> — кликни на таг да га уклониш.
          </p>
        )}
        {(() => {
          const q = tagQuery.trim().toLowerCase();
          const visibleTags = (tags || []).filter((t) => !q || t.name.toLowerCase().includes(q));
          const exactExists = (tags || []).some((t) => t.name.toLowerCase() === q);
          if (visibleTags.length === 0 && !q) return null;
          return (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {visibleTags.map((t) => (
                <TagFilterPill
                  key={t.id}
                  active={selectedTagNames.includes(t.name.toLowerCase())}
                  label={t.name}
                  onClick={() =>
                    selectedTagNames.includes(t.name.toLowerCase())
                      ? removeTagName(t.name.toLowerCase())
                      : addTagName(t.name)
                  }
                />
              ))}
              {q && !exactExists && (
                <button
                  type="button"
                  onClick={() => {
                    addTagName(tagQuery);
                    setTagQuery('');
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs"
                  style={{ fontFamily: FONT_MONO, background: '#12192E', border: '1px solid #3D8B5F', color: '#7DC79A' }}
                >
                  <Plus size={11} />
                  направи „{tagQuery.trim()}"
                </button>
              )}
            </div>
          );
        })()}
        {(() => {
          // A newly-created tag (typed via Enter or "направи „X"", not
          // matching any existing tag) has no highlighted pill to show it's
          // selected — the pill list above only renders from the existing
          // `tags` prop, so a brand-new name silently vanishes from the UI
          // the instant it's added, with nothing telling you it worked. The
          // per-target breakdown below only appears once there are related
          // words to break it down by, so it can't cover this case either.
          const newlyCreated = selectedTagNames.filter(
            (name) => !(tags || []).some((t) => t.name.toLowerCase() === name)
          );
          if (newlyCreated.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {newlyCreated.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: '0.78rem',
                    background: '#12192E',
                    border: '1px solid #3D8B5F',
                    color: '#7DC79A',
                  }}
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeTagName(name)}
                    aria-label={`Уклони ${name}`}
                    style={{ color: '#7DC79A', lineHeight: 1, fontWeight: 700 }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          );
        })()}
        {suggestedTagNames.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span style={{ color: '#5C6690', fontSize: '0.7rem' }}>предлог из повезаних речи:</span>
            {suggestedTagNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => addTagName(name)}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1"
                style={{ background: '#12192E', border: '1px solid #2A3355', color: '#D4A54A', fontSize: '0.78rem' }}
              >
                <Plus size={11} />
                {name}
              </button>
            ))}
          </div>
        )}
        {selectedTagNames.length > 0 && Object.keys(relatedSelections).length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            {selectedTagNames.map((name) => (
              <div key={name} className="flex flex-col gap-0.5 pl-2" style={{ borderLeft: '2px solid #2A3355' }}>
                <p style={{ color: '#5C6690', fontSize: '0.68rem' }}>
                  <span style={{ color: '#D4A54A', fontFamily: FONT_MONO }}>{name}</span> примењује се на:
                </p>
                <label className="flex items-center gap-2" style={{ fontSize: '0.8rem', color: '#F5F1E8' }}>
                  <input
                    type="checkbox"
                    checked={!tagExclusions[name]?.has('__main__')}
                    onChange={() => toggleTagTarget(name, '__main__')}
                  />
                  {sr.trim()}
                </label>
                {Object.keys(relatedSelections).map((relSr) => (
                  <label
                    key={relSr}
                    className="flex items-center gap-2"
                    style={{ fontSize: '0.8rem', color: '#F5F1E8' }}
                  >
                    <input
                      type="checkbox"
                      checked={!tagExclusions[name]?.has(relSr)}
                      onChange={() => toggleTagTarget(name, relSr)}
                    />
                    {relSr}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ marginBottom: 20 }} />

      <div className="flex items-center justify-between mb-1.5">
        <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
          ПРИМЕР УПОТРЕБЕ (НА СРПСКОМ, НЕОБАВЕЗНО)
        </label>
        <button
          type="button"
          onClick={lookupExample}
          disabled={!sr.trim() || lookupState === 'loading'}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1"
          style={{
            fontFamily: FONT_BODY,
            fontSize: '0.72rem',
            color: sr.trim() ? '#D4A54A' : '#4B5680',
            background: 'transparent',
          }}
          title="Потражи пример из Tatoeba корпуса (може не наћи ништа)"
        >
          {lookupState === 'loading' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Search size={13} />
          )}
          Нађи пример
        </button>
      </div>
      <input
        value={example}
        onChange={(e) => setExample(e.target.value)}
        placeholder="нпр. Хвала на помоћи, много си љубазан."
        autoComplete="off"
        className="w-full rounded-lg px-3.5 py-2.5 mt-0 mb-1 outline-none"
        style={{ fontFamily: FONT_BODY, fontSize: '0.9rem', background: '#F5F1E8', color: '#1C2333', border: '1.5px solid transparent' }}
      />
      {lookupState === 'notfound' && (
        <p style={{ color: '#8892AE', fontSize: '0.72rem', marginBottom: 12 }}>
          Ништа нађено у бесплатној бази примера — унеси ручно.
        </p>
      )}
      {lookupState === 'error' && (
        <p style={{ color: '#8892AE', fontSize: '0.72rem', marginBottom: 12 }}>
          Претрага тренутно није доступна — унеси пример ручно.
        </p>
      )}
      {(lookupState === 'idle' || lookupState === '') && <div style={{ marginBottom: 8 }} />}

      <div className="flex items-center gap-3 mt-4">
        <button
          type="submit"
          disabled={!canSubmit || saving}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold flex items-center gap-2"
          style={{
            fontFamily: FONT_BODY,
            background: canSubmit ? '#C41E3A' : '#2A3355',
            color: canSubmit ? '#F5F1E8' : '#5C6690',
          }}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Додај реч
        </button>
        {saveFailed && (
          <span style={{ color: '#E28B95', fontSize: '0.85rem', fontFamily: FONT_BODY }}>
            Није сачувано — покушај поново (унето је остало).
          </span>
        )}
        {justAdded && (
          <span style={{ color: '#7DC79A', fontSize: '0.85rem', fontFamily: FONT_BODY }}>
            Додато ✓
          </span>
        )}
      </div>
    </form>
  );
}
