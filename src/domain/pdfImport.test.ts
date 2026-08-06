import { describe, expect, it } from 'vitest';
import { reconstructPdfLines } from './pdfLayout';

describe('rekonstrukce rozvržení PDF', () => {
  it('seskupí syntetické textové položky podle souřadnic a zachová mezery pro akordy', () => {
    const lines = reconstructPdfLines([
      { str: 'C', transform: [1, 0, 0, 10, 10, 100], width: 6, height: 10 },
      { str: 'G7', transform: [1, 0, 0, 10, 58, 100], width: 12, height: 10 },
      { str: 'Vymyšlená', transform: [1, 0, 0, 10, 10, 80], width: 55, height: 10 },
      { str: 'věta', transform: [1, 0, 0, 10, 70, 80], width: 22, height: 10 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^C\s+G7$/);
    expect(lines[1]).toBe('Vymyšlená věta');
  });
});
