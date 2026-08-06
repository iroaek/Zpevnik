import { describe, expect, it } from 'vitest';
import { parseChordLine, parseChordPro, sanitizeImportedText } from './chordpro';

describe('ChordPro parser', () => {
  it('zarovná akord s následující slabikou bez HTML', () => {
    expect(parseChordLine('[G]Tes[C]tovací')).toEqual([
      { chord: 'G', lyric: 'Tes' },
      { chord: 'C', lyric: 'tovací' },
    ]);
  });

  it('označí přesně opakovaný refrén', () => {
    const parsed = parseChordPro('{title: Test}\n{soc}\n[C]La\n{eoc}\nText\n{soc}\n[C]La\n{eoc}');
    expect(parsed.sections.filter((section) => section.kind === 'chorus').map((section) => section.repeated)).toEqual([false, true]);
  });

  it('odstraní řídicí znaky a zachová českou diakritiku', () => {
    expect(sanitizeImportedText('\uFEFFŽluťoučký\u0000\r\nřádek')).toBe('Žluťoučký\nřádek');
  });
});
