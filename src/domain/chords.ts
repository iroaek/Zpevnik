export type ChordNotation = 'czech' | 'international';
export type Accidental = 'natural' | 'sharp' | 'flat';

export interface CanonicalPitch {
  pitchClass: number;
  accidental: Accidental;
}

export interface CanonicalChord {
  root: CanonicalPitch;
  quality: string;
  extension: string;
  bassNote: CanonicalPitch | null;
}

const CZECH_NOTES: Record<string, CanonicalPitch> = {
  C: { pitchClass: 0, accidental: 'natural' },
  Cis: { pitchClass: 1, accidental: 'sharp' },
  'C#': { pitchClass: 1, accidental: 'sharp' },
  Des: { pitchClass: 1, accidental: 'flat' },
  Db: { pitchClass: 1, accidental: 'flat' },
  D: { pitchClass: 2, accidental: 'natural' },
  Dis: { pitchClass: 3, accidental: 'sharp' },
  'D#': { pitchClass: 3, accidental: 'sharp' },
  Es: { pitchClass: 3, accidental: 'flat' },
  Eb: { pitchClass: 3, accidental: 'flat' },
  E: { pitchClass: 4, accidental: 'natural' },
  F: { pitchClass: 5, accidental: 'natural' },
  Fis: { pitchClass: 6, accidental: 'sharp' },
  'F#': { pitchClass: 6, accidental: 'sharp' },
  Ges: { pitchClass: 6, accidental: 'flat' },
  Gb: { pitchClass: 6, accidental: 'flat' },
  G: { pitchClass: 7, accidental: 'natural' },
  Gis: { pitchClass: 8, accidental: 'sharp' },
  'G#': { pitchClass: 8, accidental: 'sharp' },
  As: { pitchClass: 8, accidental: 'flat' },
  Ab: { pitchClass: 8, accidental: 'flat' },
  A: { pitchClass: 9, accidental: 'natural' },
  Ais: { pitchClass: 10, accidental: 'sharp' },
  'A#': { pitchClass: 10, accidental: 'sharp' },
  B: { pitchClass: 10, accidental: 'flat' },
  Bb: { pitchClass: 10, accidental: 'flat' },
  H: { pitchClass: 11, accidental: 'natural' },
};

const INTERNATIONAL_NOTES: Record<string, CanonicalPitch> = {
  C: { pitchClass: 0, accidental: 'natural' },
  'C#': { pitchClass: 1, accidental: 'sharp' },
  Db: { pitchClass: 1, accidental: 'flat' },
  D: { pitchClass: 2, accidental: 'natural' },
  'D#': { pitchClass: 3, accidental: 'sharp' },
  Eb: { pitchClass: 3, accidental: 'flat' },
  E: { pitchClass: 4, accidental: 'natural' },
  F: { pitchClass: 5, accidental: 'natural' },
  'F#': { pitchClass: 6, accidental: 'sharp' },
  Gb: { pitchClass: 6, accidental: 'flat' },
  G: { pitchClass: 7, accidental: 'natural' },
  'G#': { pitchClass: 8, accidental: 'sharp' },
  Ab: { pitchClass: 8, accidental: 'flat' },
  A: { pitchClass: 9, accidental: 'natural' },
  'A#': { pitchClass: 10, accidental: 'sharp' },
  Bb: { pitchClass: 10, accidental: 'flat' },
  B: { pitchClass: 11, accidental: 'natural' },
};

const CZECH_SHARPS = ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'H'];
const CZECH_FLATS = ['C', 'Des', 'D', 'Es', 'E', 'F', 'Ges', 'G', 'As', 'A', 'B', 'H'];
const INTERNATIONAL_SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const INTERNATIONAL_FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function splitQuality(suffix: string): Pick<CanonicalChord, 'quality' | 'extension'> {
  const qualityMatch = suffix.match(/^(maj|min|dim|aug|sus|m|\+|−|-|°|ø)/i);
  if (!qualityMatch) return { quality: '', extension: suffix };
  return { quality: qualityMatch[0], extension: suffix.slice(qualityMatch[0].length) };
}

function matchNote(input: string, notation: ChordNotation): [CanonicalPitch, string] | null {
  const source = notation === 'czech' ? CZECH_NOTES : INTERNATIONAL_NOTES;
  if (notation === 'czech' && /^(?:A|E)sus/i.test(input)) {
    return [{ ...source[input[0]] }, input.slice(1)];
  }
  const names = Object.keys(source).sort((a, b) => b.length - a.length);
  const name = names.find((candidate) => input.startsWith(candidate));
  return name ? [{ ...source[name] }, input.slice(name.length)] : null;
}

export function parseChord(input: string, notation: ChordNotation): CanonicalChord | null {
  const clean = input.trim();
  const rootMatch = matchNote(clean, notation);
  if (!rootMatch) return null;
  const [root, rawSuffix] = rootMatch;
  const slashIndex = rawSuffix.lastIndexOf('/');
  if (slashIndex < 0) return { root, ...splitQuality(rawSuffix), bassNote: null };

  const bassOrExtension = rawSuffix.slice(slashIndex + 1);
  const bassMatch = matchNote(bassOrExtension, notation);
  if (bassMatch?.[1] === '') {
    return { root, ...splitQuality(rawSuffix.slice(0, slashIndex)), bassNote: bassMatch[0] };
  }
  if (/^\d{1,2}(?:[+#b-])?$/.test(bassOrExtension)) {
    return { root, ...splitQuality(rawSuffix), bassNote: null };
  }
  return null;
}

function normalizePitchClass(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function transposeCanonicalChord(chord: CanonicalChord, semitones: number): CanonicalChord {
  const transposePitch = (pitch: CanonicalPitch): CanonicalPitch => ({
    pitchClass: normalizePitchClass(pitch.pitchClass + semitones),
    accidental: pitch.accidental,
  });
  return {
    ...chord,
    root: transposePitch(chord.root),
    bassNote: chord.bassNote ? transposePitch(chord.bassNote) : null,
  };
}

export function renderPitch(
  pitch: CanonicalPitch,
  notation: ChordNotation,
  preference: 'sharp' | 'flat' = 'sharp',
): string {
  const table = notation === 'czech'
    ? (preference === 'flat' ? CZECH_FLATS : CZECH_SHARPS)
    : (preference === 'flat' ? INTERNATIONAL_FLATS : INTERNATIONAL_SHARPS);
  return table[normalizePitchClass(pitch.pitchClass)];
}

export function renderChord(
  chord: CanonicalChord,
  notation: ChordNotation,
  preference: 'sharp' | 'flat' = 'sharp',
): string {
  const root = renderPitch(chord.root, notation, preference);
  const suffix = `${chord.quality}${chord.extension}`;
  const bass = chord.bassNote ? `/${renderPitch(chord.bassNote, notation, preference)}` : '';
  return `${root}${suffix}${bass}`;
}

export function transposeChord(
  input: string,
  semitones: number,
  notation: ChordNotation,
  preference?: 'sharp' | 'flat',
): string {
  const parsed = parseChord(input, notation);
  if (!parsed) return input;
  const resolvedPreference = preference ?? (parsed.root.accidental === 'flat' ? 'flat' : 'sharp');
  return renderChord(transposeCanonicalChord(parsed, semitones), notation, resolvedPreference);
}

export function convertChordNotation(
  input: string,
  from: ChordNotation,
  to: ChordNotation,
): string {
  const parsed = parseChord(input, from);
  return parsed ? renderChord(parsed, to, parsed.root.accidental === 'flat' ? 'flat' : 'sharp') : input;
}

export function calculateCapoOptions(targetKey: string, notation: ChordNotation): Array<{ capo: number; shapeKey: string }> {
  const parsed = parseChord(targetKey, notation);
  if (!parsed) return [];
  const easyPitchClasses = new Set([0, 2, 4, 7, 9]);
  return Array.from({ length: 8 }, (_, capo) => {
    const shape = transposeCanonicalChord(parsed, -capo);
    return { capo, shapeKey: renderPitch(shape.root, notation) };
  })
    .filter(({ capo, shapeKey }) => capo === 0 || easyPitchClasses.has(parseChord(shapeKey, notation)?.root.pitchClass ?? -1))
    .slice(0, 4);
}
