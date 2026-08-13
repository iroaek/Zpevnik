import { describe, expect, it } from 'vitest';
import { inspectChordSource, moveChordInSource, normalizeChordSpellingsInSource } from './chordEditor';

describe('ruční posun akordů', () => {
  it('posune pouze vybraný akord a zachová text i metadata', () => {
    const source = '{title: Test}\n[C]Vymyšle[G]ná věta\n[Ami]Druhý řádek';
    expect(moveChordInSource(source, 1, 2)).toBe('{title: Test}\n[C]Vymyšlená[G] věta\n[Ami]Druhý řádek');
  });

  it('nepustí akord mimo řádek a při editaci sjednotí české křížky', () => {
    expect(moveChordInSource('[Fis]Text', 0, -20)).toBe('[F#]Text');
    expect(moveChordInSource('Text[Gis]', 0, 20)).toBe('Text[G#]');
  });

  it('ponechá zdroj beze změny pro neexistující akord', () => {
    expect(moveChordInSource('[C]Text', 8, 1)).toBe('[C]Text');
  });
});

describe('kontrola a normalizace zdroje', () => {
  it('najde vypsanou Unicode escape sekvenci a nerozpoznanou značku', () => {
    const issues = inspectChordSource('[G]Ahoj \\u00a0 [XYZ?]');
    expect(issues.map((issue) => issue.kind)).toEqual(['control-character', 'unknown-marker']);
  });

  it('převede všechny české křížky bez změny textu', () => {
    expect(normalizeChordSpellingsInSource('[Fis]Text [Gis/H]dál')).toBe('[F#]Text [G#/H]dál');
  });
});
