import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseChordPro, type ChordToken } from '../domain/chordpro';
import { parseChord, renderChord, transposeCanonicalChord, type ChordNotation } from '../domain/chords';
import { groupChordTokensIntoWords, mobileColumnPercent } from '../ui/readerLayout';

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
  performanceProgress?: number | null;
  editMode?: boolean;
  onMoveChord?: (sourceIndex: number, delta: number) => void;
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
  sourceIndex: number | null;
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

type GuitarVoicingKind = 'major' | 'minor' | 'dominant7' | 'major7' | 'minor7' | 'sus2' | 'sus4';

function chordSuffix(chord: ReturnType<typeof parseChord>): string {
  return chord ? `${chord.quality}${chord.extension}`.toLowerCase().replace(/−/g, '-') : '';
}

function chordVoicingKind(chord: NonNullable<ReturnType<typeof parseChord>>): GuitarVoicingKind | null {
  if (chord.bassNote) return null;
  const suffix = chordSuffix(chord);
  if (!suffix) return 'major';
  if (/^(?:m|mi|min|-)$/.test(suffix)) return 'minor';
  if (suffix === '7') return 'dominant7';
  if (suffix === 'maj7') return 'major7';
  if (/^(?:m|mi|min|-)7$/.test(suffix)) return 'minor7';
  if (suffix === 'sus2') return 'sus2';
  if (suffix === 'sus4') return 'sus4';
  return null;
}

function movableVoicing(root: number, kind: Exclude<GuitarVoicingKind, 'major' | 'minor'>): Array<number | null> {
  const eFret = (root - 4 + 12) % 12;
  const aFret = (root - 9 + 12) % 12;
  const eShape = kind === 'dominant7' ? [eFret, eFret + 2, eFret, eFret + 1, eFret, eFret]
    : kind === 'major7' ? [eFret, eFret + 2, eFret + 1, eFret + 1, eFret, eFret]
      : kind === 'minor7' ? [eFret, eFret + 2, eFret, eFret, eFret, eFret]
        : kind === 'sus2' ? [eFret, eFret + 2, eFret + 4, eFret + 4, eFret, eFret]
          : [eFret, eFret + 2, eFret + 2, eFret + 2, eFret, eFret];
  const aShape = kind === 'dominant7' ? [null, aFret, aFret + 2, aFret, aFret + 2, aFret]
    : kind === 'major7' ? [null, aFret, aFret + 2, aFret + 1, aFret + 2, aFret]
      : kind === 'minor7' ? [null, aFret, aFret + 2, aFret, aFret + 1, aFret]
        : kind === 'sus2' ? [null, aFret, aFret + 2, aFret + 2, aFret, aFret]
          : [null, aFret, aFret + 2, aFret + 2, aFret + 3, aFret];
  return aFret <= eFret ? aShape : eShape;
}

function guitarVoicing(chord: NonNullable<ReturnType<typeof parseChord>>): Array<number | null> | null {
  const kind = chordVoicingKind(chord);
  if (!kind) return null;
  if (kind === 'major') return MAJOR_GUITAR[chord.root.pitchClass];
  if (kind === 'minor') return MINOR_GUITAR[chord.root.pitchClass];
  return movableVoicing(chord.root.pitchClass, kind);
}

function pianoIntervals(chord: NonNullable<ReturnType<typeof parseChord>>): number[] {
  const suffix = chordSuffix(chord);
  const minor = /^(?:m(?!aj)|mi|min|-)/.test(suffix);
  if (/^(?:dim|o|°)/.test(suffix)) return /7/.test(suffix) ? [0, 3, 6, 9] : [0, 3, 6];
  if (/^(?:ø|m7b5|mi7b5|min7b5)/.test(suffix)) return [0, 3, 6, 10];
  if (/^(?:aug|\+)/.test(suffix)) return [0, 4, 8];
  if (/sus2/.test(suffix)) return /7/.test(suffix) ? [0, 2, 7, 10] : [0, 2, 7];
  if (/sus4|sus/.test(suffix)) return /7/.test(suffix) ? [0, 5, 7, 10] : [0, 5, 7];
  if (/maj7/.test(suffix)) return [0, minor ? 3 : 4, 7, 11];
  if (/7/.test(suffix)) return [0, minor ? 3 : 4, 7, 10];
  if (/6/.test(suffix)) return [0, minor ? 3 : 4, 7, 9];
  if (/add9/.test(suffix)) return [0, minor ? 3 : 4, 7, 2];
  return [0, minor ? 3 : 4, 7];
}

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
  const frets = guitarVoicing(parsed);
  const playedFrets = frets?.filter((value): value is number => typeof value === 'number' && value > 0) ?? [];
  const baseFret = frets?.includes(0) ? 1 : Math.max(1, playedFrets.length ? Math.min(...playedFrets) : 1);
  const barre = frets?.includes(0) ? null : frets ? inferBarre(frets, baseFret) : null;
  const intervals = pianoIntervals(parsed);
  const pianoNotes = new Set(intervals.map((interval) => (parsed.root.pitchClass + interval) % 12));
  if (parsed.bassNote) pianoNotes.add(parsed.bassNote.pitchClass);
  const whiteNotes = [0, 2, 4, 5, 7, 9, 11];
  const blackNotes = [{ note: 1, x: 22 }, { note: 3, x: 55 }, { note: 6, x: 111 }, { note: 8, x: 143 }, { note: 10, x: 175 }];
  return <div className={`chord-diagrams ${frets ? '' : 'chord-diagrams--single'}`}>
    {frets ? <figure><figcaption>Kytara{baseFret > 1 ? ` · ${baseFret}. pražec` : ''}{barre ? ' · barré' : ''}</figcaption><svg viewBox="0 0 150 128" role="img" aria-label={`Kytarový hmat ${chord}${barre ? ' s barré' : ''}`}>
      {[0, 1, 2, 3, 4, 5].map((string) => <line key={`s-${string}`} x1={20 + string * 22} x2={20 + string * 22} y1="23" y2="111" />)}
      {[0, 1, 2, 3, 4].map((fret) => <line key={`f-${fret}`} x1="20" x2="130" y1={23 + fret * 22} y2={23 + fret * 22} className={fret === 0 ? 'nut' : ''} />)}
      {barre && <line className="barre" x1={20 + barre.fromString * 22} x2={20 + barre.toString * 22} y1="34" y2="34" />}
      {frets.map((fret, string) => fret === null
        ? <text key={`p-${string}`} x={20 + string * 22} y="15">×</text>
        : fret === 0
          ? <circle key={`p-${string}`} cx={20 + string * 22} cy="11" r="5" className="open" data-string={string} data-fret={fret} />
          : <circle key={`p-${string}`} cx={20 + string * 22} cy={34 + Math.max(0, fret - baseFret) * 22} r="7" data-string={string} data-fret={fret} />)}
    </svg></figure> : <figure className="chord-diagram-unavailable"><figcaption>Kytara</figcaption><p>Tento rozšířený nebo lomený akord má více běžných hmatů. Místo nepřesného diagramu zobrazujeme pouze jeho tóny.</p></figure>}
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
  performanceProgress = null,
  editMode = false,
  onMoveChord,
  onSuggestCorrection,
}: ChordSheetProps) {
  const parsed = useMemo(() => parseChordPro(source), [source]);
  const mobileColumnWidth = mobileColumnPercent(columnWidth);
  const performanceSectionIndexes = useMemo(() => parsed.sections.flatMap((section, index) => section.kind === 'comment' || (section.kind === 'chorus' && section.repeated && collapseRepeatedChoruses) ? [] : [index]), [collapseRepeatedChoruses, parsed.sections]);
  const performanceSection = performanceProgress === null || performanceSectionIndexes.length === 0
    ? null
    : performanceSectionIndexes[Math.min(performanceSectionIndexes.length - 1, Math.floor(Math.max(0, Math.min(.999, performanceProgress)) * performanceSectionIndexes.length))];
  const [popover, setPopover] = useState<ChordPopoverState | null>(null);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const chordDrag = useRef<{ sourceIndex: number; startX: number } | null>(null);
  const suppressChordClick = useRef(false);
  useEffect(() => {
    if (!popover) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setPopover(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [popover]);
  const renderChordButton = (token: ChordToken) => {
    if (!token.chord) return <span className="chord chord--empty" aria-hidden="true">{' '}</span>;
    const renderedChord = displayedChord(token.chord, semitones, sourceNotation, notation);
    return <button type="button" className={`chord ${editMode ? 'chord--draggable' : ''}`} data-chord={renderedChord} title={`Zobrazit hmat akordu ${renderedChord}`} aria-label={`Akord ${renderedChord}; ${editMode ? 'upravit polohu' : 'zobrazit hmat'}`} aria-haspopup="dialog" onPointerDown={(event) => {
      if (!editMode || token.sourceIndex === undefined || !onMoveChord) return;
      chordDrag.current = { sourceIndex: token.sourceIndex, startX: event.clientX };
      suppressChordClick.current = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }} onPointerUp={(event) => {
      const drag = chordDrag.current;
      chordDrag.current = null;
      if (!drag || !editMode || !onMoveChord) return;
      const pixels = event.clientX - drag.startX;
      const delta = Math.round(pixels / Math.max(8, fontSize * 0.55));
      if (delta === 0) return;
      suppressChordClick.current = true;
      onMoveChord(drag.sourceIndex, delta);
      navigator.vibrate?.(8);
    }} onPointerCancel={() => { chordDrag.current = null; }} onClick={(event) => {
      event.stopPropagation();
      if (suppressChordClick.current) { suppressChordClick.current = false; return; }
      const rect = event.currentTarget.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 24);
      const estimatedHeight = 320;
      setPopover({
        chord: renderedChord,
        sourceIndex: token.sourceIndex ?? null,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: rect.bottom + estimatedHeight > window.innerHeight ? Math.max(12, rect.top - estimatedHeight) : rect.bottom + 8,
      });
    }}><span className="chord-value" key={`${token.chord}-${semitones}-${notation}`}>{renderedChord}</span></button>;
  };
  return (
    <div className={`chord-sheet ${focusSections && activeSection !== null ? 'chord-sheet--focus-active' : ''} ${performanceSection !== null ? 'chord-sheet--performance' : ''} ${editMode ? 'chord-sheet--editing' : ''}`} style={{ '--song-font-size': `${fontSize}px`, '--chord-scale': chordScale, '--song-line-height': lineHeight, '--song-column-width': `${columnWidth}px`, '--mobile-song-column-width': `${mobileColumnWidth}%` } as React.CSSProperties}>
      {parsed.sections.map((section, sectionIndex) => {
        if (section.kind === 'comment') {
          return <p className="song-comment" key={`comment-${sectionIndex}`}>{section.label}</p>;
        }
        if (section.kind === 'chorus' && section.repeated && collapseRepeatedChoruses) {
          return <p className="chorus-repeat" key={`repeat-${sectionIndex}`} aria-label="Opakuje se refrén">↻ Refrén znovu</p>;
        }
        return (
          <section className={`song-section song-section--${section.kind} ${activeSection === sectionIndex ? 'song-section--active' : ''}${performanceSection !== null ? sectionIndex < performanceSection ? ' song-section--performed' : sectionIndex === performanceSection ? ' song-section--performing' : ' song-section--upcoming' : ''}`} tabIndex={focusSections ? 0 : undefined} aria-current={performanceSection === sectionIndex ? 'step' : undefined} aria-label={focusSections ? `${section.label || 'Sloka'}; klepnutím zvýraznit` : undefined} onClick={focusSections ? () => setActiveSection((current) => current === sectionIndex ? null : sectionIndex) : undefined} onKeyDown={focusSections ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveSection((current) => current === sectionIndex ? null : sectionIndex); } } : undefined} key={`section-${sectionIndex}`}>
            {section.label && <h3>{section.label}</h3>}
            {section.lines.map((line, lineIndex) => {
              const lineHasChords = showChords && line.some((token) => Boolean(token.chord));
              const lineHasLyrics = line.some((token) => token.lyric.trim().length > 0);
              if (lineHasChords && !lineHasLyrics) {
                return <div className="chord-line chord-line--with-chords chord-line--instrumental" aria-label="Akordový mezitakt" key={`line-${lineIndex}`}>
                  {line.map((token, tokenIndex) => token.chord
                    ? <span className="chord-token" data-has-chord="true" data-has-lyric="false" key={`instrumental-${tokenIndex}`}>{renderChordButton(token)}</span>
                    : null)}
                </div>;
              }
              const lineParts = lineHasChords
                ? groupChordTokensIntoWords(line)
                : [{ kind: 'plain' as const, tokens: line }];
              return <div className={lineHasChords ? 'chord-line chord-line--with-chords' : 'chord-line'} key={`line-${lineIndex}`}>
                {lineParts.map((part, partIndex) => part.kind === 'space'
                  ? <span className="chord-space" key={`space-${partIndex}`}>{part.text}</span>
                  : <span className={part.kind === 'word' ? 'chord-word' : 'chord-line-plain'} key={`${part.kind}-${partIndex}`}>{part.tokens.map((token, tokenIndex) => (
                  <span className="chord-token" data-has-chord={Boolean(token.chord)} data-has-lyric={Boolean(token.lyric.trim())} key={`token-${partIndex}-${tokenIndex}`}>
                    {lineHasChords && renderChordButton(token)}
                    <span className="lyric">{token.lyric || '\u00a0'}</span>
                  </span>
                ))}</span>)}
              </div>;
            })}
          </section>
        );
      })}
      {popover && createPortal(<><button type="button" className="chord-popover-scrim" aria-label="Zavřít detail akordu" onClick={() => setPopover(null)} /><section className="chord-popover" role="dialog" aria-modal="true" aria-label={`${editMode ? 'Úprava polohy' : 'Hmat'} akordu ${popover.chord}`} style={{ top: popover.top, left: popover.left }}><header><span><small>{editMode ? 'Úprava polohy' : 'Akord'}</small><strong>{popover.chord}</strong></span><button type="button" aria-label="Zavřít" onClick={() => setPopover(null)}>×</button></header>{editMode && popover.sourceIndex !== null && onMoveChord && <div className="chord-position-editor"><p>Posuňte akord vůči textu. Text písně se nezmění a úprava zůstane jen v tomto zařízení.</p><div role="group" aria-label={`Posunout akord ${popover.chord}`}><button type="button" onClick={() => onMoveChord(popover.sourceIndex!, -4)} aria-label="Posunout o čtyři znaky doleva">−4</button><button type="button" onClick={() => onMoveChord(popover.sourceIndex!, -1)} aria-label="Posunout o jeden znak doleva">←</button><button type="button" onClick={() => onMoveChord(popover.sourceIndex!, 1)} aria-label="Posunout o jeden znak doprava">→</button><button type="button" onClick={() => onMoveChord(popover.sourceIndex!, 4)} aria-label="Posunout o čtyři znaky doprava">+4</button></div></div>}<ChordDiagram chord={popover.chord} sourceNotation={notation} />{onSuggestCorrection && <button type="button" className="secondary-button chord-report-button" onClick={() => { onSuggestCorrection(popover.chord); setPopover(null); }}>Nahlásit chybný akord nebo polohu</button>}</section></>, document.body)}
    </div>
  );
}
