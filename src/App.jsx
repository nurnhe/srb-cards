import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Shuffle, Trash2, Check, X, ArrowLeftRight, BookMarked, Pencil, Link2, Search, Loader2 } from 'lucide-react';
import { supabase } from './supabaseClient';

const FONT_DISPLAY = "'PT Serif', Georgia, serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', monospace";

const FONT_LINK_ID = 'srb-flashcards-fonts';

function useGoogleFonts() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=PT+Serif:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap';
    document.head.appendChild(link);
  }, []);
}

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
async function fetchExample(srWord) {
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

// Best-effort translation suggestions (sr → ru) via the free, CORS-enabled
// MyMemory API. Returns a short list of distinct candidate translations —
// quality varies since it's crowdsourced/machine translation, so these are
// suggestions to review and pick from, not guaranteed-correct answers.
async function fetchTranslationSuggestions(srWord) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(srWord)}&langpair=sr|ru`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('mymemory request failed');
  const json = await res.json();
  const candidates = [];
  const seen = new Set();
  const add = (text) => {
    const t = text?.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(t);
  };
  add(json.responseData?.translatedText);
  (json.matches || [])
    .sort((a, b) => (b.quality || 0) - (a.quality || 0))
    .forEach((m) => add(m.translation));
  return candidates.slice(0, 5);
}

// ---- Serbian Cyrillic ↔ Latin transliteration ----
// Serbian has a well-defined 1:1 letter correspondence between scripts
// (a few multi-letter Latin digraphs: nj/lj/dž ↔ њ/љ/џ). This covers the
// vast majority of vocabulary correctly; a handful of morpheme-boundary
// edge cases (e.g. "nadživeti") aren't disambiguated, which is an accepted
// trade-off for a personal vocab app.
const CYR_TO_LAT = [
  ['А', 'A'], ['Б', 'B'], ['В', 'V'], ['Г', 'G'], ['Д', 'D'], ['Ђ', 'Đ'],
  ['Е', 'E'], ['Ж', 'Ž'], ['З', 'Z'], ['И', 'I'], ['Ј', 'J'], ['К', 'K'],
  ['Л', 'L'], ['Љ', 'Lj'], ['М', 'M'], ['Н', 'N'], ['Њ', 'Nj'], ['О', 'O'],
  ['П', 'P'], ['Р', 'R'], ['С', 'S'], ['Т', 'T'], ['Ћ', 'Ć'], ['У', 'U'],
  ['Ф', 'F'], ['Х', 'H'], ['Ц', 'C'], ['Ч', 'Č'], ['Џ', 'Dž'], ['Ш', 'Š'],
];

const DIGRAPH_UPPER = { Lj: 'LJ', Nj: 'NJ', Dž: 'DŽ' };

function cyrillicToLatin(str) {
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
const LAT_TO_CYR = [
  ['Lj', 'Љ'], ['Nj', 'Њ'], ['Dž', 'Џ'],
  ['A', 'А'], ['B', 'Б'], ['V', 'В'], ['G', 'Г'], ['D', 'Д'], ['Đ', 'Ђ'],
  ['E', 'Е'], ['Ž', 'Ж'], ['Z', 'З'], ['I', 'И'], ['J', 'Ј'], ['K', 'К'],
  ['L', 'Л'], ['M', 'М'], ['N', 'Н'], ['O', 'О'], ['P', 'П'], ['R', 'Р'],
  ['S', 'С'], ['T', 'Т'], ['Ć', 'Ћ'], ['U', 'У'], ['F', 'Ф'], ['H', 'Х'],
  ['C', 'Ц'], ['Č', 'Ч'], ['Š', 'Ш'],
].sort((a, b) => b[0].length - a[0].length);

function latinToCyrillic(str) {
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

function isCyrillic(str) {
  return /[\u0400-\u04FF]/.test(str);
}

// Given a Serbian word/phrase in either script, returns its counterpart in
// the other script (or null if there's nothing script-specific to convert).
function otherScript(sr) {
  if (!sr || !sr.trim()) return null;
  return isCyrillic(sr) ? cyrillicToLatin(sr) : latinToCyrillic(sr);
}

function normalize(str) {
  return str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]/g, '');
}

// splits "answer1, answer2" into accepted alternatives
function acceptedAnswers(str) {
  return str
    .split(',')
    .map((s) => normalize(s))
    .filter(Boolean);
}

function parseVariants(str) {
  return (str || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Manages a list of accepted translation variants as chips: manual add,
// remove, plus one-click suggestions fetched from a translation API.
function VariantsEditor({ variants, onChange, srWord }) {
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestState, setSuggestState] = useState('idle'); // idle | loading | notfound | error

  const addVariant = (text) => {
    const t = text.trim().toLowerCase();
    if (!t) return;
    if (variants.some((v) => v.toLowerCase() === t)) return;
    onChange([...variants, t]);
  };

  const removeVariant = (text) => {
    onChange(variants.filter((v) => v !== text));
  };

  const commitDraft = () => {
    addVariant(draft);
    setDraft('');
  };

  const suggest = async () => {
    if (!srWord.trim()) return;
    setSuggestState('loading');
    try {
      const found = await fetchTranslationSuggestions(srWord.trim());
      const fresh = found.filter((f) => !variants.some((v) => v.toLowerCase() === f.toLowerCase()));
      if (fresh.length === 0) {
        setSuggestState('notfound');
        setSuggestions([]);
      } else {
        setSuggestions(fresh);
        setSuggestState('idle');
      }
    } catch (e) {
      setSuggestState('error');
      setSuggestions([]);
    }
  };

  return (
    <div>
      {variants.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {variants.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{ background: '#F5F1E8', color: '#1C2333', fontSize: '0.85rem' }}
            >
              {v}
              <button
                type="button"
                onClick={() => removeVariant(v)}
                aria-label={`Уклони ${v}`}
                style={{ color: '#A31C33', lineHeight: 1, fontWeight: 700 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
            }
          }}
          placeholder="упиши превод и Enter"
          className="flex-1 rounded-lg px-3.5 py-2.5 outline-none"
          style={{ fontFamily: FONT_DISPLAY, fontSize: '1rem', background: '#F5F1E8', color: '#1C2333', border: '1.5px solid transparent' }}
        />
        <button
          type="button"
          onClick={suggest}
          disabled={!srWord.trim() || suggestState === 'loading'}
          className="flex items-center gap-1.5 rounded-lg px-3 shrink-0"
          style={{
            fontFamily: FONT_BODY,
            fontSize: '0.78rem',
            color: srWord.trim() ? '#D4A54A' : '#4B5680',
            background: '#12192E',
            border: '1px solid #2A3355',
          }}
          title="Предложи преводе (машински, провери пре него што сачуваш)"
        >
          {suggestState === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          Предложи
        </button>
      </div>

      {suggestState === 'notfound' && (
        <p style={{ color: '#8892AE', fontSize: '0.72rem', marginTop: 6 }}>
          Ништа ново није пронађено — унеси ручно.
        </p>
      )}
      {suggestState === 'error' && (
        <p style={{ color: '#8892AE', fontSize: '0.72rem', marginTop: 6 }}>
          Претрага тренутно није доступна — унеси ручно.
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="mt-2">
          <div style={{ color: '#5C6690', fontSize: '0.7rem', marginBottom: 5, fontFamily: FONT_MONO }}>
            ПРЕДЛОЗИ (КЛИКНИ ДА ДОДАШ)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  addVariant(s);
                  setSuggestions((prev) => prev.filter((x) => x !== s));
                }}
                className="rounded-full px-2.5 py-1"
                style={{ background: '#2A2140', color: '#C9A8E8', fontSize: '0.82rem', border: '1px dashed #4A3A66' }}
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  useGoogleFonts();

  const [words, setWords] = useState([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [tab, setTab] = useState('practice');

  const attachLinks = useCallback((wordRows, linkRows) => {
    const map = {};
    (linkRows || []).forEach((l) => {
      if (!map[l.word_id]) map[l.word_id] = [];
      map[l.word_id].push(l.related_word_id);
    });
    return wordRows.map((w) => ({ ...w, relatedIds: map[w.id] || [] }));
  }, []);

  const reloadAll = useCallback(async () => {
    const [wordsRes, linksRes] = await Promise.all([
      supabase.from('words').select('id, sr, ru, example').order('created_at', { ascending: true }),
      supabase.from('word_links').select('word_id, related_word_id'),
    ]);
    if (wordsRes.error || linksRes.error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords(attachLinks(wordsRes.data || [], linksRes.data || []));
  }, [attachLinks]);

  // load words + links from Supabase on mount
  useEffect(() => {
    (async () => {
      await reloadAll();
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addWord = useCallback(async (sr, ru, example) => {
    const { data, error } = await supabase
      .from('words')
      .insert({ sr: sr.trim().toLowerCase(), ru: ru.trim().toLowerCase(), example: example?.trim() || null })
      .select('id, sr, ru, example')
      .single();
    if (error || !data) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) => [...prev, { ...data, relatedIds: [] }]);
  }, []);

  const updateWord = useCallback(async (id, sr, ru, example) => {
    const nextSr = sr.trim().toLowerCase();
    const nextRu = ru.trim().toLowerCase();
    const { error } = await supabase
      .from('words')
      .update({ sr: nextSr, ru: nextRu, example: example?.trim() || null })
      .eq('id', id);
    if (error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, sr: nextSr, ru: nextRu, example: example?.trim() || null } : w
      )
    );
  }, []);

  const deleteWord = useCallback(async (id) => {
    const { error } = await supabase.from('words').delete().eq('id', id);
    if (error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) =>
      prev
        .filter((w) => w.id !== id)
        .map((w) => ({ ...w, relatedIds: w.relatedIds.filter((rid) => rid !== id) }))
    );
  }, []);

  const linkWords = useCallback(async (idA, idB) => {
    if (idA === idB) return;
    const { error } = await supabase
      .from('word_links')
      .upsert(
        [
          { word_id: idA, related_word_id: idB },
          { word_id: idB, related_word_id: idA },
        ],
        { onConflict: 'word_id,related_word_id' }
      );
    if (error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) =>
      prev.map((w) => {
        if (w.id === idA && !w.relatedIds.includes(idB)) return { ...w, relatedIds: [...w.relatedIds, idB] };
        if (w.id === idB && !w.relatedIds.includes(idA)) return { ...w, relatedIds: [...w.relatedIds, idA] };
        return w;
      })
    );
  }, []);

  const unlinkWords = useCallback(async (idA, idB) => {
    const { error } = await supabase
      .from('word_links')
      .delete()
      .or(
        `and(word_id.eq.${idA},related_word_id.eq.${idB}),and(word_id.eq.${idB},related_word_id.eq.${idA})`
      );
    if (error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) =>
      prev.map((w) => {
        if (w.id === idA) return { ...w, relatedIds: w.relatedIds.filter((rid) => rid !== idB) };
        if (w.id === idB) return { ...w, relatedIds: w.relatedIds.filter((rid) => rid !== idA) };
        return w;
      })
    );
  }, []);

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: '#12192E', fontFamily: FONT_BODY }}
    >
      <div className="max-w-2xl mx-auto px-5 py-8">
        <Header />
        <TabBar tab={tab} setTab={setTab} count={words.length} />

        {!ready ? (
          <div className="text-center py-20" style={{ color: '#8892AE' }}>
            Учитавање…
          </div>
        ) : (
          <>
            {tab === 'practice' && <Practice words={words} />}
            {tab === 'words' && (
              <WordsList
                words={words}
                onDelete={deleteWord}
                onUpdate={updateWord}
                onLink={linkWords}
                onUnlink={unlinkWords}
              />
            )}
            {tab === 'add' && <AddWord onAdd={addWord} goToList={() => setTab('words')} />}
          </>
        )}

        {storageError && (
          <div
            className="mt-6 text-sm text-center rounded-lg py-2 px-3"
            style={{ background: '#3A1F26', color: '#E8A0A8' }}
          >
            Не могу да сачувам промене. Покушајте поново.
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-3 mb-7">
      <div
        className="flex items-center justify-center rounded-lg shrink-0"
        style={{
          width: 42,
          height: 42,
          background: 'linear-gradient(155deg, #C41E3A 0%, #8E1529 100%)',
        }}
      >
        <BookMarked size={20} color="#F5F1E8" strokeWidth={2} />
      </div>
      <div>
        <h1
          style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1.5rem', lineHeight: 1.1 }}
        >
          речи <span style={{ color: '#C41E3A', fontStyle: 'italic' }}>&amp;</span> слова
        </h1>
        <p style={{ color: '#8892AE', fontSize: '0.8rem', marginTop: 2 }}>
          српски&nbsp;⇄&nbsp;руски речник
        </p>
      </div>
    </div>
  );
}

function TabBar({ tab, setTab, count }) {
  const tabs = [
    { id: 'practice', label: 'Вежбање' },
    { id: 'words', label: `Речи${count ? ` · ${count}` : ''}` },
    { id: 'add', label: 'Додај' },
  ];
  return (
    <div
      className="flex gap-1 mb-7 p-1 rounded-xl"
      style={{ background: '#1B2440', border: '1px solid #2A3355' }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            fontFamily: FONT_BODY,
            background: tab === t.id ? '#F5F1E8' : 'transparent',
            color: tab === t.id ? '#12192E' : '#8892AE',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- PRACTICE ---------------- */

// Fisher–Yates shuffle
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Practice({ words }) {
  const [direction, setDirection] = useState('sr-ru'); // sr-ru: show SR, ask RU
  const [current, setCurrent] = useState(null);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState(null); // null | 'correct' | 'wrong'
  const [session, setSession] = useState({ correct: 0, total: 0 });
  const inputRef = useRef(null);
  // "deck" of word ids not yet shown in the current shuffle cycle —
  // guarantees every word appears once before any repeats, in a fresh
  // random order each cycle, and never repeats the same card twice in a row.
  const deckRef = useRef([]);

  const drawNext = useCallback(
    (excludeId) => {
      if (words.length === 0) return null;
      if (words.length === 1) return words[0];

      if (deckRef.current.length === 0) {
        let ids = shuffle(words.map((w) => w.id));
        // avoid starting a new cycle with the same card that was just shown
        if (ids[0] === excludeId) {
          [ids[0], ids[1]] = [ids[1], ids[0]];
        }
        deckRef.current = ids;
      }
      const nextId = deckRef.current.shift();
      return words.find((w) => w.id === nextId) || null;
    },
    [words]
  );

  useEffect(() => {
    // word list changed (added/removed/loaded) — reset the deck so new
    // words get shuffled in, then draw a fresh card
    deckRef.current = [];
    setCurrent(words.length > 0 ? drawNext(null) : null);
    setInput('');
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words]);

  useEffect(() => {
    if (feedback === null && inputRef.current) inputRef.current.focus();
  }, [current, feedback]);

  if (words.length === 0) {
    return (
      <div
        className="text-center rounded-2xl py-16 px-6"
        style={{ background: '#1B2440', border: '1px solid #2A3355' }}
      >
        <p style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1.15rem' }}>
          Речник је празан
        </p>
        <p style={{ color: '#8892AE', fontSize: '0.9rem', marginTop: 8 }}>
          Додајте бар једну реч на картици „Додај" да бисте почели да вежбате.
        </p>
      </div>
    );
  }

  const prompt = direction === 'sr-ru' ? current?.sr : current?.ru;
  const promptLabel = direction === 'sr-ru' ? 'СРПСКИ' : 'РУССКИЙ';
  const answerLabel = direction === 'sr-ru' ? 'РУССКИЙ' : 'СРПСКИ';

  const checkAnswer = () => {
    if (!current || feedback) return;
    let isCorrect;
    if (direction === 'sr-ru') {
      isCorrect = acceptedAnswers(current.ru).includes(normalize(input));
    } else {
      const alt = otherScript(current.sr);
      const targets = [current.sr, alt].filter(Boolean);
      isCorrect = targets.some((t) => normalize(t) === normalize(input));
    }
    setFeedback(isCorrect ? 'correct' : 'wrong');
    setSession((s) => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
  };

  const next = () => {
    setCurrent(drawNext(current?.id));
    setInput('');
    setFeedback(null);
  };

  const switchDirection = (dir) => {
    setDirection(dir);
    setInput('');
    setFeedback(null);
    setCurrent(drawNext(current?.id));
  };

  return (
    <div>
      {/* direction toggle */}
      <div className="flex items-center justify-center gap-3 mb-5">
        <DirectionPill
          active={direction === 'sr-ru'}
          label="СР → РУ"
          onClick={() => switchDirection('sr-ru')}
        />
        <ArrowLeftRight size={16} color="#4B5680" />
        <DirectionPill
          active={direction === 'ru-sr'}
          label="РУ → СР"
          onClick={() => switchDirection('ru-sr')}
        />
      </div>

      {/* score */}
      <div
        className="text-center mb-5"
        style={{ fontFamily: FONT_MONO, color: '#5C6690', fontSize: '0.8rem', letterSpacing: 1 }}
      >
        {session.correct} / {session.total} ТАЧНО У ОВОЈ СЕСИЈИ
      </div>

      {/* card */}
      <div
        className="rounded-2xl px-7 py-10 text-center relative overflow-hidden"
        style={{
          background: '#F5F1E8',
          border: feedback === 'correct' ? '2px solid #3D8B5F' : feedback === 'wrong' ? '2px solid #C41E3A' : '2px solid #2A3355',
        }}
      >
        <span
          className="inline-block px-2.5 py-1 rounded-full mb-5"
          style={{
            fontFamily: FONT_MONO,
            fontSize: '0.65rem',
            letterSpacing: 1.5,
            background: '#12192E',
            color: '#D4A54A',
          }}
        >
          {promptLabel}
        </span>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: '2.1rem',
            color: '#1C2333',
            marginBottom: direction === 'sr-ru' && otherScript(current.sr) ? 4 : 28,
            wordBreak: 'break-word',
          }}
        >
          {prompt}
        </div>
        {direction === 'sr-ru' && otherScript(current.sr) && (
          <div
            style={{
              fontFamily: FONT_BODY,
              fontSize: '1rem',
              color: '#9C9683',
              marginBottom: 28,
            }}
          >
            {otherScript(current.sr)}
          </div>
        )}

        {feedback === null ? (
          <div className="flex flex-col gap-3 items-center">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && checkAnswer()}
              placeholder={`превод (${answerLabel.toLowerCase()})`}
              className="w-full max-w-xs text-center rounded-lg py-2.5 px-4 outline-none"
              style={{
                fontFamily: FONT_BODY,
                fontSize: '1rem',
                border: '1.5px solid #C9C2AE',
                background: '#FFFFFF',
                color: '#1C2333',
              }}
            />
            {direction === 'ru-sr' && (
              <div style={{ color: '#9C9683', fontSize: '0.72rem' }}>
                ћирилица или латиница — обе варијанте важе
              </div>
            )}
            <button
              onClick={checkAnswer}
              disabled={!input.trim()}
              className="rounded-lg px-6 py-2.5 text-sm font-semibold flex items-center gap-2"
              style={{
                fontFamily: FONT_BODY,
                background: input.trim() ? '#C41E3A' : '#DCD6C4',
                color: input.trim() ? '#F5F1E8' : '#9C9683',
              }}
            >
              <Check size={16} /> Провери
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 items-center">
            <div
              className="flex items-center gap-2 rounded-lg py-2 px-4"
              style={{
                background: feedback === 'correct' ? '#E4F2E8' : '#F7E4E6',
                color: feedback === 'correct' ? '#296B45' : '#A31C33',
              }}
            >
              {feedback === 'correct' ? <Check size={18} /> : <X size={18} />}
              <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: '0.95rem' }}>
                {feedback === 'correct' ? 'Тачно!' : 'Није тачно'}
              </span>
            </div>
            {feedback === 'wrong' && (
              <div style={{ color: '#6B6455', fontSize: '0.9rem' }}>
                Тачан одговор:{' '}
                <span style={{ fontWeight: 600, color: '#1C2333' }}>
                  {direction === 'sr-ru'
                    ? current.ru
                    : [current.sr, otherScript(current.sr)].filter(Boolean).join(' / ')}
                </span>
              </div>
            )}
            {current.example && (
              <div
                style={{
                  color: '#8A8368',
                  fontSize: '0.82rem',
                  fontStyle: 'italic',
                  maxWidth: 360,
                }}
              >
                «{current.example}»
              </div>
            )}
            <button
              onClick={next}
              className="rounded-lg px-6 py-2.5 text-sm font-semibold flex items-center gap-2"
              style={{ fontFamily: FONT_BODY, background: '#12192E', color: '#F5F1E8' }}
            >
              <Shuffle size={16} /> Следећа реч
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DirectionPill({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors"
      style={{
        fontFamily: FONT_MONO,
        letterSpacing: 0.5,
        background: active ? '#D4A54A' : '#1B2440',
        color: active ? '#12192E' : '#5C6690',
        border: active ? '1px solid #D4A54A' : '1px solid #2A3355',
      }}
    >
      {label}
    </button>
  );
}

/* ---------------- WORDS LIST ---------------- */

const srCollator = new Intl.Collator('sr', { sensitivity: 'base' });

function WordsList({ words, onDelete, onUpdate, onLink, onUnlink }) {
  const [editingId, setEditingId] = useState(null);
  const [editSr, setEditSr] = useState('');
  const [editRuVariants, setEditRuVariants] = useState([]);
  const [editExample, setEditExample] = useState('');
  const [linkingId, setLinkingId] = useState(null); // word currently picking a related word
  const [linkQuery, setLinkQuery] = useState('');

  if (words.length === 0) {
    return (
      <div
        className="text-center rounded-2xl py-16 px-6"
        style={{ background: '#1B2440', border: '1px solid #2A3355' }}
      >
        <p style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1.15rem' }}>
          Још нема речи
        </p>
        <p style={{ color: '#8892AE', fontSize: '0.9rem', marginTop: 8 }}>
          Овде ће се појавити све речи које додате.
        </p>
      </div>
    );
  }

  const sorted = [...words].sort((a, b) => srCollator.compare(a.sr, b.sr));
  const byId = Object.fromEntries(words.map((w) => [w.id, w]));

  const startEdit = (w) => {
    setEditingId(w.id);
    setEditSr(w.sr);
    setEditRuVariants(parseVariants(w.ru));
    setEditExample(w.example || '');
    setLinkingId(null);
  };

  const saveEdit = () => {
    if (editSr.trim() && editRuVariants.length > 0) {
      onUpdate(editingId, editSr, editRuVariants.join(', '), editExample);
    }
    setEditingId(null);
  };

  const startLinking = (id) => {
    setLinkingId(id);
    setLinkQuery('');
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        style={{
          color: '#5C6690',
          fontSize: '0.72rem',
          fontFamily: FONT_MONO,
          letterSpacing: 1,
          marginBottom: 2,
          paddingLeft: 4,
        }}
      >
        А–Ш · {words.length} {words.length === 1 ? 'РЕЧ' : 'РЕЧИ'}
      </div>

      {sorted.map((w) => {
        const related = w.relatedIds.map((rid) => byId[rid]).filter(Boolean);
        return (
          <div
            key={w.id}
            className="rounded-xl px-4 py-3 flex flex-col gap-2.5"
            style={{ background: '#1B2440', border: '1px solid #2A3355' }}
          >
            {editingId === w.id ? (
              <div className="flex flex-col gap-2">
                <input
                  value={editSr}
                  onChange={(e) => setEditSr(e.target.value)}
                  className="rounded-md px-3 py-1.5 text-sm outline-none"
                  style={{ background: '#12192E', color: '#F5F1E8', border: '1px solid #3A4570' }}
                  placeholder="српски"
                />
                <VariantsEditor variants={editRuVariants} onChange={setEditRuVariants} srWord={editSr} />
                <input
                  value={editExample}
                  onChange={(e) => setEditExample(e.target.value)}
                  className="rounded-md px-3 py-1.5 text-sm outline-none"
                  style={{ background: '#12192E', color: '#F5F1E8', border: '1px solid #3A4570' }}
                  placeholder="пример употребе (необавезно)"
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={saveEdit}
                    className="text-xs font-semibold rounded-md px-3 py-1.5"
                    style={{ background: '#3D8B5F', color: '#F5F1E8' }}
                  >
                    Сачувај
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs font-semibold rounded-md px-3 py-1.5"
                    style={{ background: '#2A3355', color: '#8892AE' }}
                  >
                    Откажи
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1rem' }}>
                    {w.sr}
                  </div>
                  {otherScript(w.sr) && (
                    <div style={{ color: '#5C6690', fontSize: '0.78rem', marginTop: 1 }}>
                      {otherScript(w.sr)}
                    </div>
                  )}
                  <div style={{ color: '#8892AE', fontSize: '0.85rem', marginTop: 3 }}>{w.ru}</div>
                  {w.example && (
                    <div
                      style={{
                        color: '#6B759C',
                        fontSize: '0.8rem',
                        marginTop: 4,
                        fontStyle: 'italic',
                      }}
                    >
                      «{w.example}»
                    </div>
                  )}
                  {related.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {related.map((r) => (
                        <span
                          key={r.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                          style={{
                            background: '#2A2140',
                            color: '#C9A8E8',
                            fontSize: '0.72rem',
                            fontFamily: FONT_MONO,
                          }}
                        >
                          {r.sr}
                          <button
                            onClick={() => onUnlink(w.id, r.id)}
                            aria-label={`Уклони везу са ${r.sr}`}
                            style={{ color: '#8A6FA8', lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => startLinking(w.id)}
                    className="p-2 rounded-md"
                    style={{ color: '#8892AE' }}
                    aria-label="Повежи са другом речи"
                    title="Повежи са сродном речи"
                  >
                    <Link2 size={15} />
                  </button>
                  <button
                    onClick={() => startEdit(w)}
                    className="p-2 rounded-md"
                    style={{ color: '#8892AE' }}
                    aria-label="Уреди"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => onDelete(w.id)}
                    className="p-2 rounded-md"
                    style={{ color: '#C41E3A' }}
                    aria-label="Обриши"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )}

            {linkingId === w.id && (
              <RelatedWordPicker
                word={w}
                allWords={words}
                query={linkQuery}
                onQueryChange={setLinkQuery}
                onPick={(otherId) => {
                  onLink(w.id, otherId);
                  setLinkingId(null);
                }}
                onCancel={() => setLinkingId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RelatedWordPicker({ word, allWords, query, onQueryChange, onPick, onCancel }) {
  const candidates = allWords
    .filter((w) => w.id !== word.id && !word.relatedIds.includes(w.id))
    .filter((w) => {
      if (!query.trim()) return true;
      const q = normalize(query);
      return normalize(w.sr).includes(q) || normalize(w.ru).includes(q);
    })
    .slice(0, 6);

  return (
    <div
      className="rounded-lg p-3"
      style={{ background: '#12192E', border: '1px solid #3A4570' }}
    >
      <div style={{ color: '#8892AE', fontSize: '0.78rem', marginBottom: 6 }}>
        Повежи <span style={{ color: '#F5F1E8', fontWeight: 600 }}>{word.sr}</span> са сродном речи
        (нпр. исти корен):
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="претражи речи…"
        className="w-full rounded-md px-3 py-1.5 text-sm outline-none mb-2"
        style={{ background: '#1B2440', color: '#F5F1E8', border: '1px solid #3A4570' }}
      />
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {candidates.length === 0 ? (
          <div style={{ color: '#5C6690', fontSize: '0.8rem', padding: '4px 2px' }}>
            Нема резултата.
          </div>
        ) : (
          candidates.map((w) => (
            <button
              key={w.id}
              onClick={() => onPick(w.id)}
              className="text-left rounded-md px-2.5 py-1.5 flex items-baseline gap-2"
              style={{ background: '#1B2440' }}
            >
              <span style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '0.9rem' }}>
                {w.sr}
              </span>
              <span style={{ color: '#8892AE', fontSize: '0.78rem' }}>{w.ru}</span>
            </button>
          ))
        )}
      </div>
      <button
        onClick={onCancel}
        className="text-xs font-semibold rounded-md px-3 py-1.5 mt-2"
        style={{ background: '#2A3355', color: '#8892AE' }}
      >
        Откажи
      </button>
    </div>
  );
}

/* ---------------- ADD WORD ---------------- */

function AddWord({ onAdd, goToList }) {
  const [sr, setSr] = useState('');
  const [ruVariants, setRuVariants] = useState([]);
  const [example, setExample] = useState('');
  const [justAdded, setJustAdded] = useState(false);
  const [lookupState, setLookupState] = useState('idle'); // idle | loading | notfound | error
  const srRef = useRef(null);

  const submit = (e) => {
    e.preventDefault();
    if (!sr.trim() || ruVariants.length === 0) return;
    onAdd(sr, ruVariants.join(', '), example);
    setSr('');
    setRuVariants([]);
    setExample('');
    setLookupState('idle');
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
    srRef.current?.focus();
  };

  const lookupExample = async () => {
    if (!sr.trim()) return;
    setLookupState('loading');
    try {
      const found = await fetchExample(sr.trim());
      if (found) {
        setExample(found);
        setLookupState('idle');
      } else {
        setLookupState('notfound');
      }
    } catch (e) {
      setLookupState('error');
    }
  };

  const canSubmit = sr.trim() && ruVariants.length > 0;

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl px-6 py-7"
      style={{ background: '#1B2440', border: '1px solid #2A3355' }}
    >
      <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
        СРПСКИ
      </label>
      <input
        ref={srRef}
        value={sr}
        onChange={(e) => setSr(e.target.value)}
        placeholder="нпр. хвала"
        className="w-full rounded-lg px-3.5 py-2.5 mt-1.5 mb-1.5 outline-none"
        style={{ fontFamily: FONT_DISPLAY, fontSize: '1.05rem', background: '#F5F1E8', color: '#1C2333', border: '1.5px solid transparent' }}
      />
      {otherScript(sr) ? (
        <p style={{ color: '#5C6690', fontSize: '0.78rem', marginBottom: 12 }}>
          Друго писмо: <span style={{ color: '#8892AE' }}>{otherScript(sr)}</span> — додаје се
          аутоматски, обе варијанте важе на картици.
        </p>
      ) : (
        <div style={{ marginBottom: 12 }} />
      )}

      <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
        ПРЕВОДИ (МОЖЕ ВИШЕ)
      </label>
      <div className="mt-1.5 mb-1">
        <VariantsEditor variants={ruVariants} onChange={setRuVariants} srWord={sr} />
      </div>
      <p style={{ color: '#5C6690', fontSize: '0.75rem', marginBottom: 20 }}>
        На картици ће се рачунати тачним било који од ових превода.
      </p>

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
          disabled={!canSubmit}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold flex items-center gap-2"
          style={{
            fontFamily: FONT_BODY,
            background: canSubmit ? '#C41E3A' : '#2A3355',
            color: canSubmit ? '#F5F1E8' : '#5C6690',
          }}
        >
          <Plus size={16} /> Додај реч
        </button>
        {justAdded && (
          <span style={{ color: '#7DC79A', fontSize: '0.85rem', fontFamily: FONT_BODY }}>
            Додато ✓
          </span>
        )}
      </div>
    </form>
  );
}
