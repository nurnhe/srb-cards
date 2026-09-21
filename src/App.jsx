import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shuffle, Check, X, ArrowLeftRight, BookMarked, LogOut, Timer } from 'lucide-react';
import * as api from './api';
import {
  fetchPartsOfSpeechFromWiktionary,
} from './wiktionary';
import { getSupabase } from './supabaseClient';
import { FONT_DISPLAY, FONT_BODY, FONT_MONO, useGoogleFonts } from './theme';
import { LoginGate, NewPasswordGate } from './Auth';
import { WordsList } from './WordsList';
import { AddWord } from './AddWord';
import { PronounceButton } from './components/PronounceButton';
import { IpaText } from './components/IpaText';
import { DirectionPill, TagFilterPill } from './components/Pills';
import {
  otherScript,
  normalize,
  buildWeightedDeck,
  requeueMissedWord,
  findDuplicateWord,
  isAnswerCorrect,
  isTypoCorrected,
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

