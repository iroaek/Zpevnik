import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { submitSongCorrection, type SecureProfile } from '../auth/secureAccess';
import { metadataValue, parseChordPro, sanitizeImportedText } from '../domain/chordpro';
import { inspectChordSource, moveChordInSource, normalizeChordSpellingsInSource } from '../domain/chordEditor';
import { calculateCapoOptions, parseChord, renderPitch, transposeCanonicalChord, transposeChord, type CapoPlayerLevel } from '../domain/chords';
import type { Song } from '../domain/song';
import { fetchContent } from '../pwa/contentCache';
import { getLocalSongOverride, getPersonalSongContent, removeLocalSongOverride, saveLocalSongOverride, toggleFavorite, updateSetlistSongs, type UserState } from '../storage/database';
import { ChordSheet } from './ChordSheet';
import { Icon } from '../ui/Icon';
import { friendlyError } from '../ui/friendlyError';
import { haptic } from '../ui/haptics';

const ScoreViewer = lazy(() => import('./ScoreViewer').then((module) => ({ default: module.ScoreViewer })));
const READER_SURFACE_STORAGE_KEY = 'zpevnik-reader-surface-v1';
type ReaderSurface = 'standard' | 'paper';

function loadReaderSurface(): ReaderSurface {
  try { return localStorage.getItem(READER_SURFACE_STORAGE_KEY) === 'paper' ? 'paper' : 'standard'; }
  catch { return 'standard'; }
}

interface SongReaderProps {
  song: Song;
  userState: UserState;
  onUserStateChange: React.Dispatch<React.SetStateAction<UserState>>;
  onBack: () => void;
  catalogVersion: string;
  previousSong?: Song;
  nextSong?: Song;
  onPreviousSong?: () => void;
  onNextSong?: () => void;
  secureProfile?: SecureProfile | null;
}

export function SongReader({ song, userState, onUserStateChange, onBack, catalogVersion, previousSong, nextSong, onPreviousSong, onNextSong, secureProfile = null }: SongReaderProps) {
  const [source, setSource] = useState('');
  const [savedSource, setSavedSource] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [semitones, setSemitones] = useState(0);
  const [tab, setTab] = useState<'lyrics' | 'score'>('lyrics');
  const [autoScroll, setAutoScroll] = useState(false);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [fireMode, setFireMode] = useState(false);
  const [stageControlsVisible, setStageControlsVisible] = useState(true);
  const [stageLocked, setStageLocked] = useState(false);
  const [setlistId, setSetlistId] = useState(userState.setlists[0]?.id ?? '');
  const [setlistMessage, setSetlistMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readerProgress, setReaderProgress] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionChord, setCorrectionChord] = useState('');
  const [correctionProposal, setCorrectionProposal] = useState('');
  const [correctionNote, setCorrectionNote] = useState('');
  const [editableSource, setEditableSource] = useState('');
  const [hasLocalOverride, setHasLocalOverride] = useState(false);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState('');
  const [sourceRevision, setSourceRevision] = useState(0);
  const [chordEditMode, setChordEditMode] = useState(false);
  const [chordEditMessage, setChordEditMessage] = useState('');
  const [chordEditSaving, setChordEditSaving] = useState(false);
  const [capoFret, setCapoFret] = useState(0);
  const [capoPlayerLevel, setCapoPlayerLevel] = useState<CapoPlayerLevel>('beginner');
  const [readerSurface, setReaderSurface] = useState<ReaderSurface>(loadReaderSurface);
  const [editHistory, setEditHistory] = useState<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const readerRef = useRef<HTMLElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const settings = userState.settings;
  const songReaderPreferences = userState.songReaderPreferences[song.id];
  const readerPreferences = songReaderPreferences ?? settings.reader;
  const hasSongReaderPreferences = Boolean(songReaderPreferences);
  const isLayoutText = song.contentFormat === 'layout_text';

  useEffect(() => {
    const controller = new AbortController();
    Promise.resolve().then(() => {
      setLoadError(null);
      setSource('');
      setSavedSource('');
      setEditableSource('');
      return getLocalSongOverride(song.id);
    })
      .then(async (override) => {
        if (override !== null) {
          setHasLocalOverride(true);
          return override;
        }
        setHasLocalOverride(false);
        const response = song.chordProPath.startsWith('indexeddb:')
          ? await getPersonalSongContent(song.id).then((content) => {
            if (content === null) throw new Error('Obsah osobní písně v tomto zařízení chybí.');
            return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
          })
          : song.personalOnly
            ? await fetch(song.chordProPath, { cache: 'no-store', signal: controller.signal })
            : await fetchContent(song.chordProPath, 'songs', catalogVersion, controller.signal);
        if (!response.ok) throw new Error(`Soubor písně se nepodařilo načíst (${response.status}).`);
        return response.text();
      })
      .then((text) => {
        const sanitized = sanitizeImportedText(text);
        setSource(sanitized);
        setSavedSource(sanitized);
        setEditableSource(sanitized);
        setEditHistory({ past: [], future: [] });
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setLoadError(friendlyError(error, 'Píseň je nečitelná nebo není uložená v tomto zařízení.'));
      });
    return () => controller.abort();
  }, [catalogVersion, song, sourceRevision]);

  useEffect(() => {
    if (!autoScroll) return;
    let frame = 0;
    let previous = performance.now();
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    const tick = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      window.scrollBy({ top: settings.autoScrollSpeed * elapsed / 1000, left: 0, behavior: 'auto' });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      root.style.scrollBehavior = previousScrollBehavior;
    };
  }, [autoScroll, settings.autoScrollSpeed]);

  useEffect(() => () => { void wakeLock?.release(); }, [wakeLock]);

  useEffect(() => {
    document.documentElement.dataset.fireMode = fireMode ? 'true' : 'false';
    return () => { delete document.documentElement.dataset.fireMode; };
  }, [fireMode]);

  useEffect(() => {
    try { localStorage.setItem(READER_SURFACE_STORAGE_KEY, readerSurface); }
    catch { /* V soukromém režimu může úložiště zůstat jen po dobu návštěvy. */ }
  }, [readerSurface]);

  useEffect(() => {
    if (!fireMode || settingsOpen || stageLocked || !stageControlsVisible) return;
    const timer = window.setTimeout(() => setStageControlsVisible(false), 3_800);
    return () => window.clearTimeout(timer);
  }, [fireMode, settingsOpen, stageControlsVisible, stageLocked, autoScroll]);

  useEffect(() => {
    const updateProgress = () => {
      const reader = readerRef.current;
      if (!reader) return;
      const start = reader.offsetTop;
      const distance = Math.max(1, reader.scrollHeight - window.innerHeight);
      setReaderProgress(Math.max(0, Math.min(1, (window.scrollY - start) / distance)));
    };
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress);
    updateProgress();
    return () => {
      window.removeEventListener('scroll', updateProgress);
      window.removeEventListener('resize', updateProgress);
    };
  }, [source, tab]);

  useEffect(() => {
    if (countdown === null) return;
    const timer = window.setTimeout(() => {
      if (countdown === 1) {
        setCountdown(null);
        setAutoScroll(true);
      } else setCountdown(countdown - 1);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (!settingsOpen && !correctionOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (correctionOpen) setCorrectionOpen(false);
      else setSettingsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [correctionOpen, settingsOpen]);

  const parsedSource = useMemo(() => source && !isLayoutText ? parseChordPro(source) : null, [isLayoutText, source]);
  const sourceNotation = metadataValue(parsedSource?.metadata ?? {}, 'chord_notation') === 'international' ? 'international' : 'czech';
  const targetKey = useMemo(() => {
    if (!song.originalKey) return null;
    const parsed = parseChord(song.originalKey, sourceNotation);
    return parsed ? renderPitch(transposeCanonicalChord(parsed, semitones).root, settings.notation, parsed.root.accidental === 'flat' ? 'flat' : 'sharp') : song.originalKey;
  }, [song.originalKey, sourceNotation, semitones, settings.notation]);
  const sourceChords = useMemo(() => parsedSource?.sections.flatMap((section) => section.kind === 'comment' ? [] : section.lines.flatMap((line) => line.flatMap((token) => token.chord ? [token.chord] : []))) ?? [], [parsedSource]);
  const scoredSongChords = useMemo(() => sourceChords.map((chord) => transposeChord(chord, semitones, sourceNotation)), [semitones, sourceChords, sourceNotation]);
  const capoOptions = targetKey ? calculateCapoOptions(targetKey, settings.notation, scoredSongChords, capoPlayerLevel) : [];
  const activeCapo = capoOptions.find((option) => option.capo === capoFret) ?? capoOptions[0];
  const chordSourceIssues = useMemo(() => inspectChordSource(source), [source]);
  const isFavorite = userState.favorites.includes(song.id);
  const effectiveSetlistId = userState.setlists.some((setlist) => setlist.id === setlistId)
    ? setlistId
    : userState.setlists[0]?.id ?? '';
  const selectedSetlist = userState.setlists.find((setlist) => setlist.id === effectiveSetlistId);
  const alreadyInSetlist = Boolean(selectedSetlist?.songIds.includes(song.id));
  const readerFontSize = fireMode ? readerPreferences.stageFontSize : settings.fontSize;
  const chordDraftDirty = source !== savedSource;

  const moveChord = (sourceIndex: number, delta: number) => {
    const next = moveChordInSource(source, sourceIndex, delta);
    if (next === source) return;
    setEditHistory((current) => ({ past: [...current.past, source].slice(-50), future: [] }));
    setSource(next);
    setEditableSource(next);
    setChordEditMessage(delta < 0 ? 'Náhled: akord byl posunut doleva.' : 'Náhled: akord byl posunut doprava.');
  };

  const persistEditedSource = (next: string, message: string) => {
    setSource(next);
    setEditableSource(next);
    setChordEditMessage(message);
  };

  const saveChordDraft = async () => {
    if (!chordDraftDirty) return;
    setChordEditSaving(true);
    try {
      await saveLocalSongOverride(song.id, source);
      setSavedSource(source);
      setEditableSource(source);
      setHasLocalOverride(true);
      setChordEditMessage('Úpravy byly uloženy pouze do tohoto zařízení.');
      haptic('success');
    } catch (error) {
      setChordEditMessage(friendlyError(error, 'Úpravu akordů se nepodařilo uložit.'));
    } finally {
      setChordEditSaving(false);
    }
  };

  const discardChordDraft = () => {
    setSource(savedSource);
    setEditableSource(savedSource);
    setEditHistory({ past: [], future: [] });
    setChordEditMessage('Neuložený náhled byl zahozen.');
  };

  const undoChordEdit = () => {
    const previous = editHistory.past.at(-1);
    if (!previous) return;
    setEditHistory((current) => ({ past: current.past.slice(0, -1), future: [source, ...current.future].slice(0, 50) }));
    persistEditedSource(previous, 'Poslední posun akordu byl vrácen.');
  };

  const redoChordEdit = () => {
    const next = editHistory.future[0];
    if (!next) return;
    setEditHistory((current) => ({ past: [...current.past, source].slice(-50), future: current.future.slice(1) }));
    persistEditedSource(next, 'Vrácený posun akordu byl znovu použit.');
  };

  const normalizeSongChords = () => {
    const next = normalizeChordSpellingsInSource(source);
    if (next === source) {
      setChordEditMessage('Všechny akordy už používají jednotný zápis s #.');
      return;
    }
    setEditHistory((current) => ({ past: [...current.past, source].slice(-50), future: [] }));
    persistEditedSource(next, 'Akordy s příponou „is“ byly převedeny na zápis s #.');
  };

  const updateSettings = (change: Partial<UserState['settings']>) => {
    onUserStateChange((current) => ({ ...current, settings: { ...current.settings, ...change } }));
  };

  const updateReaderPreferences = (change: Partial<UserState['settings']['reader']>) => {
    onUserStateChange((current) => {
      const specific = current.songReaderPreferences[song.id];
      if (specific) return {
        ...current,
        songReaderPreferences: {
          ...current.songReaderPreferences,
          [song.id]: { ...current.settings.reader, ...specific, ...change },
        },
      };
      return { ...current, settings: { ...current.settings, reader: { ...current.settings.reader, ...change } } };
    });
  };

  const toggleSongReaderPreferences = (enabled: boolean) => {
    onUserStateChange((current) => {
      const songPreferences = { ...current.songReaderPreferences };
      if (enabled) songPreferences[song.id] = { ...current.settings.reader };
      else delete songPreferences[song.id];
      return { ...current, songReaderPreferences: songPreferences };
    });
  };

  const toggleWakeLock = async () => {
    if (wakeLock) {
      await wakeLock.release();
      setWakeLock(null);
      return;
    }
    if (!navigator.wakeLock) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => setWakeLock(null), { once: true });
      setWakeLock(sentinel);
    } catch {
      setWakeLock(null);
    }
  };

  const addToSetlist = () => {
    if (!effectiveSetlistId || !selectedSetlist) return;
    if (alreadyInSetlist) {
      setSetlistMessage(`Píseň už v setlistu „${selectedSetlist.name}“ je.`);
      return;
    }
    onUserStateChange((current) => {
      const setlist = current.setlists.find((candidate) => candidate.id === effectiveSetlistId);
      if (!setlist || setlist.songIds.includes(song.id)) return current;
      return updateSetlistSongs(current, effectiveSetlistId, [...setlist.songIds, song.id]);
    });
    setSetlistMessage(`Píseň byla přidána do setlistu „${selectedSetlist.name}“.`);
    haptic('success');
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  };

  const toggleFireMode = async () => {
    const next = !fireMode;
    if (next) {
      setStageControlsVisible(true);
      setStageLocked(false);
      if (!wakeLock && navigator.wakeLock) await toggleWakeLock();
    } else {
      setAutoScroll(false);
      setCountdown(null);
      if (wakeLock) await toggleWakeLock();
    }
    setFireMode(next);
    haptic('selection');
  };

  const revealStageControls = () => {
    if (!fireMode || stageLocked) return;
    setStageControlsVisible(true);
  };

  const performanceAction = () => {
    if (autoScroll) {
      setAutoScroll(false);
      haptic('selection');
      return;
    }
    if (countdown !== null) {
      setCountdown(null);
      haptic('selection');
      return;
    }
    setCountdown(3);
    haptic('selection');
  };

  const openCorrection = (chord = '') => {
    setCorrectionChord(chord);
    setCorrectionProposal('');
    setCorrectionNote(chord ? `Akord ${chord}: ` : 'Popis chyby nebo špatné polohy akordu: ');
    setEditableSource(source);
    setCorrectionMessage('');
    setCorrectionOpen(true);
  };

  const saveLocalCorrection = async () => {
    if (!editableSource.trim()) return;
    setCorrectionBusy(true);
    try {
      const sanitized = sanitizeImportedText(editableSource);
      await saveLocalSongOverride(song.id, sanitized);
      setSource(sanitized);
      setSavedSource(sanitized);
      setHasLocalOverride(true);
      setCorrectionMessage('Vaše lokální verze byla uložena pouze v tomto zařízení.');
    } catch (error) {
      setCorrectionMessage(friendlyError(error, 'Lokální opravu se nepodařilo uložit.'));
    } finally {
      setCorrectionBusy(false);
    }
  };

  const resetLocalCorrection = async () => {
    setCorrectionBusy(true);
    try {
      await removeLocalSongOverride(song.id);
      setHasLocalOverride(false);
      setCorrectionOpen(false);
      setSourceRevision((current) => current + 1);
    } catch (error) {
      setCorrectionMessage(friendlyError(error, 'Původní verzi se nepodařilo obnovit.'));
      setCorrectionBusy(false);
    }
  };

  const submitCorrection = async () => {
    if (!secureProfile || !correctionNote.trim()) return;
    setCorrectionBusy(true);
    try {
      await submitSongCorrection({
        songId: song.id,
        songTitle: song.title,
        originalValue: correctionChord,
        proposedValue: correctionProposal,
        note: correctionNote,
      });
      setCorrectionMessage('Návrh opravy byl bezpečně odeslán administrátorovi ke kontrole.');
    } catch (error) {
      setCorrectionMessage(friendlyError(error, 'Návrh opravy se nepodařilo odeslat.'));
    } finally {
      setCorrectionBusy(false);
    }
  };

  return (
    <article ref={readerRef} className={`song-reader song-reader--${readerSurface}`} onPointerDown={(event) => { revealStageControls(); if (event.pointerType === 'touch') swipeStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => { const start = swipeStart.current; swipeStart.current = null; if (!start || event.pointerType !== 'touch' || stageLocked) return; const x = event.clientX - start.x; const y = event.clientY - start.y; if (Math.abs(x) < 70 || Math.abs(x) < Math.abs(y) * 1.5) return; haptic('selection'); if (x < 0) onNextSong?.(); else onPreviousSong?.(); }} onPointerCancel={() => { swipeStart.current = null; }}>
      <div className="song-progress-track" role="progressbar" aria-label="Postup písně" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(readerProgress * 100)}><span style={{ transform: `scaleX(${readerProgress})` }} /></div>
      <header className="reader-header">
        <button type="button" className="icon-button" aria-label="Zpět do seznamu" onClick={onBack}><Icon name="back" /></button>
        <div><p className="eyebrow">{song.categories.join(' · ')}</p><h1 data-view-transition-target="song-title">{song.title}</h1><p>{song.authors.join(', ') || 'Autor neuveden'}</p></div>
        <button type="button" className="icon-button" aria-label={isFavorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'} aria-pressed={isFavorite} onClick={() => { haptic(isFavorite ? 'selection' : 'success'); onUserStateChange((current) => toggleFavorite(current, song.id)); }}><Icon name={isFavorite ? 'star' : 'heart'} /></button>
      </header>

      <details className="reader-mobile-facts">
        <summary><span><small>Tónina</small><strong>{targetKey ?? '—'}</strong></span><span><small>Kapodastr</small><strong>{capoFret ? `${capoFret}. pražec` : 'Bez'}</strong></span><span className="reader-mobile-facts__more">Podrobnosti <Icon name="chevronDown" size={17} /></span></summary>
        <div><span><small>Takt</small><strong>{song.timeSignature ?? '—'}</strong></span><span><small>Tempo</small><strong>{song.tempo ? `${song.tempo} BPM` : '—'}</strong></span><span><small>Obtížnost</small><strong>{{ easy: 'Snadná', medium: 'Střední', hard: 'Těžká', unknown: '—' }[song.difficulty]}</strong></span></div>
      </details>

      <div className="song-facts song-facts--five" aria-label="Informace o písni">
        <span><small>Tónina</small><strong>{targetKey ?? '—'}</strong></span>
        <span><small>Kapodastr</small><strong>{capoFret ? `${capoFret}. pražec` : 'Bez'}</strong></span>
        <span><small>Takt</small><strong>{song.timeSignature ?? '—'}</strong></span>
        <span><small>Tempo</small><strong>{song.tempo ? `${song.tempo} BPM` : '—'}</strong></span>
        <span><small>Obtížnost</small><strong>{{ easy: 'Snadná', medium: 'Střední', hard: 'Těžká', unknown: '—' }[song.difficulty]}</strong></span>
      </div>

      <div className="reader-tabs" role="tablist" aria-label="Obsah písně">
        <button role="tab" aria-selected={tab === 'lyrics'} className={tab === 'lyrics' ? 'tab tab--active' : 'tab'} onClick={() => setTab('lyrics')}>Text a akordy</button>
        <button role="tab" aria-selected={tab === 'score'} className={tab === 'score' ? 'tab tab--active' : 'tab'} onClick={() => setTab('score')}>Noty ({song.scoreAssets.length})</button>
      </div>

      {tab === 'lyrics' ? (
        <>
          <section className="reader-toolbar" aria-label="Nastavení čtečky">
            {isLayoutText
              ? <div className="layout-source-label"><span>Rozvržení z PDF</span><small>Automatická transpozice bude dostupná až po ruční kontrole akordů.</small></div>
              : <div className="transpose-control"><span>Transpozice</span><button type="button" aria-label="Snížit o půltón" disabled={semitones <= -12} onClick={() => { haptic(); setSemitones((value) => value - 1); }}>−</button><output aria-label="Posun v půltónech">{semitones > 0 ? `+${semitones}` : semitones}</output><button type="button" aria-label="Zvýšit o půltón" disabled={semitones >= 12} onClick={() => { haptic(); setSemitones((value) => value + 1); }}>+</button><button type="button" className="text-button" onClick={() => { haptic(); setSemitones(0); }}>Původní</button></div>}
            <div className="toolbar-actions">
              {isLayoutText && <button type="button" className="icon-button" aria-label={readerPreferences.wrapLayoutText ? 'Použít původní šířku řádků' : 'Zalomit dlouhé řádky'} aria-pressed={readerPreferences.wrapLayoutText} onClick={() => updateReaderPreferences({ wrapLayoutText: !readerPreferences.wrapLayoutText })}>↵</button>}
              <button type="button" className="icon-button reader-settings-button" aria-label="Otevřít nastavení zobrazení" onClick={() => setSettingsOpen(true)}>Aa</button>
              {!isLayoutText && <button type="button" className={`icon-button chord-edit-toggle ${chordEditMode ? 'active' : ''}`} aria-label={chordEditMode ? 'Ukončit ruční posun akordů' : 'Ručně posunout akordy'} aria-pressed={chordEditMode} onClick={() => { setChordEditMode((value) => !value); setChordEditMessage(''); setAutoScroll(false); }}><Icon name="edit" /></button>}
              <button type="button" className="icon-button" aria-label="Nahlásit nebo lokálně opravit píseň" onClick={() => openCorrection()}><Icon name="flag" /></button>
              <button type="button" className="icon-button" aria-label="Celoobrazovkový režim" onClick={toggleFullscreen}><Icon name="expand" /></button>
              <button type="button" className="icon-button fire-button" aria-label="Pódiový režim" aria-pressed={fireMode} onClick={() => void toggleFireMode()}><Icon name="fire" /><span>Pódium</span></button>
            </div>
          </section>
          {!isLayoutText && <div className={`reader-segmented ${settings.showChords ? '' : 'reader-segmented--lyrics'}`} role="group" aria-label="Zobrazení textu"><span aria-hidden="true" /><button type="button" aria-pressed={settings.showChords} onClick={() => updateSettings({ showChords: true })}>Akordy + text</button><button type="button" aria-pressed={!settings.showChords} onClick={() => updateSettings({ showChords: false })}>Pouze text</button></div>}
          <section className="reader-performance-surface" aria-label="Text a akordy písně">
            <div className="reader-guidance">
              {song.chordsVerified && <p className="verified-chords-note"><Icon name="check" size={18} /><span><strong>Akordy zkontrolovány</strong><small>Transpozice a kapodastr jsou aktivní.</small></span></p>}
              {hasLocalOverride && <p className="local-override-note"><Icon name="database" size={18} /><span><strong>Lokální oprava</strong><small>Používá se verze uložená jen v tomto zařízení.</small></span><button type="button" className="text-button" onClick={() => openCorrection()}>Upravit</button></p>}
              {chordEditMode && <div className={`chord-edit-console ${chordDraftDirty ? 'chord-edit-console--dirty' : ''}`} role="region" aria-label="Nástroje ručního posunu akordů"><p className="chord-edit-note" role="status"><Icon name="edit" size={18} /><span><strong>{chordDraftDirty ? 'Náhled neuložených úprav' : 'Ruční posun akordů'}</strong><small>Akord přetáhněte prstem nad správnou slabiku nebo klepněte a použijte přesné šipky. Změny se uloží až po vašem potvrzení.</small></span></p><div className="chord-edit-actions"><button type="button" className="secondary-button" disabled={editHistory.past.length === 0 || chordEditSaving} onClick={undoChordEdit}>↶ Zpět</button><button type="button" className="secondary-button" disabled={editHistory.future.length === 0 || chordEditSaving} onClick={redoChordEdit}>↷ Znovu</button><button type="button" className="secondary-button" disabled={chordEditSaving} onClick={normalizeSongChords}>Převést „is“ na #</button>{chordDraftDirty && <><button type="button" className="primary-button" disabled={chordEditSaving} onClick={() => void saveChordDraft()}>{chordEditSaving ? 'Ukládám…' : 'Uložit úpravy'}</button><button type="button" className="secondary-button" disabled={chordEditSaving} onClick={discardChordDraft}>Zahodit náhled</button></>}</div>{chordSourceIssues.length > 0 && <details className="chord-source-audit"><summary>{chordSourceIssues.length} míst vyžaduje pozornost</summary><ul>{chordSourceIssues.slice(0, 12).map((issue, index) => <li key={`${issue.line}-${issue.kind}-${index}`}><strong>Řádek {issue.line}</strong> · {issue.message}</li>)}</ul></details>}</div>}
              {chordEditMessage && <p className="info-message chord-edit-message" role="status">{chordEditMessage}</p>}
              {targetKey && capoOptions.length > 1 && <details className="capo-hint"><summary><Icon name="info" size={17} />Kapodastr a hmaty <span>{capoFret ? `${capoFret}. pražec` : 'bez'}</span></summary><div className="capo-planner"><div className="capo-signal-flow" aria-label={`Znějící tónina ${targetKey}, kapodastr ${capoFret ? `${capoFret}. pražec` : 'bez'}, hrané hmaty ${activeCapo?.shapeKey ?? targetKey}`}><span><small>Zní</small><strong>{targetKey}</strong></span><Icon name="chevronRight" /><span><small>Kapodastr</small><strong>{capoFret ? `${capoFret}.` : 'Bez'}</strong></span><Icon name="chevronRight" /><span><small>Hrajete</small><strong>{activeCapo?.shapeKey ?? targetKey}</strong></span></div><header><span><small>Znějící tónina</small><strong>{targetKey}</strong></span><span><small>Hrané hmaty</small><strong>{activeCapo?.shapeKey ?? targetKey}</strong></span><span><small>Obtížné hmaty</small><strong>{activeCapo ? `${activeCapo.barreCount} barré · ${activeCapo.advancedCount} pokročilých` : '—'}</strong></span></header><p>Zvolte pražec. Akordy v textu se automaticky přepíšou na hmaty, ale znějící tónina zůstane stejná.{song.capo ? ` Původní podklad uvádí ${song.capo}. pražec.` : ''}</p><div className="capo-level-control" role="group" aria-label="Úroveň hráče">{([['beginner', 'Začátečník'], ['standard', 'Běžně'], ['all', 'Všechny možnosti']] as const).map(([value, label]) => <button type="button" className={capoPlayerLevel === value ? 'active' : ''} aria-pressed={capoPlayerLevel === value} onClick={() => { haptic(); setCapoPlayerLevel(value); }} key={value}>{label}</button>)}</div><div className="capo-option-grid" role="radiogroup" aria-label="Vybrat polohu kapodastru">{capoOptions.map((option) => <button type="button" role="radio" aria-checked={capoFret === option.capo} className={`${capoFret === option.capo ? 'active' : ''} capo-option--${option.difficulty}`} onClick={() => { setCapoFret(option.capo); haptic('selection'); }} key={option.capo}><small>{option.capo === 0 ? 'Bez' : `${option.capo}. pražec`}</small><strong>{option.shapeKey}</strong><span>{option.barreCount ? `${option.barreCount}× barré` : 'bez barré'}</span>{option.recommended && <em>Doporučeno</em>}</button>)}</div><button type="button" className="text-button" disabled={capoFret === 0} onClick={() => { haptic(); setCapoFret(0); }}>Vrátit bez kapodastru</button></div></details>}
            </div>
            {loadError && <p className="error-message" role="alert">{loadError}</p>}
            {!source && !loadError && <div className="reader-loading-skeleton" role="status" aria-label="Načítám píseň"><span /><span /><span /><span /><span /></div>}
            {source && <div className="fire-tap-zone">
              {isLayoutText
                ? <pre className={readerPreferences.wrapLayoutText ? 'layout-song-sheet layout-song-sheet--wrap' : 'layout-song-sheet'} style={{ '--song-font-size': `${readerFontSize}px` } as React.CSSProperties}>{source}</pre>
                : <ChordSheet source={source} semitones={semitones - capoFret} notation={settings.notation} sourceNotation={sourceNotation} showChords={settings.showChords} collapseRepeatedChoruses={settings.collapseRepeatedChoruses} fontSize={readerFontSize} chordScale={readerPreferences.chordScale} lineHeight={readerPreferences.lineHeight} columnWidth={readerPreferences.columnWidth} focusSections={readerPreferences.focusSections} performanceProgress={fireMode ? readerProgress : null} editMode={chordEditMode} onMoveChord={moveChord} onSuggestCorrection={openCorrection} />}
            </div>}
          </section>
          <section className="field-actions" aria-label="Funkce pro zpívání">
            <label><span><Icon name="play" size={18} />Rychlost posunu</span><output>{settings.autoScrollSpeed}</output><input type="range" min="5" max="100" value={settings.autoScrollSpeed} onChange={(event) => updateSettings({ autoScrollSpeed: Number(event.target.value) })} /></label>
            {navigator.wakeLock && <button type="button" className="secondary-button" aria-pressed={Boolean(wakeLock)} onClick={toggleWakeLock}>{wakeLock ? 'Povolit zhasnutí' : 'Nezhasínat displej'}</button>}
            <button type="button" className="secondary-button" onClick={() => window.print()}><Icon name="printer" size={18} />Tisk písně</button>
          </section>
          <section className="setlist-add" aria-label="Přidat do setlistu">
            {userState.setlists.length > 0 ? <><label>Vybrat setlist<select value={effectiveSetlistId} onChange={(event) => { setSetlistId(event.target.value); setSetlistMessage(''); }}>{userState.setlists.map((setlist) => <option value={setlist.id} key={setlist.id}>{setlist.name} ({setlist.songIds.length})</option>)}</select></label><button type="button" className="primary-button" disabled={alreadyInSetlist} onClick={addToSetlist}><Icon name={alreadyInSetlist ? 'check' : 'plus'} size={18} />{alreadyInSetlist ? 'Již přidáno' : 'Přidat do setlistu'}</button>{setlistMessage && <p className="setlist-add-message" role="status">{setlistMessage}</p>}</> : <p>Nejdřív vytvořte setlist v části <strong>Setlisty</strong>, potom se sem vraťte.</p>}
          </section>
          <footer className="rights-card"><strong>Práva a původ</strong><span>{song.source}</span><span>{song.personalOnly ? 'Ke kontrole · pouze osobní místní koncept' : song.rightsStatus} · {song.license}</span><span>{song.attribution}</span></footer>
          {(previousSong || nextSong) && <nav className="reader-sequence-nav" aria-label="Pohyb v setlistu"><button type="button" className="secondary-button" disabled={!previousSong} onClick={onPreviousSong}><span aria-hidden="true">←</span><span><small>Předchozí</small><strong>{previousSong?.title ?? 'Začátek setlistu'}</strong></span></button><button type="button" className="secondary-button" disabled={!nextSong} onClick={onNextSong}><span><small>Další</small><strong>{nextSong?.title ?? 'Konec setlistu'}</strong></span><span aria-hidden="true">→</span></button><small>Na telefonu lze mezi písněmi také přejet prstem doleva nebo doprava.</small></nav>}
          {fireMode && <>
            <button type="button" className={`stage-wake-button ${stageControlsVisible ? 'stage-wake-button--hidden' : ''}`} aria-label={stageLocked ? 'Odemknout a zobrazit pódiové ovládání' : 'Zobrazit pódiové ovládání'} onClick={() => { if (stageLocked) setStageLocked(false); setStageControlsVisible(true); }}>{stageLocked ? '🔒' : '•••'}</button>
            <div className={`fire-dock ${stageControlsVisible ? '' : 'fire-dock--hidden'}`} aria-label="Rychlé pódiové ovládání" aria-hidden={!stageControlsVisible}>
              <div className="fire-stage-progress" role="progressbar" aria-label="Postup písně v pódiovém režimu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(readerProgress * 100)}><span><strong>{Math.round(readerProgress * 100)} %</strong><small>postup písně</small></span><i><b style={{ width: `${Math.round(readerProgress * 100)}%` }} /></i></div>
              <div className="fire-font-control" role="group" aria-label="Velikost textu">
                <span>Text</span>
                <button type="button" aria-label="Zmenšit pódiový text" disabled={readerPreferences.stageFontSize <= 14} onClick={() => updateReaderPreferences({ stageFontSize: Math.max(14, readerPreferences.stageFontSize - 2) })}>A−</button>
                <output aria-label="Aktuální velikost textu">{readerPreferences.stageFontSize} px</output>
                <button type="button" aria-label="Zvětšit pódiový text" disabled={readerPreferences.stageFontSize >= 40} onClick={() => updateReaderPreferences({ stageFontSize: Math.min(40, readerPreferences.stageFontSize + 2) })}>A+</button>
              </div>
              <label className="fire-speed-control"><span>Rychlost</span><input type="range" min="5" max="100" value={settings.autoScrollSpeed} onChange={(event) => updateSettings({ autoScrollSpeed: Number(event.target.value) })} /><output>{settings.autoScrollSpeed}</output></label>
              <button type="button" className={autoScroll ? 'primary-button' : 'secondary-button'} onClick={() => setAutoScroll((value) => !value)}>{autoScroll ? '■ Pauza' : '▶ Posun'}</button>
              <button type="button" className="secondary-button" aria-pressed={stageLocked} onClick={() => { setStageLocked((value) => !value); setStageControlsVisible(false); }}>{stageLocked ? 'Odemknout' : 'Zamknout'}</button>
              <button type="button" className="secondary-button fire-exit-button" aria-label="Ukončit pódiový režim" onClick={() => void toggleFireMode()}>Zavřít</button>
              {(previousSong || nextSong) && <nav className="fire-sequence-controls" aria-label="Přechod mezi písněmi v setlistu"><button type="button" disabled={!previousSong} onClick={onPreviousSong}><Icon name="chevronLeft" /><span><small>Předchozí</small><strong>{previousSong?.title ?? 'Začátek'}</strong></span></button><button type="button" disabled={!nextSong} onClick={onNextSong}><span><small>Další</small><strong>{nextSong?.title ?? 'Konec'}</strong></span><Icon name="chevronRight" /></button></nav>}
            </div>
          </>}
          {!fireMode && <button type="button" className={`performance-fab ${autoScroll ? 'performance-fab--active' : ''}`} aria-label={autoScroll ? 'Pozastavit automatický posun' : countdown !== null ? 'Zrušit odpočet' : 'Spustit odpočet a automatický posun'} aria-pressed={autoScroll} onClick={performanceAction}><span aria-hidden="true">{countdown !== null ? countdown : <Icon name={autoScroll ? 'pause' : 'play'} size={23} />}</span><small>{autoScroll ? 'Pauza' : countdown !== null ? 'Start' : 'Posun'}</small></button>}
          {settingsOpen && <div className="reader-sheet-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}><section className="reader-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="reader-settings-heading" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" aria-hidden="true" /><header><span><small>Nastavení výkonu</small><h2 id="reader-settings-heading">Zobrazení písně</h2></span><button type="button" className="icon-button" aria-label="Zavřít nastavení" onClick={() => setSettingsOpen(false)}><Icon name="close" /></button></header><label className="reader-song-preference"><input type="checkbox" checked={hasSongReaderPreferences} onChange={(event) => toggleSongReaderPreferences(event.target.checked)} /><span><strong>Vlastní nastavení této písně</strong><small>{hasSongReaderPreferences ? 'Změny platí pouze zde.' : 'Změny se použijí jako výchozí pro všechny písně.'}</small></span></label><div className="reader-control-grid"><label htmlFor="reader-font-size"><span>Velikost textu</span><output>{settings.fontSize} px</output><input id="reader-font-size" aria-label="Nastavit velikost textu" type="range" min="14" max="34" step="2" value={settings.fontSize} onChange={(event) => updateSettings({ fontSize: Number(event.target.value) })} /></label><label htmlFor="reader-chord-size"><span>Velikost akordů</span><output>{Math.round(readerPreferences.chordScale * 100)} %</output><input id="reader-chord-size" type="range" min="0.75" max="1.4" step="0.05" value={readerPreferences.chordScale} onChange={(event) => updateReaderPreferences({ chordScale: Number(event.target.value) })} /></label><label htmlFor="reader-line-height"><span>Řádkování</span><output>{readerPreferences.lineHeight.toFixed(1)}</output><input id="reader-line-height" type="range" min="1.15" max="1.8" step="0.05" value={readerPreferences.lineHeight} onChange={(event) => updateReaderPreferences({ lineHeight: Number(event.target.value) })} /></label><label htmlFor="reader-column-width"><span>Šířka textu</span><output>{readerPreferences.columnWidth} px</output><input id="reader-column-width" type="range" min="320" max="980" step="20" value={readerPreferences.columnWidth} onChange={(event) => updateReaderPreferences({ columnWidth: Number(event.target.value) })} /></label><label htmlFor="reader-scroll-speed"><span>Rychlost posunu</span><output>{settings.autoScrollSpeed}</output><input id="reader-scroll-speed" aria-label="Nastavit rychlost posunu" type="range" min="5" max="100" value={settings.autoScrollSpeed} onChange={(event) => updateSettings({ autoScrollSpeed: Number(event.target.value) })} /></label><label className="switch-row"><input type="checkbox" checked={readerPreferences.focusSections} onChange={(event) => updateReaderPreferences({ focusSections: event.target.checked })} /> Režim soustředění – klepnutím zvýraznit aktuální sloku</label></div><div className="reader-surface-options" role="group" aria-label="Povrch stránky"><span><small>Povrch stránky</small><strong>Čistý nebo papírový zpěvník</strong></span>{(['standard', 'paper'] as const).map((surface) => <button type="button" className={readerSurface === surface ? 'active' : ''} aria-pressed={readerSurface === surface} onClick={() => { haptic(); setReaderSurface(surface); }} key={surface}>{surface === 'standard' ? 'Čistý' : 'Papír'}</button>)}</div><div className="sheet-theme-options" role="group" aria-label="Motiv čtečky">{(['light', 'dark', 'system'] as const).map((theme) => <button type="button" className={settings.theme === theme ? 'active' : ''} aria-pressed={settings.theme === theme} onClick={() => { haptic(); updateSettings({ theme }); }} key={theme}>{theme === 'light' ? 'Světlý' : theme === 'dark' ? 'Tmavý' : 'Systém'}</button>)}</div><button type="button" className="primary-button" onClick={() => { haptic('success'); setSettingsOpen(false); }}>Hotovo</button></section></div>}
          {correctionOpen && <div className="reader-sheet-backdrop" role="presentation" onClick={() => setCorrectionOpen(false)}><section className="reader-settings-sheet correction-sheet" role="dialog" aria-modal="true" aria-labelledby="correction-heading" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" aria-hidden="true" /><header><span><small>Oprava bez rizika</small><h2 id="correction-heading">Opravit nebo navrhnout změnu</h2></span><button type="button" className="icon-button" aria-label="Zavřít opravu" onClick={() => setCorrectionOpen(false)}><Icon name="close" /></button></header><p>Lokální verze zůstane pouze v tomto zařízení. Návrh správci se uloží do soukromé fronty ke kontrole a nic automaticky nezveřejní.</p>{correctionChord && <div className="correction-value-grid"><label>Původní hodnota<input value={correctionChord} readOnly /></label><label>Navržená hodnota<input value={correctionProposal} maxLength={160} onChange={(event) => setCorrectionProposal(event.target.value)} placeholder="Např. C#mi7" /></label></div>}<label>Poznámka pro administrátora<textarea value={correctionNote} maxLength={2000} onChange={(event) => setCorrectionNote(event.target.value)} placeholder="Co je špatně a kde přesně?" /></label><button type="button" className="secondary-button" disabled={!secureProfile || correctionBusy || !correctionNote.trim()} onClick={() => void submitCorrection()}><Icon name="upload" />{secureProfile ? 'Odeslat návrh administrátorovi' : 'Přihlášení je nutné pro odeslání'}</button><details className="local-source-editor"><summary><Icon name="edit" />Upravit lokální ChordPro verzi</summary><label>Text a akordy<textarea value={editableSource} spellCheck={false} onChange={(event) => setEditableSource(event.target.value)} /></label><div className="button-row"><button type="button" className="primary-button" disabled={correctionBusy || !editableSource.trim()} onClick={() => void saveLocalCorrection()}><Icon name="database" />Uložit jen do tohoto zařízení</button>{hasLocalOverride && <button type="button" className="secondary-button" disabled={correctionBusy} onClick={() => void resetLocalCorrection()}>Obnovit původní verzi</button>}</div></details>{correctionMessage && <p className="info-message" role="status">{correctionMessage}</p>}</section></div>}
        </>
      ) : <Suspense fallback={<p className="score-note" role="status">Načítám notový modul až nyní…</p>}><ScoreViewer assets={song.scoreAssets} catalogVersion={catalogVersion} /></Suspense>}
    </article>
  );
}
