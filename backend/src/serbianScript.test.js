import { describe, it, expect } from 'vitest';
import { cyrillicToLatin, isCyrillic } from './serbianScript.js';

// These mirror src/logic.test.js's cyrillicToLatin/isCyrillic cases exactly —
// this file is a deliberate duplicate of that logic (see serbianScript.js's
// top comment), so the same test cases are what would catch the two copies
// drifting apart.
describe('isCyrillic', () => {
  it('detects Cyrillic text', () => {
    expect(isCyrillic('хвала')).toBe(true);
  });
  it('detects Latin text as not Cyrillic', () => {
    expect(isCyrillic('hvala')).toBe(false);
  });
});

describe('cyrillicToLatin', () => {
  it('converts basic words', () => {
    expect(cyrillicToLatin('хвала')).toBe('hvala');
  });

  it('handles digraphs nj/lj/dž', () => {
    expect(cyrillicToLatin('његов')).toBe('njegov');
    expect(cyrillicToLatin('љубав')).toBe('ljubav');
    expect(cyrillicToLatin('џак')).toBe('džak');
  });

  it('handles đ/č/ć/š/ž', () => {
    expect(cyrillicToLatin('ђак')).toBe('đak');
    expect(cyrillicToLatin('чај')).toBe('čaj');
    expect(cyrillicToLatin('ћирилица')).toBe('ćirilica');
    expect(cyrillicToLatin('шума')).toBe('šuma');
    expect(cyrillicToLatin('жуto')).toBe('žuto'); // guards against stray latin chars passing through
  });

  it('preserves capitalization, including digraph title-case', () => {
    expect(cyrillicToLatin('Његов')).toBe('Njegov');
    expect(cyrillicToLatin('ЊЕГОВ')).toBe('NJEGOV');
  });

  it('leaves empty/falsy input unchanged', () => {
    expect(cyrillicToLatin('')).toBe('');
  });
});
