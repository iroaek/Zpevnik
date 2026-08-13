import { isValidChordSymbol, normalizeSharpSpelling } from './chords.js';
import { sanitizeImportedText } from './chordpro.js';

interface PositionedChord {
  chord: string;
  position: number;
  order: number;
  target: boolean;
}

export interface ChordSourceIssue {
  kind: 'legacy-sharp' | 'unknown-marker' | 'stacked-chords' | 'control-character';
  line: number;
  message: string;
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

/** Vrátí bezpečné kontroly rozložení bez domýšlení chybějícího textu. */
export function inspectChordSource(source: string): ChordSourceIssue[] {
  const issues: ChordSourceIssue[] = [];
  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');
  for (const [lineIndex, line] of sanitizeImportedText(source).split('\n').entries()) {
    if (/\\u(?:00a0|[0-9a-f]{4})/i.test(rawLines[lineIndex] ?? line)) {
      issues.push({ kind: 'control-character', line: lineIndex + 1, message: 'Řádek obsahuje vypsanou Unicode escape sekvenci.' });
    }
    if (/\[(?:Cis|Dis|Eis|Fis|Gis|Ais|His)(?=$|[^A-Za-z])/i.test(line)
      || /\/(?:Cis|Dis|Eis|Fis|Gis|Ais|His)(?=\]|[^A-Za-z])/i.test(line)) {
      issues.push({ kind: 'legacy-sharp', line: lineIndex + 1, message: 'Řádek používá starší zápis akordu s „is“.' });
    }
    const markers = [...line.matchAll(/\[([^\]\n[]{1,64})\]/g)];
    for (const match of markers) {
      if (!chordNotation(match[1].trim())) {
        issues.push({ kind: 'unknown-marker', line: lineIndex + 1, message: `Nerozpoznaná značka [${match[1].trim()}].` });
      }
    }
    const positions = markers
      .filter((match) => chordNotation(match[1].trim()))
      .map((match) => match.index ?? 0);
    if (positions.some((position, index) => index > 0 && position - positions[index - 1] <= 1)) {
      issues.push({ kind: 'stacked-chords', line: lineIndex + 1, message: 'Dva akordy jsou umístěné prakticky na stejné pozici.' });
    }
  }
  return issues;
}

/** Normalizuje pouze platné akordové značky; text a metadata ponechá beze změny. */
export function normalizeChordSpellingsInSource(source: string): string {
  return sanitizeImportedText(source).replace(/\[([^\]\n[]{1,64})\]/g, (token, value: string) => {
    const candidate = value.trim();
    const notation = chordNotation(candidate);
    return notation ? `[${normalizeSharpSpelling(candidate, notation)}]` : token;
  });
}
