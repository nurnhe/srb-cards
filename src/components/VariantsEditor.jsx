// Moved out of App.jsx unchanged (part of the file split).

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../theme';
import { fetchTranslationSuggestions } from '../wiktionary';
import { mergeVariants } from '../logic';

// Manages a list of accepted translation variants as chips: manual add,
// remove, plus one-click suggestions fetched from a translation API.
export function VariantsEditor({ variants, onChange, srWord }) {
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestState, setSuggestState] = useState('idle'); // idle | loading | notfound | error
  // srWord is a prop, not state this component sets itself — this ref tracks
  // its latest value (no deps, so it updates after every render) so suggest()
  // can tell a response apart from a newer request for a different word.
  const srWordRef = useRef(srWord);
  useEffect(() => {
    srWordRef.current = srWord;
  });

  const addVariant = (text) => {
    const next = mergeVariants(variants, text);
    if (next.length !== variants.length) onChange(next);
  };

  const removeVariant = (text) => {
    onChange(variants.filter((v) => v !== text));
  };

  const commitDraft = () => {
    addVariant(draft);
    setDraft('');
  };

  const suggest = async () => {
    const word = srWord.trim();
    if (!word) return;
    setSuggestState('loading');
    try {
      const found = await fetchTranslationSuggestions(word);
      // The word field may have moved on to a different word while this was
      // in flight — a slower, now-stale response must not overwrite
      // suggestions for whatever's showing now.
      if (srWordRef.current.trim() !== word) return;
      const fresh = found.filter((f) => !variants.some((v) => v.toLowerCase() === f.toLowerCase()));
      if (fresh.length === 0) {
        setSuggestState('notfound');
        setSuggestions([]);
      } else {
        setSuggestions(fresh);
        setSuggestState('idle');
      }
    } catch (e) {
      if (srWordRef.current.trim() !== word) return;
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
          autoComplete="off"
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
