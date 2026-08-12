import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
  chordScale?: number;
  lineHeight?: number;
  columnWidth?: number;
  focusSections?: boolean;
  onSuggestCorrection?: (chord: string) => void;
}

function displayedChord(chord: string, semitones: number, sourceNotation: ChordNotation, notation: ChordNotation): string {
  const parsed = parseChord(chord, sourceNotation) ?? parseChord(chord, sourceNotation === 'czech' ? 'international' : 'czech');
  if (!parsed) return chord;
  const preference = parsed.root.accidental === 'flat' ? 'flat' : 'sharp';
  return renderChord(transposeCanonicalChord(parsed, semitones), notation, preference);
}

interface ChordPopoverState {
  chord: string;
  top: number;
  left: number;
}

const MAJOR_GUITAR: Array<Array<number | null>> = [
  [null, 3, 2, 0, 1, 0], [null, 4, 6, 6, 6, 4], [null, null, 0, 2, 3, 2], [null, 6, 8, 8, 8, 6],
  [0, 2, 2, 1, 0, 0], [1, 3, 3, 2, 1, 1], [2, 4, 4, 3, 2, 2], [3, 2, 0, 0, 0, 3],
  [4, 6, 6, 5, 4, 4], [null, 0, 2, 2, 2, 0], [null, 1, 3, 3, 3, 1], [null, 2, 4, 4, 4, 2],
];
const MINOR_GUITAR: Array<Array<number | null>> = [
  [null, 3, 5, 5, 4, 3], [null, 4, 6, 6, 5, 4], [null, null, 0, 2, 3, 1], [null, 6, 8, 8, 7, 6],
  [0, 2, 2, 0, 0, 0], [1, 3, 3, 1, 1, 1], [2, 4, 4, 2, 2, 2], [3, 5, 5, 3, 3, 3],
  [4, 6, 6, 4, 4, 4], [null, 0, 2, 2, 1, 0], [null, 1, 3, 3, 2, 1], [null, 2, 4, 4, 3, 2],
];

function inferBarre(frets: Array<number | null>, baseFret: number): { fromString: number; toString: number } | null {
  const anchors = frets
    .map((fret, string) => fret === baseFret ? string : -1)
    .filter((string) => string >= 0);
  if (anchors.length < 2) return null;
  const fromString = Math.min(...anchors);
  const toString = Math.max(...anchors);
  if (toString - fromString < 3) return null;
  const span = frets.slice(fromString, toString + 1);
  return span.every((fret) => fret !== null && fret >= baseFret) ? { fromString, toString } : null;
}

function ChordDiagram({ chord, sourceNotation }: { chord: string; sourceNotation: ChordNotation }) {
  const parsed = parseChord(chord, sourceNotation) ?? parseChord(chord, sourceNotation === 'czech' ? 'international' : 'czech');
  if (!parsed) return <p>Pro tento zápis není diagram dostupný.</p>;
  const minor = /^(?:m|min|−|-)/i.test(parsed.quality);
  const frets = (minor ? MINOR_GUITAR : MAJOR_GUITAR)[parsed.root.pitchClass];
  const playedFrets = frets.filter((value): value is number => typeof value === 'number' && value > 0);
  const baseFret = frets.includes(0) ? 1 : Math.max(1, playedFrets.length ? Math.min(...playedFrets) : 1);
  const barre = frets.includes(0) ? null : inferBarre(frets, baseFret);
  const intervals = parsed.quality.toLowerCase().startsWith('dim') ? [0, 3, 6] : minor ? [0, 3, 7] : [0, 4, 7];
  const pianoNotes = new Set(intervals.map((interval) => (parsed.root.pitchClass + interval) % 12));
  const whiteNotes = [0, 2, 4, 5, 7, 9, 11];
  const blackNotes = [{ note: 1, x: 22 }, { note: 3, x: 55 }, { note: 6, x: 111 }, { note: 8, x: 143 }, { note: 10, x: 175 }];
  return <div className="chord-diagrams">
    <figure><figcaption>Kytara{baseFret > 1 ? ` · ${baseFret}. pražec` : ''}{barre ? ' · barré' : ''}</figcaption><svg viewBox="0 0 150 128" role="img" aria-label={`Kytarový hmat ${chord}${barre ? ' s barré' : ''}`}>
      {[0, 1, 2, 3, 4, 5].map((string) => <line key={`s-${string}`} x1={20 + string * 22} x2={20 + string * 22} y1="23" y2="111" />)}
      {[0, 1, 2, 3, 4].map((fret) => <line key={`f-${fret}`} x1="20" x2="130" y1={23 + fret * 22} y2={23 + fret * 22} className={fret === 0 ? 'nut' : ''} />)}
      {barre && <line className="barre" x1={20 + barre.fromString * 22} x2={20 + barre.toString * 22} y1="34" y2="34" />}
      {frets.map((fret, string) => fret === null
        ? <text key={`p-${string}`} x={20 + string * 22} y="15">×</text>
        : fret === 0
          ? <circle key={`p-${string}`} cx={20 + string * 22} cy="11" r="5" className="open" />
          : <circle key={`p-${string}`} cx={20 + string * 22} cy={34 + Math.max(0, fret - baseFret) * 22} r="7" />)}
    </svg></figure>
    <figure><figcaption>Klavír</figcaption><svg viewBox="0 0 224 94" role="img" aria-label={`Klavírní tóny akordu ${chord}`}>
      {whiteNotes.map((note, index) => <rect key={note} x={index * 32} y="4" width="32" height="84" className={pianoNotes.has(note) ? 'piano-key active' : 'piano-key'} />)}
      {blackNotes.map(({ note, x }) => <rect key={note} x={x} y="4" width="20" height="50" className={pianoNotes.has(note) ? 'piano-key black active' : 'piano-key black'} />)}
    </svg></figure>
  </div>;
}

export function ChordSheet({
  source,
  semitones = 0,
  notation = 'czech',
  sourceNotation = 'czech',
  showChords = true,
  collapseRepeatedChoruses = true,
  fontSize = 20,
  chordScale = 1,
  lineHeight = 1.3,
  columnWidth = 760,
  focusSections = false,
  onSuggestCorrection,
}: ChordSheetProps) {
  const parsed = useMemo(() => parseChordPro(source), [source]);
  const [popover, setPopover] = useState<ChordPopoverState | null>(null);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  useEffect(() => {
    if (!popover) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPopover(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [popover]);
  return (
    <div className={`chord-sheet ${focusSections && activeSection !== null ? 'chord-sheet--focus-active' : ''}`} style={{ '--song-font-size': `${fontSize}px`, '--chord-scale': chordScale, '--song-line-height': lineHeight, '--song-column-width': `${columnWidth}px` } as React.CSSProperties}>
      {parsed.sections.map((section, sectionIndex) => {
        if (section.kind === 'comment') {
          return <p className="song-comment" key={`comment-${sectionIndex}`}>{section.label}</p>;
        }
        if (section.kind === 'chorus' && section.repeated && collapseRepeatedChoruses) {
          return <p className="chorus-repeat" key={`repeat-${sectionIndex}`} aria-label="Opakuje se refrén">↻ Refrén znovu</p>;
        }
        return (
          <section className={`song-section song-section--${section.kind} ${activeSection === sectionIndex ? 'song-section--active' : ''}`} tabIndex={focusSections ? 0 : undefined} aria-label={focusSections ? `${section.label || 'Sloka'}; klepnutím zvýraznit` : undefined} onClick={focusSections ? () => setActiveSection((current) => current === sectionIndex ? null : sectionIndex) : undefined} onKeyDown={focusSections ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveSection((current) => current === sectionIndex ? null : sectionIndex); } } : undefined} key={`section-${sectionIndex}`}>
            {section.label && <h3>{section.label}</h3>}
            {section.lines.map((line, lineIndex) => {
              const lineHasChords = showChords && line.some((token) => Boolean(token.chord));
              return <div className={lineHasChords ? 'chord-line chord-line--with-chords' : 'chord-line'} key={`line-${lineIndex}`}>
                {line.map((token, tokenIndex) => (
                  <span className="chord-token" data-has-chord={Boolean(token.chord)} key={`token-${tokenIndex}`}>
                    {lineHasChords && (token.chord
                      ? <button type="button" className="chord" aria-label={`Akord ${displayedChord(token.chord, semitones, sourceNotation, notation)}; zobrazit hmat`} aria-haspopup="dialog" onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        const width = Math.min(300, window.innerWidth - 24);
                        const estimatedHeight = 320;
                        setPopover({
                          chord: displayedChord(token.chord!, semitones, sourceNotation, notation),
                          left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
                          top: rect.bottom + estimatedHeight > window.innerHeight ? Math.max(12, rect.top - estimatedHeight) : rect.bottom + 8,
                        });
                      }}><span className="chord-value" key={`${token.chord}-${semitones}-${notation}`}>{displayedChord(token.chord, semitones, sourceNotation, notation)}</span></button>
                      : <span className="chord chord--empty" aria-hidden="true">{'\u00a0'}</span>)}
                    <span className="lyric">{token.lyric || '\u00a0'}</span>
                  </span>
                ))}
              </div>;
            })}
          </section>
        );
      })}
      {popover && createPortal(<><button type="button" className="chord-popover-scrim" aria-label="Zavřít diagram akordu" onClick={() => setPopover(null)} /><section className="chord-popover" role="dialog" aria-modal="true" aria-label={`Hmat akordu ${popover.chord}`} style={{ top: popover.top, left: popover.left }}><header><span><small>Akord</small><strong>{popover.chord}</strong></span><button type="button" aria-label="Zavřít" onClick={() => setPopover(null)}>×</button></header><ChordDiagram chord={popover.chord} sourceNotation={notation} />{onSuggestCorrection && <button type="button" className="secondary-button chord-report-button" onClick={() => { onSuggestCorrection(popover.chord); setPopover(null); }}>Nahlásit chybný akord nebo polohu</button>}</section></>, document.body)}
    </div>
  );
}
