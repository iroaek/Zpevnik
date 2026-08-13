import { isValidChordSymbol, normalizeSharpSpelling } from './chords.js';
import { sanitizeImportedText } from './chordpro.js';

interface PositionedChord {
  chord: string;
  position: number;
  order: number;
  target: boolean;
}

function chordNotation(chord: string): 'czech' | 'international' | null {
  if (isValidChordSymbol(chord, 'czech')) return 'czech';
  if (isValidChordSymbol(chord, 'international')) return 'international';
  return null;
}

function rebuildLine(lyrics: string, markers: PositionedChord[]): string {
  const sorted = [...markers].sort((left, right) => left.position - right.position || left.order - right.order);
  let cursor = 0;
  let output = '';
  for (const marker of sorted) {
    const position = Math.max(cursor, Math.min(lyrics.length, marker.position));
    output += lyrics.slice(cursor, position);
    output += `[${marker.chord}]`;
    cursor = position;
  }
  return `${output}${lyrics.slice(cursor)}`;
}

/**
 * Posune jeden konkrétní akord o počet znaků v rámci jeho textového řádku.
 * Metadata, ostatní řádky ani text písně se nemění. Výsledek je stále ChordPro.
 */
export function moveChordInSource(source: string, targetIndex: number, delta: number): string {
  if (!Number.isInteger(targetIndex) || !Number.isInteger(delta) || delta === 0) return sanitizeImportedText(source);
  let globalIndex = 0;
  let changed = false;
  const lines = sanitizeImportedText(source).split('\n').map((line) => {
    const matches = [...line.matchAll(/\[([^\]\n[]{1,64})\]/g)];
    let removedLength = 0;
    const markers: PositionedChord[] = [];
    for (const [order, match] of matches.entries()) {
      const candidate = match[1].trim();
      const notation = chordNotation(candidate);
      if (!notation) continue;
      const position = (match.index ?? 0) - removedLength;
      const target = globalIndex === targetIndex;
      markers.push({
        chord: normalizeSharpSpelling(candidate, notation),
        position,
        order,
        target,
      });
      globalIndex += 1;
      removedLength += match[0].length;
    }
    const target = markers.find((marker) => marker.target);
    if (!target) return line;
    const lyrics = line.replace(/\[([^\]\n[]{1,64})\]/g, (token, candidate: string) => chordNotation(candidate.trim()) ? '' : token);
    target.position = Math.max(0, Math.min(lyrics.length, target.position + delta));
    changed = true;
    return rebuildLine(lyrics, markers);
  });
  return changed ? lines.join('\n') : sanitizeImportedText(source);
}
