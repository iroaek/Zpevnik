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

  it('uchovává akord jako kanonické části', () => {
    expect(parseChord('Gmaj7/H', 'czech')).toEqual({
      root: { pitchClass: 7, accidental: 'natural' },
      quality: 'maj',
      extension: '7',
      bassNote: { pitchClass: 11, accidental: 'natural' },
    });
  });
});
