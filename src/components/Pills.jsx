// Moved out of App.jsx unchanged (part of the file split).

import { FONT_MONO } from '../theme';

export function DirectionPill({ active, label, onClick }) {
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

export function SortPill({ active, label, onClick }) {
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

export function TagFilterPill({ active, label, onClick }) {
  return (
    <button
      type="button"
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
