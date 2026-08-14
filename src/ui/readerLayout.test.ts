import { describe, expect, it } from 'vitest';
import { groupChordTokensIntoWords, mobileColumnPercent } from './readerLayout';

describe('mobileColumnPercent', () => {
  it('převádí desktopové nastavení na zřetelný mobilní rozsah', () => {
    expect(mobileColumnPercent(320)).toBe(84);
    expect(mobileColumnPercent(650)).toBe(92);
    expect(mobileColumnPercent(980)).toBe(100);
  });

  it('bezpečně omezuje hodnoty mimo rozsah', () => {
    expect(mobileColumnPercent(0)).toBe(84);
    expect(mobileColumnPercent(2_000)).toBe(100);
  });
});

describe('groupChordTokensIntoWords', () => {
  it('nedovolí zalomit slovo v místě vloženého akordu', () => {
    expect(groupChordTokensIntoWords([
      { chord: 'Am7', lyric: 'slunce nov', sourceIndex: 0 },
      { chord: 'C', lyric: 'ý den', sourceIndex: 1 },
    ])).toEqual([
      { kind: 'word', tokens: [{ chord: 'Am7', lyric: 'slunce', sourceIndex: 0 }] },
      { kind: 'space', text: ' ' },
      {
        kind: 'word',
        tokens: [
          { chord: null, lyric: 'nov', sourceIndex: undefined },
          { chord: 'C', lyric: 'ý', sourceIndex: 1 },
        ],
      },
      { kind: 'space', text: ' ' },
      { kind: 'word', tokens: [{ chord: null, lyric: 'den', sourceIndex: undefined }] },
    ]);
  });

  it('přesune akord před úvodní mezerou k následujícímu slovu', () => {
    expect(groupChordTokensIntoWords([{ chord: 'G', lyric: ' refrén', sourceIndex: 3 }])).toEqual([
      { kind: 'space', text: ' ' },
      { kind: 'word', tokens: [{ chord: 'G', lyric: 'refrén', sourceIndex: 3 }] },
    ]);
  });
});
