import { describe, expect, it } from 'vitest';
import { convertLayoutTextToChordPro, looksLikeChordLine, recognizedChord } from './layoutToChordPro';

describe('převod rozvrženého textu na ChordPro', () => {
  it('pozná české akordy, přípony i lomený bas a odmítne běžná slova', () => {
    expect(recognizedChord('Hmi7', 'czech')).toBe('Hmi7');
    expect(recognizedChord('Fis7/H', 'czech')).toBe('Fis7/H');
    expect(recognizedChord('Ahoj', 'czech')).toBeNull();
    expect(looksLikeChordLine('C   G7   Ami   F', 'czech')).toBe(true);
    expect(looksLikeChordLine('A tak jdeme dál', 'czech')).toBe(false);
  });

  it('vloží akordy na původní pozice a zachová pouze dodaný text', () => {
    const result = convertLayoutTextToChordPro([
      'Syntetická píseň',
      'Testovací autor',
      '',
      'C       G7',
      'Vymyšlená věta',
      'Ami     F',
      'Druhý testovací řádek',
    ].join('\n'), { title: 'Syntetická píseň', artist: 'Testovací autor', sourceNotation: 'czech' });
    expect(result.chordPro).toContain('[C]Vymyšlen[G7]á věta');
    expect(result.chordPro).toContain('[Ami]Druhý te[F]stovací řádek');
    expect(result.chordPro).not.toContain('\nSyntetická píseň\n');
    expect(result.chordCount).toBe(4);
    expect(result.originalKey).toBe('C');
    expect(result.firstLine).toBe('Vymyšlená věta');
  });

  it('respektuje mezinárodní B a béčkové lomené akordy', () => {
    const result = convertLayoutTextToChordPro('B   Bb/D\nMade up line', { title: 'Synthetic', sourceNotation: 'international' });
    expect(result.chordPro).toContain('[B]Made[Bb/D] up line');
    expect(result.originalKey).toBe('B');
  });
});
