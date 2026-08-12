import { describe, expect, it } from 'vitest';
import { parseChordLine, parseChordPro, sanitizeImportedText, stripChords } from './chordpro';

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
    expect(sanitizeImportedText('C\u030cesky\u0301 r\u030ca\u0301dek')).toBe('Český řádek');
  });

  it('převede skutečné i omylem zapsané Unicode mezery na běžné mezery', () => {
    expect(sanitizeImportedText('\\u00a0[Ami]Řádek\u00A0textu\\xA0')).toBe(' [Ami]Řádek textu ');
    expect(parseChordPro('\\u00a0[Ami]Ve třicátém týdnu').firstLine).toBe('Ve třicátém týdnu');
  });

  it('nepovažuje hranaté značky opakování ani nadpis sloky za akordy', () => {
    expect(parseChordLine('[: [G]Vymyšlený text :]')).toEqual([
      { chord: null, lyric: '[: ' },
      { chord: 'G', lyric: 'Vymyšlený text :]' },
    ]);
    expect(parseChordLine('[Verse 1]')).toEqual([{ chord: null, lyric: '[Verse 1]' }]);
    expect(stripChords('[: [C]La :]')).toBe('[: La :]');
  });
});
