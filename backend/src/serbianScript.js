// Converts Cyrillic Serbian text to Latin — deliberately duplicated from
// src/logic.js's cyrillicToLatin/isCyrillic rather than imported. The release
// Docker image's backend stage doesn't copy src/ (only backend/src and the
// built dist/ — see the Dockerfile), so a cross-directory import would work
// in dev but silently fail to deploy; a Dockerfile change to fix that has
// broken the hosting platform's build once already this project. Keep this
// file's two functions and CYR_TO_LAT table identical to src/logic.js's — if
// one changes (a new letter, a digraph fix), change both. Only the
// Cyrillic-to-Latin direction is needed here: sr is always saved as Latin, so
// the backend never needs to go the other way.

export const CYR_TO_LAT = [
  ['А', 'A'], ['Б', 'B'], ['В', 'V'], ['Г', 'G'], ['Д', 'D'], ['Ђ', 'Đ'],
  ['Е', 'E'], ['Ж', 'Ž'], ['З', 'Z'], ['И', 'I'], ['Ј', 'J'], ['К', 'K'],
  ['Л', 'L'], ['Љ', 'Lj'], ['М', 'M'], ['Н', 'N'], ['Њ', 'Nj'], ['О', 'O'],
  ['П', 'P'], ['Р', 'R'], ['С', 'S'], ['Т', 'T'], ['Ћ', 'Ć'], ['У', 'U'],
  ['Ф', 'F'], ['Х', 'H'], ['Ц', 'C'], ['Ч', 'Č'], ['Џ', 'Dž'], ['Ш', 'Š'],
];

const DIGRAPH_UPPER = { Lj: 'LJ', Nj: 'NJ', Dž: 'DŽ' };

export function cyrillicToLatin(str) {
  if (!str) return str;
  const isAllUpper = str === str.toUpperCase() && str !== str.toLowerCase();
  let out = '';
  for (const ch of str) {
    const upper = ch.toUpperCase();
    const isUpper = ch === upper && ch !== ch.toLowerCase();
    const pair = CYR_TO_LAT.find(([cyr]) => cyr === upper);
    if (!pair) {
      out += ch;
      continue;
    }
    let lat = pair[1];
    if (lat.length === 2) {
      if (isAllUpper) lat = DIGRAPH_UPPER[lat];
      else if (!isUpper) lat = lat.toLowerCase();
      // else: keep title-case ("Lj") for a standalone capital letter
    } else if (!isUpper) {
      lat = lat.toLowerCase();
    }
    out += lat;
  }
  return out;
}

export function isCyrillic(str) {
  return /[Ѐ-ӿ]/.test(str);
}
