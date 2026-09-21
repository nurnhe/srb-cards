// Moved out of App.jsx unchanged (part of the file split).

import React, { useEffect, useRef, useState } from 'react';
import { FONT_MONO } from '../theme';
import { fetchIpaFromWiktionary } from '../wiktionary';
import { normalize } from '../logic';

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
export function IpaText({ text, size = '0.75em' }) {
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
          // Deliberately not cached — this was a transient failure (network
          // blip, Wiktionary briefly erroring), not a real "no IPA exists"
          // answer, and caching it here would suppress the display for this
          // word for the rest of the tab session with no way to retry.
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
