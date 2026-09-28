// Moved out of App.jsx (part of the ongoing file split — see the Notion
// backlog). All the words/tags/groups state and its mutation callbacks live
// here now, so App.jsx only has to render the shell and this hook can be
// exercised in tests without a browser.
import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from './api';
import { fetchPartsOfSpeechFromWiktionary } from './wiktionary';
import { otherScript, normalize, findDuplicateWord, wordsNeedingPartOfSpeech, describeSaveError } from './logic';

// authed: null (still checking) | false (signed out) | true (signed in) —
// same three-state value App.jsx derives from Supabase's own session.
export function useVocabulary(authed) {
  const [words, setWords] = useState([]);
  const [tags, setTags] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ready, setReady] = useState(false);
  // null when there's nothing to show; otherwise the specific message to
  // display — replaces a plain true/false flag so a failure says what
  // actually went wrong instead of one generic line every time.
  const [storageError, setStorageError] = useState(null);

  // Logging out (or a session going invalid) should drop back to the login
  // gate cleanly rather than showing stale data on the next sign-in.
  useEffect(() => {
    if (authed === false) {
      setReady(false);
      setWords([]);
      setTags([]);
      setGroups([]);
    }
  }, [authed]);

  const reloadAll = useCallback(async () => {
    // One request: the backend runs the four queries and stitches relatedIds
    // and tagIds onto each word.
    const { data, error } = await api.getVocabulary();
    if (error || !data) {
      setStorageError('Не могу да учитам речи. Покушајте поново.');
      // api.js already called supabase.auth.signOut() for a 401 before
      // resolving with this same "Unauthorized" error, which will flip
      // `authed` to false via the onAuthStateChange listener — tell the
      // caller so it doesn't flip the app to "ready" while that's pending.
      return { unauthorized: error?.message === 'Unauthorized' };
    }
    setStorageError(null);
    setTags(data.tags || []);
    setWords(data.words || []);
    setGroups(data.groups || []);
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
      setStorageError(describeSaveError(error, 'Не могу да сачувам реч.'));
      return null;
    }
    setStorageError(null);
    setWords((prev) => [...prev, data]);
    return data;
  }, []);

  const updateWord = useCallback(async (id, sr, ru, example) => {
    const { data, error } = await api.updateWord(id, sr, ru, example);
    if (error || !data) {
      setStorageError(describeSaveError(error, 'Не могу да сачувам измене.'));
      return null;
    }
    setStorageError(null);
    // Patch from the row the server saved — it is what lowercases sr/ru.
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, ...data } : w)));
    return data;
  }, []);

  // Records a practice attempt for a word — increments correct_count or
  // wrong_count. These are the signed-in person's own counts (word_progress),
  // even on a word shared with a group; the server bumps them in one step.
  const recordAnswer = useCallback(async (id, isCorrect) => {
    const field = isCorrect ? 'correct_count' : 'wrong_count';
    // Bump the count locally first so the card reacts instantly, then settle on
    // whatever the server actually saved.
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, [field]: (w[field] || 0) + 1 } : w)));
    const { data, error } = await api.recordAnswer(id, isCorrect);
    if (error || !data) {
      console.error('Failed to save answer stats:', error);
      setStorageError('Не могу да сачувам одговор.');
      // Nothing was actually saved — undo the optimistic bump so the local
      // count doesn't permanently overstate what's in the database.
      setWords((prev) =>
        prev.map((w) => (w.id === id ? { ...w, [field]: Math.max((w[field] || 0) - 1, 0) } : w))
      );
      return;
    }
    setStorageError(null);
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, ...data } : w)));
  }, []);

  const deleteWord = useCallback(async (id) => {
    const { error } = await api.deleteWord(id);
    if (error) {
      setStorageError('Не могу да обришем реч.');
      return;
    }
    setStorageError(null);
    setWords((prev) =>
      prev
        .filter((w) => w.id !== id)
        .map((w) => ({ ...w, relatedIds: w.relatedIds.filter((rid) => rid !== id) }))
    );
  }, []);

  // Returns whether the link was actually saved, so a caller doing several
  // of these in a row (addWordWithRelated, importWords) can tell if any one
  // of them failed — the shared storageError message alone can't, since a
  // later success in the same batch would otherwise clear an earlier
  // failure's message before the user ever saw it.
  const linkWords = useCallback(async (idA, idB) => {
    if (idA === idB) return true;
    const { error } = await api.linkWords(idA, idB);
    if (error) {
      setStorageError('Не могу да повежем речи.');
      return false;
    }
    setStorageError(null);
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
      setStorageError('Не могу да уклоним везу.');
      return;
    }
    setStorageError(null);
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
  // The most recent failed tag save's error, so a batch summary (see
  // addWordWithRelated) can name a too-long tag instead of just counting it.
  const lastTagError = useRef(null);
  const tagWord = useCallback(async (wordId, tagName) => {
    const { data, error } = await api.tagWord(wordId, tagName);
    if (error || !data?.tag) {
      lastTagError.current = error;
      setStorageError(describeSaveError(error, 'Не могу да додам таг.'));
      return false;
    }
    setStorageError(null);
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

  // Returns whether it actually saved — see linkWords' comment for why
  // callers doing several of these in a row (addWordWithRelated) need to
  // know, to fold failures into one summary message instead of several.
  // Declared before addWordWithRelated (below), which references it in its
  // own dependency array — a useCallback's deps are evaluated at render
  // time, so referencing a sibling const declared later in this same
  // function body throws "Cannot access before initialization".
  const shareWordToGroup = useCallback(async (wordId, groupId) => {
    const { error } = await api.shareWordToGroup(wordId, groupId);
    if (error) {
      setStorageError('Не могу да поделим реч са групом.');
      return false;
    }
    setStorageError(null);
    setWords((prev) =>
      prev.map((w) =>
        w.id === wordId && !w.groupIds.includes(groupId) ? { ...w, groupIds: [...w.groupIds, groupId] } : w
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
      // tagWord sets its own message on failure and clears it on success — in
      // a loop over many words, a later success would otherwise wipe out an
      // earlier failure's message before it's ever seen. Count failures
      // locally and set one summary message at the end instead.
      let failedTags = 0;
      for (let i = 0; i < todo.length; i++) {
        onProgress(i, todo.length);
        try {
          const names = await fetchPartsOfSpeechFromWiktionary(todo[i].sr);
          if (names.length === 0) {
            result.notFound.push(todo[i].sr);
          } else {
            let allSaved = true;
            for (const name of names) {
              if (!(await tagWord(todo[i].id, name))) {
                allSaved = false;
                failedTags += 1;
              }
            }
            if (allSaved) result.tagged += 1;
          }
        } catch (err) {
          result.stoppedEarly = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      onProgress(todo.length, todo.length);
      if (failedTags > 0) setStorageError(`Неке речи нису означене врстом (${failedTags}). Покушајте поново.`);
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
  // relatedSelections: [{ sr, ru, tagNames: string[] }], mainTagNames: [string],
  // groupIds: [string] — groups to share the MAIN word with (not any related
  // words created alongside it; the simplest reading of an otherwise
  // unspecified case, since group sharing has no per-related-word breakdown
  // the way tags do).
  const addWordWithRelated = useCallback(
    async (sr, ru, example, relatedSelections, mainTagNames, groupIds) => {
      const mainWord = await addWord(sr, ru, example);
      if (!mainWord) return false;
      lastTagError.current = null;
      // Tracks words created earlier in this same call (like importWords'
      // `known`) — checking against the closed-over `words` state alone
      // would miss a related word just created a few iterations ago, since
      // that state update hasn't landed yet, and create a duplicate row for
      // it if the same word appears twice in relatedSelections.
      let known = [...words, mainWord];
      const group = [mainWord];
      const created = [mainWord];
      const relatedWithTags = [];
      // Counted rather than just noted, so a failure here can say what
      // didn't save instead of the same generic line as every other failure
      // — this step makes one request per related word, link and tag, so
      // it's the one place in the app where several independent things can
      // fail in a single add.
      let failedRelatedWords = 0;
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
        } else if (!existing) {
          failedRelatedWords += 1;
        }
      }
      // linkWords/tagWord each set the shared storageError message on their
      // own success/failure — in a run of several calls, a later success
      // would otherwise silently clear an earlier failure's message before
      // anyone saw it. Count failures locally and set one summary message
      // at the end if anything in this batch didn't save.
      let failedLinks = 0;
      let failedTags = 0;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (!(await linkWords(group[i].id, group[j].id))) failedLinks += 1;
        }
      }
      for (const name of mainTagNames || []) {
        if (!(await tagWord(mainWord.id, name))) failedTags += 1;
      }
      for (const { word, tagNames } of relatedWithTags) {
        for (const name of tagNames) {
          if (!(await tagWord(word.id, name))) failedTags += 1;
        }
      }
      let failedGroups = 0;
      for (const groupId of groupIds || []) {
        if (!(await shareWordToGroup(mainWord.id, groupId))) failedGroups += 1;
      }
      if (failedRelatedWords || failedLinks || failedTags || failedGroups) {
        const parts = [];
        if (failedRelatedWords) parts.push(`${failedRelatedWords} сродних речи`);
        if (failedLinks) parts.push(`${failedLinks} веза`);
        if (failedTags) parts.push(`${failedTags} тагова`);
        if (failedGroups) parts.push(`${failedGroups} група`);
        const tagReason = failedTags ? describeSaveError(lastTagError.current, '') : '';
        setStorageError(`„${sr}“ је сачувана, али није све остало: ${parts.join(', ')}.${tagReason ? ` ${tagReason}` : ''}`);
      }
      // The main word's part of speech was already suggested on the form
      // while typing (and could be changed there); related words created
      // alongside it have no such field, so they are tagged here.
      created.slice(1).forEach((word) => {
        void autoTagPartOfSpeech(word);
      });
      return true;
    },
    [addWord, linkWords, tagWord, shareWordToGroup, autoTagPartOfSpeech, words]
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

      if (stats.failed > 0 || stats.failedWords > 0) {
        const parts = [];
        if (stats.failedWords) parts.push(`${stats.failedWords} речи`);
        if (stats.failed) parts.push(`${stats.failed} тагова/веза`);
        setStorageError(`Увоз није у потпуности сачуван: ${parts.join(', ')}.`);
      }
      return stats;
    },
    [words, tags, addWord, tagWord, linkWords]
  );

  const untagWord = useCallback(async (wordId, tagId) => {
    const { error } = await api.untagWord(wordId, tagId);
    if (error) {
      setStorageError('Не могу да уклоним таг.');
      return;
    }
    setStorageError(null);
    setWords((prev) =>
      prev.map((w) => (w.id === wordId ? { ...w, tagIds: w.tagIds.filter((tid) => tid !== tagId) } : w))
    );
  }, []);

  const unshareWordFromGroup = useCallback(async (wordId, groupId) => {
    const { error } = await api.unshareWordFromGroup(wordId, groupId);
    if (error) {
      setStorageError('Не могу да уклоним реч из групе.');
      return;
    }
    setStorageError(null);
    setWords((prev) =>
      prev.map((w) => (w.id === wordId ? { ...w, groupIds: w.groupIds.filter((gid) => gid !== groupId) } : w))
    );
  }, []);

  const createGroup = useCallback(async (name) => {
    const { data, error } = await api.createGroup(name);
    if (error || !data) {
      setStorageError(describeSaveError(error, 'Не могу да направим групу.'));
      return null;
    }
    setStorageError(null);
    setGroups((prev) => [...prev, data]);
    return data;
  }, []);

  const joinGroup = useCallback(async (code) => {
    const { data, error } = await api.joinGroup(code);
    if (error || !data) {
      setStorageError('Не могу да се придружим групи — проверите код.');
      return null;
    }
    setStorageError(null);
    setGroups((prev) => (prev.some((g) => g.id === data.id) ? prev : [...prev, data]));
    return data;
  }, []);

  // A word visible only through this group (not owned by me) needs to
  // actually disappear from `words` once I leave — reconciling that by hand
  // from existing state is fiddly and error-prone, a full reload is simplest.
  const leaveGroup = useCallback(
    async (groupId) => {
      const { error } = await api.leaveGroup(groupId);
      if (error) {
        setStorageError('Не могу да напустим групу.');
        return;
      }
      setStorageError(null);
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      await reloadAll();
    },
    [reloadAll]
  );

  return {
    words,
    tags,
    groups,
    ready,
    storageError,
    reloadAll,
    addWord,
    updateWord,
    recordAnswer,
    deleteWord,
    linkWords,
    unlinkWords,
    tagWord,
    untagWord,
    detectPartsOfSpeech,
    addWordWithRelated,
    importWords,
    shareWordToGroup,
    unshareWordFromGroup,
    createGroup,
    joinGroup,
    leaveGroup,
  };
}
