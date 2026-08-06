import { describe, expect, it } from 'vitest';
import { convertLayoutTextToChordPro, findLikelyMalformedChordTokens, looksLikeChordLine, recognizedChord } from './layoutToChordPro';

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

  it('pozná složité akordy, rytmické pomlčky a opraví běžný zápis snížené kvinty', () => {
    expect(recognizedChord('Hm7b5', 'czech')).toBe('Hm7b5');
    expect(recognizedChord('F#7(sus4)', 'czech')).toBe('F#7(sus4)');
    expect(recognizedChord('Esus4.', 'czech')).toBe('Esus4');
    expect(recognizedChord('C6/4', 'czech')).toBe('C6/4');
    expect(recognizedChord('Hmi75-', 'czech')).toBe('Hmi7b5');
    expect(looksLikeChordLine('Am7 - - - C - - -', 'czech')).toBe(true);
    expect(looksLikeChordLine('D|D|G|G|Emi|A', 'czech')).toBe(true);

    const result = convertLayoutTextToChordPro('Am7 - - - C - - -\nVymyšlená rytmická věta', {
      title: 'Syntetická',
      sourceNotation: 'czech',
    });
    expect(result.chordPro).toContain('[Am7]Vymyšlená [C]rytmická věta');
    expect(result.chordCount).toBe(2);
  });

  it('označí neznámé znaky a pravděpodobně poškozené akordy ke kontrole', () => {
    const source = 'A   D/Em7   Asusa\nVymyšlený � řádek';
    expect(findLikelyMalformedChordTokens(source, 'czech')).toEqual(['D/Em7', 'Asusa']);
    const result = convertLayoutTextToChordPro(source, { title: 'Syntetická', sourceNotation: 'czech' });
    expect(result.containsUnknownGlyphs).toBe(true);
    expect(result.malformedChordTokens).toEqual(['D/Em7', 'Asusa']);
  });
});
