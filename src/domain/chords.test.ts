import { describe, expect, it } from 'vitest';
import { parseChord, transposeChord } from './chords';

describe('transpozice českých a mezinárodních akordů', () => {
  it('české H +1 je C', () => {
    expect(transposeChord('H', 1, 'czech')).toBe('C');
  });

  it('české B (B flat) +1 je H', () => {
    expect(transposeChord('B', 1, 'czech')).toBe('H');
  });

  it('mezinárodní B +1 je C', () => {
    expect(transposeChord('B', 1, 'international')).toBe('C');
  });

  it('mezinárodní Bb +1 je B', () => {
    expect(transposeChord('Bb', 1, 'international')).toBe('B');
  });

  it('české G/H +2 je A/Cis', () => {
    expect(transposeChord('G/H', 2, 'czech')).toBe('A/Cis');
  });

  it.each(['maj7', 'sus4', 'dim', 'add9', 'm7'])('zachová příponu %s', (suffix) => {
    expect(transposeChord(`G${suffix}`, 2, 'czech')).toBe(`A${suffix}`);
  });

  it('rozliší české As od A-sus a zachová číselné lomítkové rozšíření', () => {
    expect(transposeChord('As', 2, 'czech')).toBe('B');
    expect(transposeChord('Asus4', 2, 'czech')).toBe('Hsus4');
    expect(transposeChord('Esus4', 1, 'czech')).toBe('Fsus4');
    expect(transposeChord('C6/4', 2, 'czech')).toBe('D6/4');
    expect(transposeChord('A7/5+', 2, 'czech')).toBe('H7/5+');
  });

  it('uchovává akord jako kanonické části', () => {
    expect(parseChord('Gmaj7/H', 'czech')).toEqual({
      root: { pitchClass: 7, accidental: 'natural' },
      quality: 'maj',
      extension: '7',
      bassNote: { pitchClass: 11, accidental: 'natural' },
    });
  });
});
