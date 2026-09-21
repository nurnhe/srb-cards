import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Shuffle, Trash2, Check, X, ArrowLeftRight, BookMarked, Pencil, Link2, Search, Loader2, Tag, Download, Upload, Table2, LogOut, Timer, Percent } from 'lucide-react';
import * as api from './api';
import {
  fetchExample,
  fetchRelatedWordsFromWiktionary,
  fetchPartsOfSpeechFromWiktionary,
  fetchInflectionTables,
  fetchTranslationSuggestions,
} from './wiktionary';
import { getSupabase } from './supabaseClient';
import { FONT_DISPLAY, FONT_BODY, FONT_MONO, useGoogleFonts } from './theme';
import { LoginGate, NewPasswordGate } from './Auth';
import { PronounceButton } from './components/PronounceButton';
import { IpaText } from './components/IpaText';
import { InflectionTables } from './components/InflectionTables';
import { VariantsEditor } from './components/VariantsEditor';
import { WordStats } from './components/WordStats';
import { DirectionPill, SortPill, TagFilterPill } from './components/Pills';
import {
  otherScript,
  normalize,
  parseVariants,
  buildWeightedDeck,
  requeueMissedWord,
  findDuplicateWord,
  isAnswerCorrect,
  suggestTagsFromRelatedWords,
  filterWordsByQuery,
  computeTagAccuracy,
  isTypoCorrected,
  findLikelyTypoOf,
  buildExportData,
  parseImportData,
  wordsNeedingPartOfSpeech,
} from './logic';

export default function App() {
  useGoogleFonts();

  const [words, setWords] = useState([]);
  const [tags, setTags] = useState([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [tab, setTab] = useState('practice');
  // Derived from Supabase's own session state rather than a synchronous
  // localStorage check — a session can't be confirmed valid without asking
  // Supabase, so this starts null ("still checking") until getSession()
  // resolves, then tracks onAuthStateChange from then on. authed itself
  // stays a plain boolean (not the session object) so effects keyed on it
  // don't refire on every silent token refresh (~every 55 min).
  const [authed, setAuthed] = useState(null);
  // Set while someone who followed an emailed link — a password reset, or an
  // invitation to a brand-new account — picks their password. Supabase signs
  // them in with a temporary session first. Read from the address as well as
  // from the auth event, because Supabase may announce the event before the
  // listener below exists (an invitation has no dedicated event at all).
  const [passwordFlow, setPasswordFlow] = useState(() => {
    const m = window.location.hash.match(/type=(recovery|invite)/);
    return m ? m[1] : null;
  });

  useEffect(() => {
    let cancelled = false;
    let subscription;
    getSupabase()
      .then(async (supabase) => {
        const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY') setPasswordFlow('recovery');
          setAuthed(!!session);
        });
        subscription = listener.subscription;
        if (cancelled) return subscription.unsubscribe();
        const { data } = await supabase.auth.getSession();
        if (!cancelled) setAuthed(!!data.session);
      })
      // Couldn't reach the server for the sign-in settings: show the login
      // form, which retries the same lookup when submitted.
      .catch(() => {
        if (!cancelled) setAuthed(false);
      });
    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  // Logging out (or a session going invalid) should drop back to the login
  // gate cleanly rather than showing stale data on the next sign-in.
  useEffect(() => {
    if (authed === false) {
      setReady(false);
      setWords([]);
      setTags([]);
    }
  }, [authed]);

  const reloadAll = useCallback(async () => {
    // One request: the backend runs the four queries and stitches relatedIds
    // and tagIds onto each word.
    const { data, error } = await api.getVocabulary();
    if (error || !data) {
      setStorageError(true);
      // api.js already called supabase.auth.signOut() for a 401 before
      // resolving with this same "Unauthorized" error, which will flip
      // `authed` to false via the onAuthStateChange listener — tell the
      // caller so it doesn't flip the app to "ready" while that's pending.
      return { unauthorized: error?.message === 'Unauthorized' };
    }
    setStorageError(false);
    setTags(data.tags || []);
    setWords(data.words || []);
    return { unauthorized: false };
  }, []);

  // load words + links + tags from the backend on mount, once authed
  useEffect(() => {
    if (!authed) return;
    (async () => {
      const { unauthorized } = await reloadAll();
      // Rendering the normal app shell here would flash it for one frame
      // right before the pending reload above actually navigates away.
      if (!unauthorized) setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const addWord = useCallback(async (sr, ru, example) => {
    const { data, error } = await api.createWord(sr, ru, example);
    if (error || !data) {
      setStorageError(true);
      return null;
    }
    setStorageError(false);
    setWords((prev) => [...prev, data]);
    return data;
  }, []);

  const updateWord = useCallback(async (id, sr, ru, example) => {
    const { data, error } = await api.updateWord(id, sr, ru, example);
    if (error || !data) {
      setStorageError(true);
      return null;
    }
    setStorageError(false);
    // Patch from the row the server saved — it is what lowercases sr/ru.
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, ...data } : w)));
    return data;
  }, []);

  // Records a practice attempt for a word — increments correct_count or
  // wrong_count. The backend reads the current value and writes it back; fine
  // for single-user use, not built for concurrent editors.
  const recordAnswer = useCallback(async (id, isCorrect) => {
    const field = isCorrect ? 'correct_count' : 'wrong_count';
    // Bump the count locally first so the card reacts instantly, then settle on
    // whatever the server actually saved.
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, [field]: (w[field] || 0) + 1 } : w)));
    const { data, error } = await api.recordAnswer(id, isCorrect);
    if (error || !data) {
      console.error('Failed to save answer stats:', error);
      setStorageError(true);
      // Nothing was actually saved — undo the optimistic bump so the local
      // count doesn't permanently overstate what's in the database.
      setWords((prev) =>
        prev.map((w) => (w.id === id ? { ...w, [field]: Math.max((w[field] || 0) - 1, 0) } : w))
      );
      return;
    }
    setStorageError(false);
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, ...data } : w)));
  }, []);

  const deleteWord = useCallback(async (id) => {
    const { error } = await api.deleteWord(id);
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

  // Returns whether the link was actually saved, so a caller doing several
  // of these in a row (addWordWithRelated, importWords) can tell if any one
  // of them failed — the global storageError flag alone can't, since a
  // later success in the same batch would otherwise clear an earlier
  // failure's flag before the user ever saw it.
  const linkWords = useCallback(async (idA, idB) => {
    if (idA === idB) return true;
    const { error } = await api.linkWords(idA, idB);
    if (error) {
      setStorageError(true);
      return false;
    }
    setStorageError(false);
    setWords((prev) =>
      prev.map((w) => {
        if (w.id === idA && !w.relatedIds.includes(idB)) return { ...w, relatedIds: [...w.relatedIds, idB] };
        if (w.id === idB && !w.relatedIds.includes(idA)) return { ...w, relatedIds: [...w.relatedIds, idA] };
        return w;
      })
    );
    return true;
  }, []);

  const unlinkWords = useCallback(async (idA, idB) => {
    const { error } = await api.unlinkWords(idA, idB);
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

  // Tags a word by name. The backend creates the tag if it does not exist yet
  // and tells us which tag it used, so we never guess an id here. Returns
  // whether it actually saved — see linkWords' comment for why callers
  // doing several of these in a row need to know.
  const tagWord = useCallback(async (wordId, tagName) => {
    const { data, error } = await api.tagWord(wordId, tagName);
    if (error || !data?.tag) {
      setStorageError(true);
      return false;
    }
    setStorageError(false);
    const { tag } = data;
    setTags((prev) =>
      prev.some((t) => t.id === tag.id)
        ? prev
        : [...prev, tag].sort((a, b) => a.name.localeCompare(b.name))
    );
    setWords((prev) =>
      prev.map((w) =>
        w.id === wordId && !w.tagIds.includes(tag.id) ? { ...w, tagIds: [...w.tagIds, tag.id] } : w
      )
    );
    return true;
  }, []);

  // Looks up a word's part of speech and tags it (glagol, imenica...). Runs in
  // the background after a word is saved and never gets in the way: a word
  // Wiktionary doesn't know, or a failed lookup, just leaves it untagged — the
  // "Одреди врсте речи" button in the Words tab can retry later.
  const autoTagPartOfSpeech = useCallback(
    async (word) => {
      try {
        const names = await fetchPartsOfSpeechFromWiktionary(word.sr);
        for (const name of names) await tagWord(word.id, name);
      } catch (err) {
        console.warn('Part-of-speech lookup failed:', err);
      }
    },
    [tagWord]
  );

  // The one-off pass for words already saved: goes through every word that
  // has no part-of-speech tag yet, one at a time so Wiktionary isn't hammered.
  // Safe to run again — words already tagged are skipped, so an interrupted
  // run just carries on where it stopped.
  const detectPartsOfSpeech = useCallback(
    async (onProgress) => {
      const todo = wordsNeedingPartOfSpeech(words, tags);
      const result = { total: todo.length, tagged: 0, notFound: [], stoppedEarly: false };
      for (let i = 0; i < todo.length; i++) {
        onProgress(i, todo.length);
        try {
          const names = await fetchPartsOfSpeechFromWiktionary(todo[i].sr);
          if (names.length === 0) {
            result.notFound.push(todo[i].sr);
          } else {
            let allSaved = true;
            for (const name of names) if (!(await tagWord(todo[i].id, name))) allSaved = false;
            if (allSaved) result.tagged += 1;
          }
        } catch (err) {
          result.stoppedEarly = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      onProgress(todo.length, todo.length);
      return result;
    },
    [words, tags, tagWord]
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
      if (!mainWord) return false;
      // Tracks words created earlier in this same call (like importWords'
      // `known`) — checking against the closed-over `words` state alone
      // would miss a related word just created a few iterations ago, since
      // that state update hasn't landed yet, and create a duplicate row for
      // it if the same word appears twice in relatedSelections.
      let known = [...words, mainWord];
      const group = [mainWord];
      const created = [mainWord];
      const relatedWithTags = [];
      for (const rel of relatedSelections || []) {
        const existing = findDuplicateWord(rel.sr, known);
        if (!existing && (!rel.ru || !rel.ru.trim())) continue;
        const relatedWord = existing || (await addWord(rel.sr, rel.ru, null));
        if (relatedWord) {
          if (!existing) {
            known = [...known, relatedWord];
            created.push(relatedWord);
          }
          group.push(relatedWord);
          relatedWithTags.push({ word: relatedWord, tagNames: rel.tagNames || [] });
        }
      }
      // linkWords/tagWord each set the shared storageError flag on their own
      // success/failure — in a run of several calls, a later success would
      // otherwise silently clear an earlier failure's flag before anyone
      // saw it. Track failures locally and restore the flag once at the end
      // if anything in this batch didn't save.
      let anyFailed = false;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (!(await linkWords(group[i].id, group[j].id))) anyFailed = true;
        }
      }
      for (const name of mainTagNames || []) {
        if (!(await tagWord(mainWord.id, name))) anyFailed = true;
      }
      for (const { word, tagNames } of relatedWithTags) {
        for (const name of tagNames) {
          if (!(await tagWord(word.id, name))) anyFailed = true;
        }
      }
      if (anyFailed) setStorageError(true);
      // The main word's part of speech was already suggested on the form
      // while typing (and could be changed there); related words created
      // alongside it have no such field, so they are tagged here.
      created.slice(1).forEach((word) => {
        void autoTagPartOfSpeech(word);
      });
      return true;
    },
    [addWord, linkWords, tagWord, autoTagPartOfSpeech, words]
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
      const stats = { added: 0, skipped: 0, tagged: 0, linked: 0, failed: 0, failedWords: 0 };
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
        } else {
          // Its tags and links are skipped below (no id to attach them to) —
          // counted, so the summary can say so instead of silently dropping it.
          stats.failedWords++;
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
          if (await tagWord(id, tagName)) stats.tagged++;
          else stats.failed++;
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
          if (await linkWords(id, relId)) stats.linked++;
          else stats.failed++;
        }
      }

      if (stats.failed > 0 || stats.failedWords > 0) setStorageError(true);
      return stats;
    },
    [words, tags, addWord, tagWord, linkWords]
  );

  const untagWord = useCallback(async (wordId, tagId) => {
    const { error } = await api.untagWord(wordId, tagId);
    if (error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) =>
      prev.map((w) => (w.id === wordId ? { ...w, tagIds: w.tagIds.filter((tid) => tid !== tagId) } : w))
    );
  }, []);

  // authed === null means the initial getSession() check hasn't resolved yet
  // — render nothing rather than flashing the login form for one frame.
  if (authed === null) return null;
  if (!authed) return <LoginGate />;
  if (passwordFlow) {
    return (
      <NewPasswordGate
        invite={passwordFlow === 'invite'}
        onDone={() => {
          // Drop the link's leftovers from the address so a reload doesn't
          // show this screen again.
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          setPasswordFlow(null);
        }}
      />
    );
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: '#12192E', fontFamily: FONT_BODY }}
    >
      <div className="max-w-2xl mx-auto px-5 py-8">
        <Header onLogout={async () => (await getSupabase()).auth.signOut()} />
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
                onDetectPartsOfSpeech={detectPartsOfSpeech}
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

function Header({ onLogout }) {
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
      <div className="flex-1">
        <h1
          style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1.5rem', lineHeight: 1.1 }}
        >
          речи <span style={{ color: '#C41E3A', fontStyle: 'italic' }}>&amp;</span> слова
        </h1>
        <p style={{ color: '#8892AE', fontSize: '0.8rem', marginTop: 2 }}>
          српски&nbsp;⇄&nbsp;руски речник
        </p>
      </div>
      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="p-2 rounded-lg shrink-0"
          style={{ color: '#8892AE' }}
          title="Одјава"
        >
          <LogOut size={18} />
        </button>
      )}
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

const PRACTICE_TIMER_SECONDS = 30;
const TIMER_ENABLED_STORAGE_KEY = 'practiceTimerEnabled';

function Practice({ words, tags, onAnswer }) {
  const [direction, setDirection] = useState('sr-ru'); // sr-ru: show SR, ask RU
  const [tagFilter, setTagFilter] = useState(new Set()); // Set of tag ids; empty = all
  const [current, setCurrent] = useState(null);
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState(null); // null | 'correct' | 'wrong'
  const [typoForgiven, setTypoForgiven] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [session, setSession] = useState({ correct: 0, total: 0 });
  // On by default but toggleable, and remembered across visits — a
  // preference this deliberate rather than something to re-decide every
  // session.
  const [timerEnabled, setTimerEnabled] = useState(() => {
    try {
      return localStorage.getItem(TIMER_ENABLED_STORAGE_KEY) !== 'false';
    } catch (e) {
      return true;
    }
  });
  const [timeLeft, setTimeLeft] = useState(PRACTICE_TIMER_SECONDS);
  const inputRef = useRef(null);
  // "deck" of word ids not yet shown in the current cycle, weighted toward
  // words with more wrong answers — see buildWeightedDeck.
  const deckRef = useRef([]);
  // Always holds the current render's `next` (defined further down, after
  // the pool/current early-returns) so the keydown listener below never
  // closes over a stale `current`/`drawNext`.
  const advanceRef = useRef(() => {});
  // Same reason as advanceRef — the timer's own interval below can't close
  // over a stale `current`/`feedback` from whichever render started it.
  const timeoutRef = useRef(() => {});

  const toggleTimer = () => {
    setTimerEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(TIMER_ENABLED_STORAGE_KEY, String(next));
      } catch (e) {
        // localStorage unavailable (private mode, etc.) — the toggle still
        // works for this session, it just won't be remembered next time.
      }
      return next;
    });
  };

  // Counts down regardless of typing activity, per the task's own answered
  // "open questions" — runs only while an answer is pending (not once
  // feedback is showing) and only when the timer is switched on. Restarts
  // for every new card since this effect re-runs whenever `current` or
  // `feedback` changes.
  useEffect(() => {
    if (!timerEnabled || feedback !== null || !current) return;
    setTimeLeft(PRACTICE_TIMER_SECONDS);
    // Tracks the count in a plain closure variable rather than reading it
    // back from state — calling handleTimeout (itself several setState
    // calls) from inside a setTimeLeft *updater* function isn't a reliably
    // supported pattern, and silently dropped the timeout entirely in
    // testing: the displayed countdown reached 0, but nothing else happened.
    let remaining = PRACTICE_TIMER_SECONDS;
    const interval = setInterval(() => {
      remaining -= 1;
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        timeoutRef.current();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [current, feedback, timerEnabled]);

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

  // Once feedback is shown, the answer input is gone — nothing is focused to
  // catch Enter anymore, so listen on the window instead. Only active while
  // feedback is showing. Backs off whenever something specific already has
  // focus (a tag pill, the direction toggle, a tab, the "Следећа реч" button
  // itself) so Enter still does whatever that control does, rather than the
  // global listener hijacking it — focus reverts to <body> right after the
  // answer input unmounts, which is what this actually listens for.
  useEffect(() => {
    if (feedback === null) return;
    const handleKeyDown = (e) => {
      if (e.key !== 'Enter') return;
      if (document.activeElement && document.activeElement !== document.body) return;
      e.preventDefault();
      advanceRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [feedback]);

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
    if (!current || feedback || !input.trim()) return;
    const isCorrect = isAnswerCorrect(direction, current, input);
    setFeedback(isCorrect ? 'correct' : 'wrong');
    setTypoForgiven(isCorrect && isTypoCorrected(direction, current, input));
    setTimedOut(false);
    setGaveUp(false);
    setSession((s) => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    onAnswer(current.id, isCorrect);
    if (!isCorrect) {
      // resurface this word again later in the *current* cycle, not just
      // the next one — see requeueMissedWord
      deckRef.current = requeueMissedWord(deckRef.current, current.id);
    }
  };

  // Same as a submitted wrong answer — counts against wrong_count and gets
  // requeued the same way — since letting a stalled card sit forever would
  // just quietly break the deck's own no-repeat guarantees, not because
  // running out the clock deserves the exact same treatment as guessing
  // wrong. `timedOut` only changes what the feedback screen *says*.
  const handleTimeout = () => {
    if (!current || feedback) return;
    setFeedback('wrong');
    setTypoForgiven(false);
    setTimedOut(true);
    setGaveUp(false);
    setSession((s) => ({ ...s, total: s.total + 1 }));
    onAnswer(current.id, false);
    deckRef.current = requeueMissedWord(deckRef.current, current.id);
  };
  timeoutRef.current = handleTimeout;

  // For "I know I don't know this" rather than guessing something just to
  // see the answer — typing a guess you know is wrong to reveal the answer
  // still worked before, but it's an odd thing to have to do, and either
  // way it's not a successful recall, so this is scored identically to a
  // submitted wrong answer (and to a timeout, above) for the same reason.
  const giveUp = () => {
    if (!current || feedback) return;
    setFeedback('wrong');
    setTypoForgiven(false);
    setTimedOut(false);
    setGaveUp(true);
    setSession((s) => ({ ...s, total: s.total + 1 }));
    onAnswer(current.id, false);
    deckRef.current = requeueMissedWord(deckRef.current, current.id);
  };

  const next = () => {
    setCurrent(drawNext(current?.id));
    setInput('');
    setFeedback(null);
    setTypoForgiven(false);
    setTimedOut(false);
    setGaveUp(false);
  };
  advanceRef.current = next;

  const switchDirection = (dir) => {
    setDirection(dir);
    setInput('');
    setFeedback(null);
    setTypoForgiven(false);
    setTimedOut(false);
    setGaveUp(false);
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
      <div className="flex items-center justify-center gap-2 mb-5">
        <span style={{ fontFamily: FONT_MONO, color: '#5C6690', fontSize: '0.8rem', letterSpacing: 1 }}>
          {session.correct} / {session.total} ТАЧНО У ОВОЈ СЕСИЈИ
        </span>
        <button
          type="button"
          onClick={toggleTimer}
          className="flex items-center gap-1 rounded-full px-2 py-0.5"
          style={{
            fontFamily: FONT_MONO,
            fontSize: '0.68rem',
            color: timerEnabled ? '#D4A54A' : '#4B5680',
            background: timerEnabled ? '#1B2440' : 'transparent',
            border: '1px solid #2A3355',
          }}
          title={timerEnabled ? 'Искључи тајмер (30с по картици)' : 'Укључи тајмер (30с по картици)'}
        >
          <Timer size={12} />
          {timerEnabled ? 'ВКЉ' : 'ИСКЉ'}
        </button>
      </div>

      {/* card */}
      <div
        className="rounded-2xl px-7 py-10 text-center relative overflow-hidden"
        style={{
          background: '#F5F1E8',
          border: feedback === 'correct' ? '2px solid #3D8B5F' : feedback === 'wrong' ? '2px solid #C41E3A' : '2px solid #2A3355',
        }}
      >
        {timerEnabled && feedback === null && (
          <div
            className="absolute flex items-center gap-1"
            style={{
              top: 14,
              right: 16,
              fontFamily: FONT_MONO,
              fontSize: '0.78rem',
              color: timeLeft <= 10 ? '#C41E3A' : '#8A8368',
            }}
          >
            <Timer size={13} />
            {timeLeft}с
          </div>
        )}
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
              onKeyDown={(e) => {
                // Stops this same keypress from also reaching the
                // feedback-screen advance listener below — otherwise the
                // Enter that submits the answer can double as the Enter
                // that skips past showing it.
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  checkAnswer();
                }
              }}
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
            <div className="flex items-center gap-2">
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
              <button
                type="button"
                onClick={giveUp}
                className="rounded-lg px-4 py-2.5 text-sm"
                style={{ fontFamily: FONT_BODY, color: '#9C9683', border: '1.5px solid #DCD6C4', background: 'transparent' }}
                title="Прикажи тачан одговор — рачуна се као нетачно"
              >
                Не знам
              </button>
            </div>
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
            {timedOut && (
              <div style={{ color: '#6B6455', fontSize: '0.8rem' }}>Истекло је време.</div>
            )}
            {gaveUp && (
              <div style={{ color: '#6B6455', fontSize: '0.8rem' }}>Нема везе, ево одговора.</div>
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

/* ---------------- WORDS LIST ---------------- */

const srCollator = new Intl.Collator('sr', { sensitivity: 'base' });

// Accuracy broken down by tag, using each word's own correct_count/
// wrong_count aggregated across every tag it carries — see
// computeTagAccuracy. Surfaces categories that need more practice, not
// just individual hard words.
function TagAccuracyPanel({ words, tags }) {
  const rows = computeTagAccuracy(words, tags);
  return (
    <div className="rounded-lg p-3 mb-1" style={{ background: '#12192E', border: '1px solid #3A4570' }}>
      {rows.length === 0 ? (
        <p style={{ color: '#8892AE', fontSize: '0.78rem' }}>
          Још нема довољно вежбања по таговима.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div key={r.tagId} className="flex items-center justify-between gap-3">
              <span style={{ fontFamily: FONT_MONO, fontSize: '0.78rem', color: '#D4A54A' }}>{r.name}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: '0.78rem', color: '#8892AE' }}>
                {Math.round(r.accuracy * 100)}% ({r.correct}/{r.total})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WordsList({ words, tags, onDelete, onUpdate, onLink, onUnlink, onTag, onUntag, onImport, onDetectPartsOfSpeech }) {
  const [editingId, setEditingId] = useState(null);
  const [editSr, setEditSr] = useState('');
  const [editRuVariants, setEditRuVariants] = useState([]);
  const [editExample, setEditExample] = useState('');
  const [linkingId, setLinkingId] = useState(null); // word currently picking a related word
  const [linkQuery, setLinkQuery] = useState('');
  const [taggingId, setTaggingId] = useState(null); // word currently picking/creating a tag
  const [tagQuery, setTagQuery] = useState('');
  const [inflectionId, setInflectionId] = useState(null); // word currently showing its declension/conjugation table
  const [inflectionTables, setInflectionTables] = useState(null);
  const [inflectionState, setInflectionState] = useState('idle'); // idle | loading | notfound | error
  const [deletingId, setDeletingId] = useState(null); // word currently showing its delete confirmation
  const [activeTagFilter, setActiveTagFilter] = useState(new Set()); // Set of tag ids; empty = all
  const [sortMode, setSortMode] = useState('alpha'); // alpha | hardest
  const [searchQuery, setSearchQuery] = useState('');
  const [importState, setImportState] = useState('idle'); // idle | loading | error | done
  const [importMessage, setImportMessage] = useState('');
  const [showTagAccuracy, setShowTagAccuracy] = useState(false);
  const [posState, setPosState] = useState('idle'); // idle | running | done | error
  const [posProgress, setPosProgress] = useState({ done: 0, total: 0 });
  const [posMessage, setPosMessage] = useState('');
  const importFileRef = useRef(null);

  const runPartOfSpeechDetection = async () => {
    if (posState === 'running') return;
    setPosState('running');
    setPosMessage('');
    setPosProgress({ done: 0, total: 0 });
    const result = await onDetectPartsOfSpeech((done, total) => setPosProgress({ done, total }));
    if (result.total === 0) {
      setPosState('done');
      setPosMessage('Све речи већ имају врсту.');
      return;
    }
    const parts = [`Означено: ${result.tagged} од ${result.total}.`];
    if (result.notFound.length > 0) {
      const shown = result.notFound.slice(0, 8).join(', ');
      parts.push(`Нема на Wiktionary-ју: ${result.notFound.length} (${shown}${result.notFound.length > 8 ? '…' : ''}).`);
    }
    if (result.stoppedEarly) parts.push('Прекинуто — Wiktionary није одговорио. Покушај поново касније, наставиће одакле је стало.');
    setPosState(result.stoppedEarly ? 'error' : 'done');
    setPosMessage(parts.join(' '));
  };

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
    try {
      const text = await file.text();
      const parsed = parseImportData(text);
      if (!parsed.valid) {
        setImportState('error');
        setImportMessage(parsed.error);
        return;
      }
      const stats = await onImport(parsed.words);
      setImportState(stats.failed > 0 || stats.failedWords > 0 ? 'error' : 'done');
      setImportMessage(
        `Додато: ${stats.added}. Прескочено (већ постоји): ${stats.skipped}. Тагова додато: ${stats.tagged}. Веза додато: ${stats.linked}.` +
          (stats.failedWords > 0
            ? ` Речи које нису сачуване: ${stats.failedWords} (њихови тагови и везе су прескочени). Покушај поново — речи које већ постоје се прескачу.`
            : '') +
          (stats.failed > 0 ? ` Није сачувано (грешка): ${stats.failed}.` : '')
      );
    } catch (e) {
      // A read/parse failure left this stuck at 'loading' forever before —
      // the import button stays disabled while loading, with no way out.
      setImportState('error');
      setImportMessage('Не могу да прочитам фајл.');
    }
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
    setInflectionId(null);
    setDeletingId(null);
  };

  const saveEdit = async () => {
    if (!editSr.trim() || editRuVariants.length === 0) {
      setEditingId(null);
      return;
    }
    // Keep the panel open on failure — closing it unconditionally made a
    // failed save look identical to a successful one, silently discarding
    // the edit with only the generic storage-error banner as a clue.
    const saved = await onUpdate(editingId, editSr, editRuVariants.join(', '), editExample);
    if (saved) setEditingId(null);
  };

  const startLinking = (id) => {
    // Clicking the icon for the word whose link panel is already open closes
    // it, same as the inflection-table toggle — otherwise it looked like a
    // close action but actually reopened the panel and silently wiped
    // whatever search query was already typed.
    if (linkingId === id) {
      setLinkingId(null);
      return;
    }
    setLinkingId(id);
    setLinkQuery('');
    setEditingId(null);
    setTaggingId(null);
    setInflectionId(null);
    setDeletingId(null);
  };

  const startTagging = (id) => {
    if (taggingId === id) {
      setTaggingId(null);
      return;
    }
    setTaggingId(id);
    setTagQuery('');
    setEditingId(null);
    setLinkingId(null);
    setInflectionId(null);
    setDeletingId(null);
  };

  // Toggles the declension/conjugation table for a word — reuses
  // fetchInflectionTables (same Wiktionary lookup as Add Word). Only one
  // word's table shows at a time, same pattern as edit/link/tag.
  const toggleInflection = async (id, sr) => {
    if (inflectionId === id) {
      setInflectionId(null);
      return;
    }
    setInflectionId(id);
    setEditingId(null);
    setLinkingId(null);
    setTaggingId(null);
    setDeletingId(null);
    setInflectionTables(null);
    setInflectionState('loading');
    try {
      const found = await fetchInflectionTables(sr);
      if (found) {
        setInflectionTables(found);
        setInflectionState('idle');
      } else {
        setInflectionTables(null);
        setInflectionState('notfound');
      }
    } catch (e) {
      setInflectionTables(null);
      setInflectionState('error');
    }
  };

  // Deleting is destructive and irreversible, unlike the other row actions —
  // clicking the trash icon opens an inline "are you sure?" instead of
  // deleting immediately, same toggle-to-close behavior as the other panels
  // if clicked again on the same word.
  const startDelete = (id) => {
    if (deletingId === id) {
      setDeletingId(null);
      return;
    }
    setDeletingId(id);
    setEditingId(null);
    setLinkingId(null);
    setTaggingId(null);
    setInflectionId(null);
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
        {onDetectPartsOfSpeech && (
          <button
            type="button"
            onClick={runPartOfSpeechDetection}
            disabled={posState === 'running'}
            className="flex items-center gap-1.5"
            style={{ fontFamily: FONT_MONO, fontSize: '0.72rem', color: '#8892AE' }}
            title="Потражи врсту речи (глагол, именица…) на Wiktionary-ју и додај таг свим речима које га немају"
          >
            {posState === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />}
            {posState === 'running' ? `${posProgress.done} / ${posProgress.total}` : 'Одреди врсте речи'}
          </button>
        )}
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
        {tags && tags.length > 0 && (
          <button
            type="button"
            onClick={() => setShowTagAccuracy((v) => !v)}
            className="flex items-center gap-1.5"
            style={{ fontFamily: FONT_MONO, fontSize: '0.72rem', color: showTagAccuracy ? '#D4A54A' : '#8892AE' }}
          >
            <Percent size={13} /> Тачност по тагу
          </button>
        )}
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
      {posMessage && (
        <p
          style={{
            color: posState === 'error' ? '#E28B95' : '#8892AE',
            fontSize: '0.78rem',
            paddingLeft: 4,
            marginBottom: 4,
          }}
        >
          {posMessage}
        </p>
      )}
      {showTagAccuracy && <TagAccuracyPanel words={words} tags={tags} />}

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
                      onClick={() => toggleInflection(w.id, w.sr)}
                      className="p-2 rounded-md"
                      style={{ color: inflectionId === w.id ? '#D4A54A' : '#8892AE' }}
                      aria-label="Прикажи промене по падежима/лицима"
                      title="Прикажи промене по падежима/лицима (Wiktionary, може не наћи ништа)"
                    >
                      <Table2 size={15} />
                    </button>
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
                      onClick={() => startDelete(w.id)}
                      className="p-2 rounded-md"
                      style={{ color: deletingId === w.id ? '#F5F1E8' : '#C41E3A', background: deletingId === w.id ? '#C41E3A' : 'transparent' }}
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

            {inflectionId === w.id && (
              <div className="rounded-lg p-3" style={{ background: '#12192E', border: '1px solid #3A4570' }}>
                {inflectionState === 'loading' && (
                  <p className="flex items-center gap-1.5" style={{ color: '#8892AE', fontSize: '0.78rem' }}>
                    <Loader2 size={13} className="animate-spin" /> тражим…
                  </p>
                )}
                {inflectionState === 'notfound' && (
                  <p style={{ color: '#8892AE', fontSize: '0.78rem' }}>
                    Ништа нађено на Wiktionary-ју — реч можда тамо не постоји или нема наведену табелу.
                  </p>
                )}
                {inflectionState === 'error' && (
                  <p style={{ color: '#8892AE', fontSize: '0.78rem' }}>Претрага тренутно није доступна.</p>
                )}
                {inflectionState === 'idle' && inflectionTables && <InflectionTables tables={inflectionTables} />}
              </div>
            )}

            {deletingId === w.id && (
              // Stacked vertically rather than side-by-side with the buttons —
              // a horizontal layout squeezed the message into an awkwardly
              // narrow column on phone-width screens, wrapping one or two
              // words per line.
              <div className="flex flex-col gap-3 rounded-lg p-3" style={{ background: '#2A1218', border: '1px solid #C41E3A' }}>
                <p style={{ color: '#F5F1E8', fontSize: '0.85rem' }}>
                  Обрисати <strong>{w.sr}</strong>? Ово укључује њене тагове, везе и статистику, и не може се
                  опозвати.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDeletingId(null)}
                    className="rounded-lg px-3 py-1.5"
                    style={{ fontFamily: FONT_BODY, fontSize: '0.85rem', color: '#8892AE', background: '#12192E', border: '1px solid #2A3355' }}
                  >
                    Откажи
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(w.id);
                      setDeletingId(null);
                    }}
                    className="rounded-lg px-3 py-1.5"
                    style={{ fontFamily: FONT_BODY, fontSize: '0.85rem', color: '#F5F1E8', background: '#C41E3A' }}
                  >
                    Да, обриши
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TagPicker({ word, allTags, tagById, query, onQueryChange, onPick, onCancel }) {
  const alreadyTagged = new Set(word.tagIds);
  const q = query.trim().toLowerCase();
  const candidates = allTags
    .filter((t) => !alreadyTagged.has(t.id))
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .slice(0, 6);

  // A tag matching exactly what's typed, whether or not it's already on
  // this word — distinct from "no such tag exists at all", which is what
  // decides whether to offer creating a new one.
  const matchingTag = q ? allTags.find((t) => t.name.toLowerCase() === q) : null;
  const alreadyAppliedExact = matchingTag && alreadyTagged.has(matchingTag.id);

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
          // Previously fired regardless of alreadyAppliedExact, sending a
          // pointless (if harmless) network request to re-apply a tag
          // that's already there.
          if (e.key === 'Enter' && query.trim() && !alreadyAppliedExact) {
            e.preventDefault();
            onPick(query.trim());
          }
        }}
        placeholder="нпр. храна, глаголи…"
        autoComplete="off"
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
        {alreadyAppliedExact && (
          // Previously a silent dead end: candidates excludes already-
          // applied tags and the old exactExists check (against ALL tags)
          // also hid the "create new" option here, leaving nothing shown.
          <div style={{ color: '#5C6690', fontSize: '0.8rem', padding: '4px 2px' }}>
            Тај таг је већ додат.
          </div>
        )}
        {query.trim() && !matchingTag && (
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
