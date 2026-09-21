// Moved out of App.jsx unchanged (part of the file split).

import { Check, X } from 'lucide-react';
import { FONT_MONO } from '../theme';

export function WordStats({ correct, wrong }) {
  const c = correct || 0;
  const w = wrong || 0;
  const total = c + w;
  if (total === 0) {
    return (
      <span style={{ fontFamily: FONT_MONO, fontSize: '0.65rem', color: '#4B5680' }}>
        неиспробано
      </span>
    );
  }
  const errorRate = w / total;
  const color = errorRate >= 0.5 ? '#E28B95' : errorRate > 0 ? '#D4A54A' : '#7DC79A';
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{ fontFamily: FONT_MONO, fontSize: '0.68rem', color }}
      title={`${c} тачно, ${w} нетачно`}
    >
      <Check size={11} /> {c} <X size={11} style={{ marginLeft: 2 }} /> {w}
    </span>
  );
}
