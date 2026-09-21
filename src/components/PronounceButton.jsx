// Moved out of App.jsx unchanged (part of the file split).

import React, { useEffect, useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { getVoicesAsync } from '../wiktionary';
import { pickSerbianVoice, googleTranslateTtsUrl } from '../logic';

// Neither Google Translate's TTS audio nor the browser SpeechSynthesis
// fallback held up in testing — kept the code in place (a better free
// source may turn up later) but hidden behind this flag rather than
// deleted, per Kira's request. IPA text (below) is unaffected by this —
// it's a separate, always-on feature.
export const AUDIO_PLAYBACK_ENABLED = false;

// Speaker button that plays a Serbian word's real pronunciation via
// Google Translate's TTS audio (see googleTranslateTtsUrl — unofficial
// endpoint, best-effort), falling back to the browser's SpeechSynthesis
// API only if that fails to play. Currently hidden — see
// AUDIO_PLAYBACK_ENABLED above.
export function PronounceButton({ text, size = 15 }) {
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
