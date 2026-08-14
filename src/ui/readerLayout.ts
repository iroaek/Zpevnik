import type { ChordToken } from '../domain/chordpro';

export function mobileColumnPercent(columnWidth: number): number {
  const clampedWidth = Math.max(320, Math.min(980, columnWidth));
  return Math.round(84 + ((clampedWidth - 320) / 660) * 16);
}

export type ChordLinePart =
  | { kind: 'word'; tokens: ChordToken[] }
  | { kind: 'space'; text: string };

/**
 * Keeps complete lyric words together even when a ChordPro marker is placed
 * inside a word. The chord fragments still retain their precise position.
 */
export function groupChordTokensIntoWords(tokens: readonly ChordToken[]): ChordLinePart[] {
  const parts: ChordLinePart[] = [];
  let word: ChordToken[] = [];
  let pendingChord: Pick<ChordToken, 'chord' | 'sourceIndex'> | null = null;

  const flushWord = () => {
    if (word.length === 0) return;
    parts.push({ kind: 'word', tokens: word });
    word = [];
  };
  const flushPendingChord = () => {
    if (!pendingChord?.chord) return;
    flushWord();
    parts.push({ kind: 'word', tokens: [{ ...pendingChord, lyric: '' }] });
    pendingChord = null;
  };

  for (const token of tokens) {
    if (token.chord) {
      flushPendingChord();
      pendingChord = { chord: token.chord, sourceIndex: token.sourceIndex };
    }

    for (const text of token.lyric.match(/\s+|[^\s]+/g) ?? []) {
      if (/^\s+$/.test(text)) {
        flushWord();
        parts.push({ kind: 'space', text });
        continue;
      }
      word.push({
        chord: pendingChord?.chord ?? null,
        lyric: text,
        sourceIndex: pendingChord?.sourceIndex,
      });
      pendingChord = null;
    }
  }

  flushWord();
  flushPendingChord();
  return parts;
}
