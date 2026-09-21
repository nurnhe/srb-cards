// Fonts shared by every screen, and the hook that loads them from Google Fonts.
// Moved out of App.jsx unchanged.

import { useEffect } from 'react';

export const FONT_DISPLAY = "'PT Serif', Georgia, serif";
export const FONT_BODY = "'Inter', system-ui, sans-serif";
export const FONT_MONO = "'JetBrains Mono', monospace";

const FONT_LINK_ID = 'srb-flashcards-fonts';

export function useGoogleFonts() {
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
