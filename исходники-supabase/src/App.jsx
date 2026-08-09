import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Shuffle, Trash2, Check, X, ArrowLeftRight, BookMarked, Pencil } from 'lucide-react';
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

export default function App() {
  useGoogleFonts();

  const [words, setWords] = useState([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [tab, setTab] = useState('practice');

  // load all words from Supabase on mount
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('words')
        .select('id, sr, ru')
        .order('created_at', { ascending: true });
      if (error) {
        setStorageError(true);
      } else {
        setWords(data || []);
      }
      setReady(true);
    })();
  }, []);

  const addWord = useCallback(async (sr, ru) => {
    const { data, error } = await supabase
      .from('words')
      .insert({ sr: sr.trim(), ru: ru.trim() })
      .select('id, sr, ru')
      .single();
    if (error || !data) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) => [...prev, data]);
  }, []);

  const updateWord = useCallback(async (id, sr, ru) => {
    const { error } = await supabase
      .from('words')
      .update({ sr: sr.trim(), ru: ru.trim() })
      .eq('id', id);
    if (error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, sr: sr.trim(), ru: ru.trim() } : w)));
  }, []);

  const deleteWord = useCallback(async (id) => {
    const { error } = await supabase.from('words').delete().eq('id', id);
    if (error) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setWords((prev) => prev.filter((w) => w.id !== id));
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
              <WordsList words={words} onDelete={deleteWord} onUpdate={updateWord} />
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
    const target = direction === 'sr-ru' ? current.ru : current.sr;
    const isCorrect = acceptedAnswers(target).includes(normalize(input));
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
            marginBottom: 28,
            wordBreak: 'break-word',
          }}
        >
          {prompt}
        </div>

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
                  {direction === 'sr-ru' ? current.ru : current.sr}
                </span>
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

function WordsList({ words, onDelete, onUpdate }) {
  const [editingId, setEditingId] = useState(null);
  const [editSr, setEditSr] = useState('');
  const [editRu, setEditRu] = useState('');

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

  const startEdit = (w) => {
    setEditingId(w.id);
    setEditSr(w.sr);
    setEditRu(w.ru);
  };

  const saveEdit = () => {
    if (editSr.trim() && editRu.trim()) {
      onUpdate(editingId, editSr, editRu);
    }
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {[...words].reverse().map((w) => (
        <div
          key={w.id}
          className="rounded-xl px-4 py-3 flex items-center gap-3"
          style={{ background: '#1B2440', border: '1px solid #2A3355' }}
        >
          {editingId === w.id ? (
            <div className="flex-1 flex flex-col gap-2">
              <input
                value={editSr}
                onChange={(e) => setEditSr(e.target.value)}
                className="rounded-md px-3 py-1.5 text-sm outline-none"
                style={{ background: '#12192E', color: '#F5F1E8', border: '1px solid #3A4570' }}
                placeholder="српски"
              />
              <input
                value={editRu}
                onChange={(e) => setEditRu(e.target.value)}
                className="rounded-md px-3 py-1.5 text-sm outline-none"
                style={{ background: '#12192E', color: '#F5F1E8', border: '1px solid #3A4570' }}
                placeholder="руски"
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
            <>
              <div className="flex-1 min-w-0">
                <div style={{ fontFamily: FONT_DISPLAY, color: '#F5F1E8', fontSize: '1rem' }}>
                  {w.sr}
                </div>
                <div style={{ color: '#8892AE', fontSize: '0.85rem', marginTop: 1 }}>{w.ru}</div>
              </div>
              <button
                onClick={() => startEdit(w)}
                className="p-2 rounded-md shrink-0"
                style={{ color: '#8892AE' }}
                aria-label="Уреди"
              >
                <Pencil size={15} />
              </button>
              <button
                onClick={() => onDelete(w.id)}
                className="p-2 rounded-md shrink-0"
                style={{ color: '#C41E3A' }}
                aria-label="Обриши"
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- ADD WORD ---------------- */

function AddWord({ onAdd, goToList }) {
  const [sr, setSr] = useState('');
  const [ru, setRu] = useState('');
  const [justAdded, setJustAdded] = useState(false);
  const srRef = useRef(null);

  const submit = (e) => {
    e.preventDefault();
    if (!sr.trim() || !ru.trim()) return;
    onAdd(sr, ru);
    setSr('');
    setRu('');
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
    srRef.current?.focus();
  };

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
        className="w-full rounded-lg px-3.5 py-2.5 mt-1.5 mb-4 outline-none"
        style={{ fontFamily: FONT_DISPLAY, fontSize: '1.05rem', background: '#F5F1E8', color: '#1C2333', border: '1.5px solid transparent' }}
      />

      <label style={{ color: '#8892AE', fontSize: '0.8rem', fontFamily: FONT_MONO, letterSpacing: 0.5 }}>
        РУССКИЙ ПЕРЕВОД
      </label>
      <input
        value={ru}
        onChange={(e) => setRu(e.target.value)}
        placeholder="напр. спасибо"
        className="w-full rounded-lg px-3.5 py-2.5 mt-1.5 mb-1.5 outline-none"
        style={{ fontFamily: FONT_DISPLAY, fontSize: '1.05rem', background: '#F5F1E8', color: '#1C2333', border: '1.5px solid transparent' }}
      />
      <p style={{ color: '#5C6690', fontSize: '0.75rem', marginBottom: 20 }}>
        Можете унети неколико прихватљивих превода одвојених зарезом.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!sr.trim() || !ru.trim()}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold flex items-center gap-2"
          style={{
            fontFamily: FONT_BODY,
            background: sr.trim() && ru.trim() ? '#C41E3A' : '#2A3355',
            color: sr.trim() && ru.trim() ? '#F5F1E8' : '#5C6690',
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
