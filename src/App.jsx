import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Shuffle, Trash2, Check, X, ArrowLeftRight, BookMarked, Pencil, Link2, Search, Loader2, Tag, Volume2, Download, Upload } from 'lucide-react';
import { supabase } from './supabaseClient';
import {
  otherScript,
  normalize,
  parseVariants,
  buildWeightedDeck,
  requeueMissedWord,
  findDuplicateWord,
  isAnswerCorrect,
  isRelevantTranslationMatch,
  isPlausibleRussianText,
  suggestTagsFromRelatedWords,
  filterWordsByQuery,
  isTypoCorrected,
  findLikelyTypoOf,
  pickSerbianVoice,
  googleTranslateTtsUrl,
  buildExportData,
  parseImportData,
} from './logic';

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

// Best-effort lookup of related/derived words from English Wiktionary —
// Serbian is filed there under the merged "Serbo-Croatian" (sh) language
// section. CORS-enabled, no backend needed. Returns null if the word
// isn't found there at all, or has no Serbo-Croatian section, or has no
// related/derived terms listed — all expected fairly often, not a bug.
async function fetchRelatedWordsFromWiktionary(srWord) {
  const url = `https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(srWord)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
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

// Best-effort IPA pronunciation lookup, reusing the same Wiktionary REST
// endpoint/section as the related-words lookup above (a separate request,
// though, since this one fires opportunistically off the pronounce button
// rather than requiring a user to click "Прикажи повезане речи" first).
// Grabs the first IPA span in the Serbo-Croatian section rather than
// trying to disambiguate multiple etymologies — good enough for a
// best-effort hint, not meant to be exhaustive.
async function fetchIpaFromWiktionary(srWord) {
  const url = `https://en.wiktionary.org/api/rest_v1/page/html/${encodeURIComponent(srWord)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const heading = doc.getElementById('Serbo-Croatian');
  const section = heading?.closest('section');
  if (!section) return null;
  const ipaEl = section.querySelector('.IPA');
  const text = ipaEl?.textContent?.trim();
  return text || null;
}

// Best-effort translation suggestions (sr → ru) via the free, CORS-enabled
// MyMemory API. Returns a short list of distinct candidate translations —
// quality varies since it's crowdsourced/machine translation, so these are
// suggestions to review and pick from, not guaranteed-correct answers.
// Noisy matches (e.g. a Bible-translation sentence that happens to contain
// the queried word) are filtered out — see isRelevantTranslationMatch.
// Wrong-language results (MyMemory occasionally returns English despite
// the sr|ru langpair) are filtered out too — see isPlausibleRussianText.
async function fetchTranslationSuggestions(srWord) {
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
function getVoicesAsync() {
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

// Neither Google Translate's TTS audio nor the browser SpeechSynthesis
// fallback held up in testing — kept the code in place (a better free
// source may turn up later) but hidden behind this flag rather than
// deleted, per Kira's request. IPA text (below) is unaffected by this —
// it's a separate, always-on feature.
const AUDIO_PLAYBACK_ENABLED = false;

// Speaker button that plays a Serbian word's real pronunciation via
// Google Translate's TTS audio (see googleTranslateTtsUrl — unofficial
// endpoint, best-effort), falling back to the browser's SpeechSynthesis
// API only if that fails to play. Currently hidden — see
// AUDIO_PLAYBACK_ENABLED above.
function PronounceButton({ text, size = 15 }) {
  const [playState, setPlayState] = useState('idle'); // idle | loading | playing
  const [usedFallback, setUsedFallback] = useState(false);
  const [hasNativeVoice, setHasNativeVoice] = useState(true);

  // Per-word state shouldn't leak across cards in Practice, where this
  // component instance is reused as `text` changes underneath it.
  useEffect(() => {
    setPlayState('idle');
    setUsedFallback(false);
    window.speechSynthesis?.cancel();
  }, [text]);

  useEffect(() => {
    if (!AUDIO_PLAYBACK_ENABLED || !('speechSynthesis' in window)) return;
    let cancelled = false;
    getVoicesAsync().then((voices) => {
      if (!cancelled) setHasNativeVoice(!!pickSerbianVoice(voices));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!AUDIO_PLAYBACK_ENABLED || !text?.trim()) return null;
  const cleanText = text.trim();

  const speakViaBrowser = async () => {
    if (!('speechSynthesis' in window)) {
      setPlayState('idle');
      return;
    }
    setUsedFallback(true);
    const voices = await getVoicesAsync();
    const voice = pickSerbianVoice(voices);
    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = voice ? voice.lang : 'sr-RS';
    if (voice) utter.voice = voice;
    utter.onstart = () => setPlayState('playing');
    utter.onend = () => setPlayState('idle');
    utter.onerror = () => setPlayState('idle');
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  const play = (e) => {
    e.stopPropagation();
    setPlayState('loading');
    const audio = new Audio(googleTranslateTtsUrl(cleanText));
    audio.onplay = () => setPlayState('playing');
    audio.onended = () => setPlayState('idle');
    audio.onerror = () => speakViaBrowser();
    audio.play().catch(() => speakViaBrowser());
  };

  const title = usedFallback
    ? hasNativeVoice
      ? 'Изговори (резервни изговор — Google TTS није успео)'
      : 'Изговори (резервни изговор, нема српског гласа на овом уређају)'
    : 'Изговори';

  return (
    <button
      type="button"
      onClick={play}
      title={title}
      aria-label={`Изговори ${cleanText}`}
      style={{ color: playState !== 'idle' ? '#D4A54A' : '#8892AE', lineHeight: 0 }}
    >
      {playState === 'loading' ? <Loader2 size={size} className="animate-spin" /> : <Volume2 size={size} />}
    </button>
  );
}

// Cache of sr word (normalized) -> IPA text ('' = looked up, none found),
// shared across every IpaText instance for the life of the tab — the
// Words list alone can render 100+ of these, and repeat views of the
// same word in Practice shouldn't re-fetch.
const ipaCache = new Map();

// Shows a Serbian word's IPA transcription from Wiktionary — always on
// (no click needed), Serbian-only (Kira: "Transcription for Russian
// words is not needed"). Fetches lazily once the element actually
// scrolls into view rather than on mount, so the Words list doesn't fire
// 100+ simultaneous external requests the moment it renders. Also
// debounced, since this same component sits behind the live sr input on
// Add Word — without it, every keystroke while typing a word would fire
// its own Wiktionary request for that in-progress fragment. Shows
// nothing while loading or if no transcription was found — this is a
// best-effort bonus, not a required element.
function IpaText({ text, size = '0.75em' }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [ipa, setIpa] = useState(null); // null = not fetched yet, '' = none found
  const key = normalize(text || '');

  useEffect(() => {
    // The span (and thus ref.current) doesn't exist yet on the render
    // where text is still empty — re-run this once text shows up, not
    // just when `visible` itself changes, or the observer never gets
    // attached at all for a field that starts empty (e.g. Add Word's sr
    // input).
    if (!ref.current || visible) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible, key]);

  useEffect(() => {
    setIpa(null);
  }, [key]);

  useEffect(() => {
    if (!visible || !key || !text?.trim()) return;
    if (ipaCache.has(key)) {
      setIpa(ipaCache.get(key));
      return;
    }
    let cancelled = false;
    const debounce = setTimeout(() => {
      fetchIpaFromWiktionary(text.trim())
        .then((found) => {
          ipaCache.set(key, found || '');
          if (!cancelled) setIpa(found || '');
        })
        .catch(() => {
          ipaCache.set(key, '');
          if (!cancelled) setIpa('');
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [visible, key, text]);

  if (!text?.trim()) return null;

  return (
    <span ref={ref} style={{ fontFamily: FONT_MONO, fontSize: size, color: '#8892AE' }}>
      {ipa}
    </span>
  );
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
  const [tags, setTags] = useState([]);
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

  const attachTags = useCallback((wordRows, tagLinkRows) => {
    const map = {};
    (tagLinkRows || []).forEach((t) => {
      if (!map[t.word_id]) map[t.word_id] = [];
      map[t.word_id].push(t.tag_id);
    });
    return wordRows.map((w) => ({ ...w, tagIds: map[w.id] || [] }));
  }, []);

  const reloadAll = useCallback(async () => {
    const [wordsRes, linksRes, tagsRes, wordTagsRes] = await Promise.all([
      supabase
        .from('words')
        .select('id, sr, ru, example, correct_count, wrong_count')
        .order('created_at', { ascending: true }),
      supabase.from('word_links').select('word_id, related_word_id'),
      supabase.from('tags').select('id, name').order('name', { ascending: true }),
      supabase.from('word_tags').select('word_id, tag_id'),
    ]);
    if (wordsRes.error || linksRes.error || tagsRes.error || wordTagsRes.error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setTags(tagsRes.data || []);
    const withLinks = attachLinks(wordsRes.data || [], linksRes.data || []);
    setWords(attachTags(withLinks, wordTagsRes.data || []));
  }, [attachLinks, attachTags]);

  // load words + links + tags from Supabase on mount
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
      .select('id, sr, ru, example, correct_count, wrong_count')
      .single();
    if (error || !data) {
      setStorageError(true);
      return null;
    }
    setStorageError(false);
    const withDefaults = { ...data, relatedIds: [], tagIds: [] };
    setWords((prev) => [...prev, withDefaults]);
    return withDefaults;
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

  // Records a practice attempt for a word — increments correct_count or
  // wrong_count. Reads the current value from local state and writes it
  // back; fine for single-user use, not built for concurrent editors.
  const recordAnswer = useCallback(
    async (id, isCorrect) => {
      const word = words.find((w) => w.id === id);
      if (!word) return;
      const field = isCorrect ? 'correct_count' : 'wrong_count';
      const nextValue = (word[field] || 0) + 1;
      setWords((prev) => prev.map((w) => (w.id === id ? { ...w, [field]: nextValue } : w)));
      const { error } = await supabase.from('words').update({ [field]: nextValue }).eq('id', id);
      if (error) {
        console.error('Failed to save answer stats:', error);
        setStorageError(true);
      }
    },
    [words]
  );


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

  // Finds an existing tag by name (case-insensitive) or creates it.
  // Returns the tag id, or null on failure.
  const ensureTag = useCallback(
    async (name) => {
      const clean = name.trim().toLowerCase();
      if (!clean) return null;
      const existing = tags.find((t) => t.name.toLowerCase() === clean);
      if (existing) return existing.id;
      const { data, error } = await supabase.from('tags').insert({ name: clean }).select('id, name').single();
      if (error || !data) {
        setStorageError(true);
        return null;
      }
      setStorageError(false);
      setTags((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      return data.id;
    },
    [tags]
  );

  const tagWord = useCallback(
    async (wordId, tagName) => {
      const tagId = await ensureTag(tagName);
      if (!tagId) return;
      const { error } = await supabase
        .from('word_tags')
        .upsert([{ word_id: wordId, tag_id: tagId }], { onConflict: 'word_id,tag_id' });
      if (error) {
        setStorageError(true);
        return;
      }
      setStorageError(false);
      setWords((prev) =>
        prev.map((w) =>
          w.id === wordId && !w.tagIds.includes(tagId) ? { ...w, tagIds: [...w.tagIds, tagId] } : w
        )
      );
    },
    [ensureTag]
  );

  // Adds the main word, then any selected related words (e.g. picked from
  // the Wiktionary related-words list) — reusing an existing dictionary
  // entry instead of creating a duplicate where one already matches. A
  // translation is only required for words that need to be *created*; a
  // word that already exists just gets linked, using its existing
  // translation. Every word in the resulting group (main word + all
  // related words) is linked to every other one — a whole word family
  // added together should be mutually connected, not just each related
  // word linked back to the main word alone. Each tag has its own list of
  // which words in the group it applies to — different tags picked in
  // the same add can go to different subsets of the words, since e.g.
  // "verbs" might apply to the whole family while a more specific tag
  // only fits one of them.
  // relatedSelections: [{ sr, ru, tagNames: string[] }], mainTagNames: [string]
  const addWordWithRelated = useCallback(
    async (sr, ru, example, relatedSelections, mainTagNames) => {
      const mainWord = await addWord(sr, ru, example);
      if (!mainWord) return;
      const group = [mainWord];
      const relatedWithTags = [];
      for (const rel of relatedSelections || []) {
        const existing = findDuplicateWord(rel.sr, words);
        if (!existing && (!rel.ru || !rel.ru.trim())) continue;
        const relatedWord = existing || (await addWord(rel.sr, rel.ru, null));
        if (relatedWord) {
          group.push(relatedWord);
          relatedWithTags.push({ word: relatedWord, tagNames: rel.tagNames || [] });
        }
      }
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          await linkWords(group[i].id, group[j].id);
        }
      }
      for (const name of mainTagNames || []) {
        await tagWord(mainWord.id, name);
      }
      for (const { word, tagNames } of relatedWithTags) {
        for (const name of tagNames) {
          await tagWord(word.id, name);
        }
      }
    },
    [addWord, linkWords, tagWord, words]
  );

  // Imports a parsed JSON backup (see parseImportData). Deliberately
  // merge-only: an existing word (matched the same way duplicates are
  // caught elsewhere — either script) is never overwritten or deleted,
  // only skipped, so a bad or partial import can add data but can never
  // destroy any. Three passes so cross-references between entries in the
  // same file resolve regardless of order: all words first, then tags,
  // then links (both need every word to already have an id).
  const importWords = useCallback(
    async (parsedWords) => {
      const stats = { added: 0, skipped: 0, tagged: 0, linked: 0 };
      let known = words;
      const srToId = {};
      const resolveId = (srText) => {
        const norm = normalize(srText);
        const altNorm = normalize(otherScript(srText) || '');
        return srToId[norm] || (altNorm && srToId[altNorm]) || findDuplicateWord(srText, known)?.id || null;
      };

      for (const w of parsedWords) {
        const existingId = resolveId(w.sr);
        if (existingId) {
          srToId[normalize(w.sr)] = existingId;
          stats.skipped++;
          continue;
        }
        const created = await addWord(w.sr, w.ru, w.example);
        if (created) {
          known = [...known, created];
          srToId[normalize(w.sr)] = created.id;
          stats.added++;
        }
      }

      // Only apply tags/links actually missing — the DB-level upserts in
      // tagWord/linkWords are idempotent either way, but re-running them on
      // every already-tagged/already-linked word on a routine re-import
      // (e.g. importing your own just-made backup as a no-op sanity check)
      // would waste writes and make the summary numbers meaningless.
      const wordById = (id) => known.find((w) => w.id === id);
      const tagIdByName = (name) => tags.find((t) => t.name.toLowerCase() === name.trim().toLowerCase())?.id;
      const taggedThisRun = new Set();
      const linkedThisRun = new Set();

      for (const w of parsedWords) {
        const id = resolveId(w.sr);
        if (!id) continue;
        const word = wordById(id);
        for (const tagName of w.tags) {
          const key = `${id}:${tagName.trim().toLowerCase()}`;
          if (taggedThisRun.has(key)) continue;
          taggedThisRun.add(key);
          const existingTagId = tagIdByName(tagName);
          if (existingTagId && word?.tagIds?.includes(existingTagId)) continue;
          await tagWord(id, tagName);
          stats.tagged++;
        }
      }

      for (const w of parsedWords) {
        const id = resolveId(w.sr);
        if (!id) continue;
        const word = wordById(id);
        for (const relSr of w.relatedWords) {
          const relId = resolveId(relSr);
          if (!relId || relId === id) continue;
          const key = [id, relId].sort().join(':');
          if (linkedThisRun.has(key)) continue;
          linkedThisRun.add(key);
          if (word?.relatedIds?.includes(relId)) continue;
          await linkWords(id, relId);
          stats.linked++;
        }
      }

      return stats;
    },
    [words, tags, addWord, tagWord, linkWords]
  );

  const untagWord = useCallback(async (wordId, tagId) => {
    const { error } = await supabase
      .from('word_tags')
      .delete()
      .eq('word_id', wordId)
      .eq('tag_id', tagId);
    if (error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) =>
      prev.map((w) => (w.id === wordId ? { ...w, tagIds: w.tagIds.filter((tid) => tid !== tagId) } : w))
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
            {tab === 'practice' && <Practice words={words} tags={tags} onAnswer={recordAnswer} />}
            {tab === 'words' && (
              <WordsList
                words={words}
                tags={tags}
                onDelete={deleteWord}
                onUpdate={updateWord}
                onLink={linkWords}
                onUnlink={unlinkWords}
                onTag={tagWord}
                onUntag={untagWord}
                onImport={importWords}
              />
            )}
            {tab === 'add' && (
              <AddWord onAdd={addWordWithRelated} goToList={() => setTab('words')} words={words} tags={tags} />
            )}
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

function Practice({ words, tags, onAnswer }) {
  const [direction, setDirection] = useState('sr-ru'); // sr-ru: show SR, ask RU
  const [tagFilter, setTagFilter] = useState(new Set()); // Set of tag ids; empty = all
  const [current, setCurrent] = useState(null);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState(null); // null | 'correct' | 'wrong'
  const [typoForgiven, setTypoForgiven] = useState(false);
  const [session, setSession] = useState({ correct: 0, total: 0 });
  const inputRef = useRef(null);
  // "deck" of word ids not yet shown in the current cycle, weighted toward
  // words with more wrong answers — see buildWeightedDeck.
  const deckRef = useRef([]);

  // A word must have ALL selected tags (intersection), not just any one
  // of them — selecting more tags narrows the pool.
  const pool =
    tagFilter.size > 0 ? words.filter((w) => Array.from(tagFilter).every((id) => w.tagIds.includes(id))) : words;

  const drawNext = useCallback(
    (excludeId) => {
      if (pool.length === 0) return null;
      if (pool.length === 1) return pool[0];

      if (deckRef.current.length === 0) {
        let ids = buildWeightedDeck(pool);
        // avoid starting a new cycle with the same card that was just shown
        if (ids[0] === excludeId) {
          const swapIdx = ids.findIndex((id) => id !== excludeId);
          if (swapIdx > 0) [ids[0], ids[swapIdx]] = [ids[swapIdx], ids[0]];
        }
        deckRef.current = ids;
      }
      const nextId = deckRef.current.shift();
      return pool.find((w) => w.id === nextId) || null;
    },
    [pool]
  );

  // Identity that only changes when the actual *set* of words in the pool
  // changes (added/removed, or tag filter switched) — NOT when a word's
  // in-place fields (like correct_count/wrong_count) update after an
  // answer. Using `pool` itself as the effect dependency would reset the
  // deck and wipe feedback after every single answer, since answering
  // updates the words array too.
  const poolKey = pool.map((w) => w.id).join(',');

  useEffect(() => {
    // the set of words in the pool changed (loaded/added/removed, or tag
    // filter changed) — reset the deck so it's reshuffled, then draw a
    // fresh card
    deckRef.current = [];
    setCurrent(pool.length > 0 ? drawNext(null) : null);
    setInput('');
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey]);

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

  // words exist but the deck hasn't drawn a first card yet (happens for one
  // render right after mount/word-list changes, before the effect runs)
  if (!current) {
    if (pool.length === 0 && tagFilter.size > 0) {
      return (
        <div>
          <TagScopeBar tags={tags} tagFilter={tagFilter} onChange={setTagFilter} />
          <div
            className="text-center rounded-2xl py-16 px-6"
            style={{ background: '#1B2440', border: '1px solid #2A3355' }}
          >
            <p style={{ color: '#8892AE', fontSize: '0.9rem' }}>
              Нема речи са овим тагом за вежбање.
            </p>
          </div>
        </div>
      );
    }
    return null;
  }

  const prompt = direction === 'sr-ru' ? current.sr : current.ru;
  const promptLabel = direction === 'sr-ru' ? 'СРПСКИ' : 'РУССКИЙ';
  const answerLabel = direction === 'sr-ru' ? 'РУССКИЙ' : 'СРПСКИ';

  const checkAnswer = () => {
    if (!current || feedback) return;
    const isCorrect = isAnswerCorrect(direction, current, input);
    setFeedback(isCorrect ? 'correct' : 'wrong');
    setTypoForgiven(isCorrect && isTypoCorrected(direction, current, input));
    setSession((s) => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    onAnswer(current.id, isCorrect);
    if (!isCorrect) {
      // resurface this word again later in the *current* cycle, not just
      // the next one — see requeueMissedWord
      deckRef.current = requeueMissedWord(deckRef.current, current.id);
    }
  };

  const next = () => {
    setCurrent(drawNext(current?.id));
    setInput('');
    setFeedback(null);
    setTypoForgiven(false);
  };

  const switchDirection = (dir) => {
    setDirection(dir);
    setInput('');
    setFeedback(null);
    setTypoForgiven(false);
    setCurrent(drawNext(current?.id));
  };

  return (
    <div>
      <TagScopeBar tags={tags} tagFilter={tagFilter} onChange={setTagFilter} />

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
          className="flex items-center justify-center gap-2"
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: '2.1rem',
            color: '#1C2333',
            marginBottom: direction === 'sr-ru' && otherScript(current.sr) ? 4 : 28,
            wordBreak: 'break-word',
          }}
        >
          {prompt}
          {direction === 'sr-ru' && <PronounceButton text={current.sr} size={20} />}
        </div>
        {direction === 'sr-ru' && <IpaText text={current.sr} size="0.85rem" />}
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
            {feedback === 'correct' && typoForgiven && (
              <div style={{ color: '#6B6455', fontSize: '0.8rem' }}>
                (мали типфелер, прихваћено)
              </div>
            )}
            {feedback === 'wrong' && (
              <div className="flex items-center justify-center gap-1.5" style={{ color: '#6B6455', fontSize: '0.9rem' }}>
                Тачан одговор:{' '}
                <span style={{ fontWeight: 600, color: '#1C2333' }}>
                  {direction === 'sr-ru'
                    ? current.ru
                    : [current.sr, otherScript(current.sr)].filter(Boolean).join(' / ')}
                </span>
                {direction === 'ru-sr' && <PronounceButton text={current.sr} />}
                {direction === 'ru-sr' && <IpaText text={current.sr} />}
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

// tagFilter is a Set of tag ids — a word matches only if it has ALL of
// the selected tags, so checking multiple pills narrows the pool.
function TagScopeBar({ tags, tagFilter, onChange }) {
  if (!tags || tags.length === 0) return null;
  const toggle = (id) => {
    const next = new Set(tagFilter);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="flex flex-wrap justify-center gap-1.5 mb-4">
      <TagFilterPill active={tagFilter.size === 0} label="Све теме" onClick={() => onChange(new Set())} />
      {tags.map((t) => (
        <TagFilterPill key={t.id} active={tagFilter.has(t.id)} label={t.name} onClick={() => toggle(t.id)} />
      ))}
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

function WordStats({ correct, wrong }) {
  const c = correct || 0;
  const w = wrong || 0;
  const total = c + w;
  if (total === 0) {
    return (
      <span style={{ fontFamily: FONT_MONO, fontSize: '0.65rem', color: '#4B5680' }}>
        неиспробано
      </span>
    );
  }
  const errorRate = w / total;
  const color = errorRate >= 0.5 ? '#E28B95' : errorRate > 0 ? '#D4A54A' : '#7DC79A';
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ fontFamily: FONT_MONO, fontSize: '0.68rem', color }}
      title={`${c} тачно, ${w} нетачно`}
    >
      <Check size={11} /> {c} <X size={11} style={{ marginLeft: 2 }} /> {w}
    </span>
  );
}

function SortPill({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-full text-[0.68rem] font-semibold"
      style={{
        fontFamily: FONT_MONO,
        letterSpacing: 0.5,
        background: active ? '#2A3355' : 'transparent',
        color: active ? '#D4A54A' : '#5C6690',
      }}
    >
      {label}
    </button>
  );
}

function WordsList({ words, tags, onDelete, onUpdate, onLink, onUnlink, onTag, onUntag, onImport }) {
  const [editingId, setEditingId] = useState(null);
  const [editSr, setEditSr] = useState('');
  const [editRuVariants, setEditRuVariants] = useState([]);
  const [editExample, setEditExample] = useState('');
  const [linkingId, setLinkingId] = useState(null); // word currently picking a related word
  const [linkQuery, setLinkQuery] = useState('');
  const [taggingId, setTaggingId] = useState(null); // word currently picking/creating a tag
  const [tagQuery, setTagQuery] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState(new Set()); // Set of tag ids; empty = all
  const [sortMode, setSortMode] = useState('alpha'); // alpha | hardest
  const [searchQuery, setSearchQuery] = useState('');
  const [importState, setImportState] = useState('idle'); // idle | loading | error | done
  const [importMessage, setImportMessage] = useState('');
  const importFileRef = useRef(null);

  const exportBackup = () => {
    const data = buildExportData(words, tags);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `srb-cards-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file) => {
    setImportState('loading');
    setImportMessage('');
    const text = await file.text();
    const parsed = parseImportData(text);
    if (!parsed.valid) {
      setImportState('error');
      setImportMessage(parsed.error);
      return;
    }
    const stats = await onImport(parsed.words);
    setImportState('done');
    setImportMessage(
      `Додато: ${stats.added}. Прескочено (већ постоји): ${stats.skipped}. Тагова додато: ${stats.tagged}. Веза додато: ${stats.linked}.`
    );
  };

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

  const errorRate = (w) => {
    const total = (w.correct_count || 0) + (w.wrong_count || 0);
    if (total === 0) return -1; // untested words sort after tested-but-perfect ones
    return (w.wrong_count || 0) / total;
  };

  const sorted = [...words].sort((a, b) => {
    if (sortMode === 'hardest') {
      const diff = errorRate(b) - errorRate(a);
      if (diff !== 0) return diff;
      return (b.wrong_count || 0) - (a.wrong_count || 0);
    }
    return srCollator.compare(a.sr, b.sr);
  });
  // A word must have ALL selected tags (intersection), not just any one
  // of them — selecting more tags narrows the list.
  const filtered =
    activeTagFilter.size > 0
      ? sorted.filter((w) => Array.from(activeTagFilter).every((id) => w.tagIds.includes(id)))
      : sorted;
  const searched = filterWordsByQuery(filtered, searchQuery);
  const byId = Object.fromEntries(words.map((w) => [w.id, w]));
  const tagById = Object.fromEntries((tags || []).map((t) => [t.id, t]));

  const startEdit = (w) => {
    setEditingId(w.id);
    setEditSr(w.sr);
    setEditRuVariants(parseVariants(w.ru));
    setEditExample(w.example || '');
    setLinkingId(null);
    setTaggingId(null);
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
    setTaggingId(null);
  };

  const startTagging = (id) => {
    setTaggingId(id);
    setTagQuery('');
    setEditingId(null);
    setLinkingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1" style={{ paddingLeft: 4, paddingRight: 2 }}>
        <div
          style={{
            color: '#5C6690',
            fontSize: '0.72rem',
            fontFamily: FONT_MONO,
            letterSpacing: 1,
          }}
        >
          {words.length} {words.length === 1 ? 'РЕЧ' : 'РЕЧИ'}
        </div>
        <div className="flex gap-1">
          <SortPill active={sortMode === 'alpha'} label="А–Ш" onClick={() => setSortMode('alpha')} />
          <SortPill
            active={sortMode === 'hardest'}
            label="НАЈТЕЖЕ"
            onClick={() => setSortMode('hardest')}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mb-1" style={{ paddingLeft: 4 }}>
        <button
          type="button"
          onClick={exportBackup}
          className="flex items-center gap-1.5"
          style={{ fontFamily: FONT_MONO, fontSize: '0.72rem', color: '#8892AE' }}
        >
          <Download size={13} /> Извези резервну копију
        </button>
        <button
          type="button"
          onClick={() => importFileRef.current?.click()}
          disabled={importState === 'loading'}
          className="flex items-center gap-1.5"
          style={{ fontFamily: FONT_MONO, fontSize: '0.72rem', color: '#8892AE' }}
        >
          {importState === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Увези
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) importBackup(file);
          }}
        />
      </div>
      {importMessage && (
        <p
          style={{
            color: importState === 'error' ? '#E28B95' : '#8892AE',
            fontSize: '0.78rem',
            paddingLeft: 4,
            marginBottom: 4,
          }}
        >
          {importMessage}
        </p>
      )}

      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="претражи по српском или руском…"
        className="w-full rounded-lg px-3.5 py-2.5 mb-1 outline-none"
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: '0.95rem',
          background: '#F5F1E8',
          color: '#1C2333',
          border: '1.5px solid transparent',
        }}
      />

      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1" style={{ paddingLeft: 4 }}>
          <TagFilterPill
            active={activeTagFilter.size === 0}
            label="Све"
            onClick={() => setActiveTagFilter(new Set())}
          />
          {tags.map((t) => (
            <TagFilterPill
              key={t.id}
              active={activeTagFilter.has(t.id)}
              label={t.name}
              onClick={() =>
                setActiveTagFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(t.id)) next.delete(t.id);
                  else next.add(t.id);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}

      {searched.length === 0 && (
        <div style={{ color: '#5C6690', fontSize: '0.85rem', padding: '20px 4px' }}>
          {searchQuery.trim() ? `Нема речи за „${searchQuery.trim()}“.` : 'Нема речи са овим тагом.'}
        </div>
      )}

      {searched.map((w) => {
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
                {(() => {
                  // Compare against the full word list, including this
                  // word's own original spelling — editing "bakar" into
                  // "bokar" should catch the typo against bakar itself,
                  // not just against other, unrelated words. Only skip
                  // when nothing has actually changed yet.
                  if (normalize(editSr) === normalize(w.sr)) return null;
                  const typoOf = findLikelyTypoOf(editSr, words);
                  return (
                    typoOf && (
                      <p style={{ color: '#C9A24B', fontSize: '0.75rem' }}>
                        Можда си мислио/ла на <span style={{ color: '#F5F1E8', fontWeight: 600 }}>{typoOf.sr}</span>?
                      </p>
                    )
                  );
                })()}
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
                  <div className="flex items-center gap-1.5" style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1rem' }}>
                    {w.sr}
                    <PronounceButton text={w.sr} size={14} />
                    <IpaText text={w.sr} />
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
                  {w.tagIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {w.tagIds
                        .map((tid) => tagById[tid])
                        .filter(Boolean)
                        .map((t) => (
                          <span
                            key={t.id}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                            style={{
                              background: '#2A2410',
                              color: '#D4A54A',
                              fontSize: '0.72rem',
                              fontFamily: FONT_MONO,
                            }}
                          >
                            {t.name}
                            <button
                              onClick={() => onUntag(w.id, t.id)}
                              aria-label={`Уклони таг ${t.name}`}
                              style={{ color: '#9C7E30', lineHeight: 1 }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <WordStats correct={w.correct_count} wrong={w.wrong_count} />
                  <div className="flex gap-1">
                    <button
                      onClick={() => startTagging(w.id)}
                      className="p-2 rounded-md"
                      style={{ color: '#8892AE' }}
                      aria-label="Додај таг"
                      title="Додај таг"
                    >
                      <Tag size={15} />
                    </button>
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

            {taggingId === w.id && (
              <TagPicker
                word={w}
                allTags={tags || []}
                tagById={tagById}
                query={tagQuery}
                onQueryChange={setTagQuery}
                onPick={(name) => {
                  onTag(w.id, name);
                  setTagQuery('');
                }}
                onCancel={() => setTaggingId(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TagFilterPill({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-full text-xs"
      style={{
        fontFamily: FONT_MONO,
        background: active ? '#D4A54A' : '#1B2440',
        color: active ? '#12192E' : '#8892AE',
        border: active ? '1px solid #D4A54A' : '1px solid #2A3355',
      }}
    >
      {label}
    </button>
  );
}

function TagPicker({ word, allTags, tagById, query, onQueryChange, onPick, onCancel }) {
  const alreadyTagged = new Set(word.tagIds);
  const candidates = allTags
    .filter((t) => !alreadyTagged.has(t.id))
    .filter((t) => !query.trim() || t.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 6);

  const exactExists = allTags.some((t) => t.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="rounded-lg p-3" style={{ background: '#12192E', border: '1px solid #3A4570' }}>
      <div style={{ color: '#8892AE', fontSize: '0.78rem', marginBottom: 6 }}>
        Додај таг за <span style={{ color: '#F5F1E8', fontWeight: 600 }}>{word.sr}</span>:
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query.trim()) {
            e.preventDefault();
            onPick(query.trim());
          }
        }}
        placeholder="нпр. храна, глаголи…"
        className="w-full rounded-md px-3 py-1.5 text-sm outline-none mb-2"
        style={{ background: '#1B2440', color: '#F5F1E8', border: '1px solid #3A4570' }}
      />
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {candidates.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t.name)}
            className="text-left rounded-md px-2.5 py-1.5"
            style={{ background: '#1B2440', color: '#D4A54A', fontSize: '0.85rem' }}
          >
            {t.name}
          </button>
        ))}
        {query.trim() && !exactExists && (
          <button
            onClick={() => onPick(query.trim())}
            className="text-left rounded-md px-2.5 py-1.5"
            style={{ background: '#1B2440', color: '#7DC79A', fontSize: '0.85rem' }}
          >
            + направи нови таг „{query.trim()}"
          </button>
        )}
        {candidates.length === 0 && !query.trim() && (
          <div style={{ color: '#5C6690', fontSize: '0.8rem', padding: '4px 2px' }}>
            Још нема тагова — упиши да направиш први.
          </div>
        )}
      </div>
      <button
        onClick={onCancel}
        className="text-xs font-semibold rounded-md px-3 py-1.5 mt-2"
        style={{ background: '#2A3355', color: '#8892AE' }}
      >
        Затвори
      </button>
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

function AddWord({ onAdd, goToList, words, tags }) {
  const [sr, setSr] = useState('');
  const [ruVariants, setRuVariants] = useState([]);
  const [example, setExample] = useState('');
  const [justAdded, setJustAdded] = useState(false);
  const [lookupState, setLookupState] = useState('idle'); // idle | loading | notfound | error
  const [relatedWords, setRelatedWords] = useState([]);
  const [relatedState, setRelatedState] = useState('idle'); // idle | loading | notfound | error
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

  const addTagName = (name) => {
    const clean = name.trim().toLowerCase();
    if (!clean || selectedTagNames.includes(clean)) return;
    setSelectedTagNames((prev) => [...prev, clean]);
    setTagExclusions((prev) => ({ ...prev, [clean]: new Set() }));
    setTagQuery('');
  };

  const removeTagName = (name) => {
    setSelectedTagNames((prev) => prev.filter((t) => t !== name));
    setTagExclusions((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

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
    if (wasAlreadySelected || existing) return;
    try {
      const suggestions = await fetchTranslationSuggestions(word);
      setRelatedSelections((prev) =>
        prev[word] ? { ...prev, [word]: { ru: suggestions[0] || '', status: 'idle' } } : prev
      );
    } catch (e) {
      setRelatedSelections((prev) => (prev[word] ? { ...prev, [word]: { ru: '', status: 'idle' } } : prev));
    }
  };

  const setRelatedTranslation = (word, ru) => {
    setRelatedSelections((prev) => (prev[word] ? { ...prev, [word]: { ...prev[word], ru } } : prev));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!sr.trim() || ruVariants.length === 0 || duplicate) return;
    const relatedToAdd = Object.entries(relatedSelections).map(([relSr, sel]) => ({
      sr: relSr,
      ru: sel.ru,
      tagNames: selectedTagNames.filter((name) => !tagExclusions[name]?.has(relSr)),
    }));
    const mainTagNames = selectedTagNames.filter((name) => !tagExclusions[name]?.has('__main__'));
    onAdd(sr, ruVariants.join(', '), example, relatedToAdd, mainTagNames);
    setSr('');
    setRuVariants([]);
    setExample('');
    setLookupState('idle');
    setRelatedWords([]);
    setRelatedState('idle');
    setRelatedSelections({});
    setSelectedTagNames([]);
    setTagQuery('');
    setTagExclusions({});
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
    srRef.current?.focus();
  };

  const lookupRelatedWords = async () => {
    if (!sr.trim()) return;
    setRelatedState('loading');
    try {
      const found = await fetchRelatedWordsFromWiktionary(sr.trim());
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
      setRelatedWords([]);
      setRelatedState('error');
      setRelatedSelections({});
    }
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
            setSr(e.target.value);
            // the shown related-words list is only valid for the word it
            // was looked up for — clear it so stale results from a
            // previous word can't be mistaken for this one's
            setRelatedWords([]);
            setRelatedState('idle');
            setRelatedSelections({});
            setTagExclusions({});
          }}
          placeholder="нпр. хвала"
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
      <div style={{ marginBottom: 12 }} />

      <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
        ПРЕВОДИ (МОЖЕ ВИШЕ)
      </label>
      <div className="mt-1.5 mb-1">
        <VariantsEditor variants={ruVariants} onChange={setRuVariants} srWord={sr} />
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
          className="w-full rounded-lg px-3.5 py-2.5 mb-1.5 outline-none"
          style={{ fontFamily: FONT_DISPLAY, fontSize: '1rem', background: '#F5F1E8', color: '#1C2333', border: '1.5px solid transparent' }}
        />
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
