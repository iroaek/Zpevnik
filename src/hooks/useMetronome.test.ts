import { describe, expect, it } from 'vitest';
import { tempoFromTaps } from './useMetronome';

describe('Tap tempo', () => {
  it('spočítá stabilní tempo z několika klepnutí', () => {
    expect(tempoFromTaps([0, 500, 1_000, 1_500])).toBe(120);
  });

  it('ignoruje neplatné a příliš pomalé intervaly', () => {
    expect(tempoFromTaps([0])).toBeNull();
    expect(tempoFromTaps([0, 3_000])).toBeNull();
  });
});
