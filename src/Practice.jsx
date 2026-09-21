// Moved out of App.jsx unchanged (part of the file split).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Timer, Check, X, Shuffle } from 'lucide-react';
import { FONT_DISPLAY, FONT_MONO, FONT_BODY } from './theme';
import { buildWeightedDeck, isAnswerCorrect, isTypoCorrected, requeueMissedWord, otherScript } from './logic';
import { DirectionPill, TagFilterPill } from './components/Pills';
import { PronounceButton } from './components/PronounceButton';
import { IpaText } from './components/IpaText';

/* ---------------- PRACTICE ---------------- */

const PRACTICE_TIMER_SECONDS = 30;
const TIMER_ENABLED_STORAGE_KEY = 'practiceTimerEnabled';

export function Practice({ words, tags, onAnswer }) {
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
