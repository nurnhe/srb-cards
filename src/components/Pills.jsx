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

// A part-of-speech tag shown as a small badge rather than a full-size tag
// pill — used both where it's clickable (toggling it as a filter, like
// TagFilterPill) and where it's just shown next to a word with a way to
// remove it. Only one of onClick/onRemove is ever passed by a given caller;
// a single element can't be both a button and contain one (nested buttons
// are invalid HTML and don't click reliably), so which prop is given decides
// the shape.
export function PosBadge({ label, active, onClick, onRemove }) {
  const style = {
    fontFamily: FONT_MONO,
    fontSize: '0.68rem',
    padding: '2px 6px',
    lineHeight: 1.3,
    borderRadius: 5,
  };
  if (onRemove) {
    return (
      <span className="inline-flex items-center gap-1" style={{ ...style, color: '#5C6690', border: '1px solid #2A3355' }}>
        {label}
        <button type="button" onClick={onRemove} aria-label={`Уклони ${label}`} style={{ color: '#5C6690', lineHeight: 1 }}>
          ×
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...style,
        color: active ? '#12192E' : '#5C6690',
        background: active ? '#D4A54A' : 'transparent',
        border: `1px solid ${active ? '#D4A54A' : '#2A3355'}`,
      }}
    >
      {label}
    </button>
  );
}

// A thin vertical rule separating part-of-speech badges from ordinary tags in
// the same row.
export function TagRowDivider() {
  return <span style={{ width: 1, alignSelf: 'stretch', background: '#2A3355', margin: '0 2px' }} aria-hidden="true" />;
}

// "+N" — reveals the rest of a capped list of tags. Styled as a small dashed
// chip so it reads as part of the row instead of a separate stray link.
export function ShowMoreTagsButton({ count, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: FONT_MONO,
        fontSize: '0.68rem',
        padding: '2px 8px',
        lineHeight: 1.3,
        color: '#8892AE',
        border: '1px dashed #3A4570',
        borderRadius: 5,
        background: 'none',
      }}
    >
      {label || `+${count}`}
    </button>
  );
}
