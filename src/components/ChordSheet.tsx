import { useMemo } from 'react';
import { parseChordPro } from '../domain/chordpro';
import { parseChord, renderChord, transposeCanonicalChord, type ChordNotation } from '../domain/chords';

interface ChordSheetProps {
  source: string;
  semitones?: number;
  notation?: ChordNotation;
  sourceNotation?: ChordNotation;
  showChords?: boolean;
  collapseRepeatedChoruses?: boolean;
  fontSize?: number;
}

function displayedChord(chord: string, semitones: number, sourceNotation: ChordNotation, notation: ChordNotation): string {
  const parsed = parseChord(chord, sourceNotation) ?? parseChord(chord, sourceNotation === 'czech' ? 'international' : 'czech');
  if (!parsed) return chord;
  const preference = parsed.root.accidental === 'flat' ? 'flat' : 'sharp';
  return renderChord(transposeCanonicalChord(parsed, semitones), notation, preference);
}

export function ChordSheet({
  source,
  semitones = 0,
  notation = 'czech',
  sourceNotation = 'czech',
  showChords = true,
  collapseRepeatedChoruses = true,
  fontSize = 20,
}: ChordSheetProps) {
  const parsed = useMemo(() => parseChordPro(source), [source]);
  return (
    <div className="chord-sheet" style={{ '--song-font-size': `${fontSize}px` } as React.CSSProperties}>
      {parsed.sections.map((section, sectionIndex) => {
        if (section.kind === 'comment') {
          return <p className="song-comment" key={`comment-${sectionIndex}`}>{section.label}</p>;
        }
        if (section.kind === 'chorus' && section.repeated && collapseRepeatedChoruses) {
          return <p className="chorus-repeat" key={`repeat-${sectionIndex}`} aria-label="Opakuje se refrén">↻ Refrén znovu</p>;
        }
        return (
          <section className={`song-section song-section--${section.kind}`} key={`section-${sectionIndex}`}>
            {section.label && <h3>{section.label}</h3>}
            {section.lines.map((line, lineIndex) => {
              const lineHasChords = showChords && line.some((token) => Boolean(token.chord));
              return <div className={lineHasChords ? 'chord-line chord-line--with-chords' : 'chord-line'} key={`line-${lineIndex}`}>
                {line.map((token, tokenIndex) => (
                  <span className="chord-token" data-has-chord={Boolean(token.chord)} key={`token-${tokenIndex}`}>
                    {lineHasChords && (
                      <span className="chord" aria-label={token.chord ? `Akord ${token.chord}` : undefined}>
                        {token.chord ? displayedChord(token.chord, semitones, sourceNotation, notation) : '\u00a0'}
                      </span>
                    )}
                    <span className="lyric">{token.lyric || '\u00a0'}</span>
                  </span>
                ))}
              </div>;
            })}
          </section>
        );
      })}
    </div>
  );
}
