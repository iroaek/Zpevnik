import { useEffect, useMemo, useRef, useState } from 'react';
import { metadataValue, parseChordPro, sanitizeImportedText } from '../domain/chordpro';
import { calculateCapoOptions, parseChord, renderPitch, transposeCanonicalChord } from '../domain/chords';
import type { Song } from '../domain/song';
import { fetchContent } from '../pwa/contentCache';
import { getPersonalSongContent, toggleFavorite, updateSetlistSongs, type UserState } from '../storage/database';
import { ChordSheet } from './ChordSheet';
import { ScoreViewer } from './ScoreViewer';

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
}

export function SongReader({ song, userState, onUserStateChange, onBack, catalogVersion, previousSong, nextSong, onPreviousSong, onNextSong }: SongReaderProps) {
  const [source, setSource] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [semitones, setSemitones] = useState(0);
  const [tab, setTab] = useState<'lyrics' | 'score'>('lyrics');
  const [autoScroll, setAutoScroll] = useState(false);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [fireMode, setFireMode] = useState(false);
  const [fireFontSize, setFireFontSize] = useState(() => Math.min(34, Math.max(14, userState.settings.fontSize)));
  const [wrapLayoutText, setWrapLayoutText] = useState(true);
  const [orientationLocked, setOrientationLocked] = useState(false);
  const [setlistId, setSetlistId] = useState(userState.setlists[0]?.id ?? '');
  const [setlistMessage, setSetlistMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readerProgress, setReaderProgress] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const readerRef = useRef<HTMLElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const settings = userState.settings;
  const isLayoutText = song.contentFormat === 'layout_text';

  useEffect(() => {
    const controller = new AbortController();
    const response = song.chordProPath.startsWith('indexeddb:')
      ? getPersonalSongContent(song.id).then((content) => {
        if (content === null) throw new Error('Obsah osobní písně v tomto zařízení chybí.');
        return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      })
      : song.personalOnly
        ? fetch(song.chordProPath, { cache: 'no-store', signal: controller.signal })
        : fetchContent(song.chordProPath, 'songs', catalogVersion, controller.signal);
    response
      .then((response) => {
        if (!response.ok) throw new Error(`Soubor písně se nepodařilo načíst (${response.status}).`);
        return response.text();
      })
      .then((text) => setSource(sanitizeImportedText(text)))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setLoadError(error instanceof Error ? error.message : 'Píseň je nečitelná.');
      });
    return () => controller.abort();
  }, [catalogVersion, song]);

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

  useEffect(() => () => { screen.orientation.unlock?.(); }, []);

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

  const parsedSource = useMemo(() => source && !isLayoutText ? parseChordPro(source) : null, [isLayoutText, source]);
  const sourceNotation = metadataValue(parsedSource?.metadata ?? {}, 'chord_notation') === 'international' ? 'international' : 'czech';
  const targetKey = useMemo(() => {
    if (!song.originalKey) return null;
    const parsed = parseChord(song.originalKey, sourceNotation);
    return parsed ? renderPitch(transposeCanonicalChord(parsed, semitones).root, settings.notation, parsed.root.accidental === 'flat' ? 'flat' : 'sharp') : song.originalKey;
  }, [song.originalKey, sourceNotation, semitones, settings.notation]);
  const capoOptions = targetKey ? calculateCapoOptions(targetKey, settings.notation) : [];
  const isFavorite = userState.favorites.includes(song.id);
  const effectiveSetlistId = userState.setlists.some((setlist) => setlist.id === setlistId)
    ? setlistId
    : userState.setlists[0]?.id ?? '';
  const selectedSetlist = userState.setlists.find((setlist) => setlist.id === effectiveSetlistId);
  const alreadyInSetlist = Boolean(selectedSetlist?.songIds.includes(song.id));
  const readerFontSize = fireMode ? fireFontSize : settings.fontSize;

  const updateSettings = (change: Partial<UserState['settings']>) => {
    onUserStateChange((current) => ({ ...current, settings: { ...current.settings, ...change } }));
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
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  };

  const toggleFireMode = () => {
    const next = !fireMode;
    if (next) setFireFontSize(settings.fontSize);
    setFireMode(next);
  };

  const performanceAction = () => {
    if (autoScroll) {
      setAutoScroll(false);
      return;
    }
    if (countdown !== null) {
      setCountdown(null);
      return;
    }
    setCountdown(3);
  };

  const toggleOrientationLock = async () => {
    if (!screen.orientation.lock) return;
    try {
      if (orientationLocked) {
        screen.orientation.unlock?.();
        setOrientationLocked(false);
      } else {
        await screen.orientation.lock('portrait');
        setOrientationLocked(true);
      }
    } catch {
      setOrientationLocked(false);
    }
  };

  return (
    <article ref={readerRef} className="song-reader" onPointerDown={(event) => { if (event.pointerType === 'touch') swipeStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={(event) => { const start = swipeStart.current; swipeStart.current = null; if (!start || event.pointerType !== 'touch') return; const x = event.clientX - start.x; const y = event.clientY - start.y; if (Math.abs(x) < 70 || Math.abs(x) < Math.abs(y) * 1.5) return; if (x < 0) onNextSong?.(); else onPreviousSong?.(); }} onPointerCancel={() => { swipeStart.current = null; }}>
      <div className="song-progress-track" role="progressbar" aria-label="Postup písní" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(readerProgress * 100)}><span style={{ transform: `scaleX(${readerProgress})` }} /></div>
      <header className="reader-header">
        <button type="button" className="icon-button" aria-label="Zpět do seznamu" onClick={onBack}>‹</button>
        <div><p className="eyebrow">{song.categories.join(' · ')}</p><h1>{song.title}</h1><p>{song.authors.join(', ') || 'Autor neuveden'}</p></div>
        <button type="button" className="icon-button" aria-label={isFavorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'} aria-pressed={isFavorite} onClick={() => onUserStateChange((current) => toggleFavorite(current, song.id))}>{isFavorite ? '★' : '☆'}</button>
      </header>

      <div className="song-facts" aria-label="Informace o písni">
        <span><small>Tónina</small><strong>{targetKey ?? '—'}</strong></span>
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
              : <div className="transpose-control"><span>Transpozice</span><button type="button" aria-label="Snížit o půltón" disabled={semitones <= -12} onClick={() => setSemitones((value) => value - 1)}>−</button><output aria-label="Posun v půltónech">{semitones > 0 ? `+${semitones}` : semitones}</output><button type="button" aria-label="Zvýšit o půltón" disabled={semitones >= 12} onClick={() => setSemitones((value) => value + 1)}>+</button><button type="button" className="text-button" onClick={() => setSemitones(0)}>Původní</button></div>}
            <div className="toolbar-actions">
              {isLayoutText && <button type="button" className="icon-button" aria-label={wrapLayoutText ? 'Použít původní šířku řádků' : 'Zalomit dlouhé řádky'} aria-pressed={wrapLayoutText} onClick={() => setWrapLayoutText((value) => !value)}>↵</button>}
              <button type="button" className="icon-button reader-settings-button" aria-label="Otevřít nastavení zobrazení" onClick={() => setSettingsOpen(true)}>Aa</button>
              <button type="button" className="icon-button" aria-label="Celoobrazovkový režim" onClick={toggleFullscreen}>⛶</button>
              <button type="button" className="icon-button fire-button" aria-label="Režim U ohně" aria-pressed={fireMode} onClick={toggleFireMode}>U ohně</button>
            </div>
          </section>
          {!isLayoutText && <div className={`reader-segmented ${settings.showChords ? '' : 'reader-segmented--lyrics'}`} role="group" aria-label="Zobrazení textu"><span aria-hidden="true" /><button type="button" aria-pressed={settings.showChords} onClick={() => updateSettings({ showChords: true })}>Akordy + text</button><button type="button" aria-pressed={!settings.showChords} onClick={() => updateSettings({ showChords: false })}>Pouze text</button></div>}
          {targetKey && capoOptions.length > 1 && <p className="capo-hint">Možnosti kapodastru: {capoOptions.map((option) => option.capo === 0 ? `bez kapodastru (${option.shapeKey})` : `${option.capo}. pražec, hraj ${option.shapeKey}`).join(' · ')}</p>}
          {song.chordsVerified && <p className="verified-chords-note">✓ Akordy jsou označené jako zkontrolované. Transpozice i návrhy kapodastru jsou aktivní.</p>}
          {loadError && <p className="error-message" role="alert">{loadError}</p>}
          {!source && !loadError && <p role="status">Načítám píseň…</p>}
          {source && <div className="fire-tap-zone">
            {isLayoutText
              ? <pre className={wrapLayoutText ? 'layout-song-sheet layout-song-sheet--wrap' : 'layout-song-sheet'} style={{ '--song-font-size': `${readerFontSize}px` } as React.CSSProperties}>{source}</pre>
              : <ChordSheet source={source} semitones={semitones} notation={settings.notation} sourceNotation={sourceNotation} showChords={settings.showChords} collapseRepeatedChoruses={settings.collapseRepeatedChoruses} fontSize={readerFontSize} />}
          </div>}
          <section className="field-actions" aria-label="Funkce pro zpívání">
            <label>Rychlost <input type="range" min="5" max="100" value={settings.autoScrollSpeed} onChange={(event) => updateSettings({ autoScrollSpeed: Number(event.target.value) })} /></label>
            {navigator.wakeLock && <button type="button" className="secondary-button" aria-pressed={Boolean(wakeLock)} onClick={toggleWakeLock}>{wakeLock ? 'Povolit zhasnutí' : 'Nezhasínat displej'}</button>}
            <button type="button" className="secondary-button" onClick={() => window.print()}>Tisk písně</button>
          </section>
          <section className="setlist-add" aria-label="Přidat do setlistu">
            {userState.setlists.length > 0 ? <><label>Vybrat setlist<select value={effectiveSetlistId} onChange={(event) => { setSetlistId(event.target.value); setSetlistMessage(''); }}>{userState.setlists.map((setlist) => <option value={setlist.id} key={setlist.id}>{setlist.name} ({setlist.songIds.length})</option>)}</select></label><button type="button" className="primary-button" disabled={alreadyInSetlist} onClick={addToSetlist}>{alreadyInSetlist ? 'Již přidáno' : 'Přidat do setlistu'}</button>{setlistMessage && <p className="setlist-add-message" role="status">{setlistMessage}</p>}</> : <p>Nejdřív vytvořte setlist v části <strong>Setlisty</strong>, potom se sem vraťte.</p>}
          </section>
          <footer className="rights-card"><strong>Práva a původ</strong><span>{song.source}</span><span>{song.personalOnly ? 'Ke kontrole · pouze osobní místní koncept' : song.rightsStatus} · {song.license}</span><span>{song.attribution}</span></footer>
          {(previousSong || nextSong) && <nav className="reader-sequence-nav" aria-label="Pohyb v setlistu"><button type="button" className="secondary-button" disabled={!previousSong} onClick={onPreviousSong}><span aria-hidden="true">←</span><span><small>Předchozí</small><strong>{previousSong?.title ?? 'Začátek setlistu'}</strong></span></button><button type="button" className="secondary-button" disabled={!nextSong} onClick={onNextSong}><span><small>Další</small><strong>{nextSong?.title ?? 'Konec setlistu'}</strong></span><span aria-hidden="true">→</span></button><small>Na telefonu lze mezi písněmi také přejet prstem doleva nebo doprava.</small></nav>}
          {fireMode && <div className="fire-dock" aria-label="Rychlé ovládání režimu U ohně"><div className="fire-font-control" role="group" aria-label="Velikost textu"><span>Text</span><button type="button" aria-label="Zmenšit text v režimu U ohně" disabled={fireFontSize <= 14} onClick={() => setFireFontSize((value) => Math.max(14, value - 2))}>A−</button><output aria-label="Aktuální velikost textu">{fireFontSize} px</output><button type="button" aria-label="Zvětšit text v režimu U ohně" disabled={fireFontSize >= 34} onClick={() => setFireFontSize((value) => Math.min(34, value + 2))}>A+</button></div><label className="fire-speed-control"><span>Rychlost posunu</span><input type="range" min="5" max="100" value={settings.autoScrollSpeed} onChange={(event) => updateSettings({ autoScrollSpeed: Number(event.target.value) })} /><output>{settings.autoScrollSpeed}</output></label><button type="button" className={autoScroll ? 'primary-button' : 'secondary-button'} onClick={() => setAutoScroll((value) => !value)}>{autoScroll ? '■ Stop' : '▶ Posun'}</button>{screen.orientation.lock && <button type="button" className="secondary-button" aria-label={orientationLocked ? 'Odemknout otočení obrazovky' : 'Zamknout obrazovku na výšku'} aria-pressed={orientationLocked} onClick={() => void toggleOrientationLock()}>{orientationLocked ? 'Volné' : 'Výška'}</button>}<button type="button" className="secondary-button fire-exit-button" aria-label="Ukončit U ohně" onClick={toggleFireMode}>Zavřít</button></div>}
          {!fireMode && <button type="button" className={`performance-fab ${autoScroll ? 'performance-fab--active' : ''}`} aria-label={autoScroll ? 'Pozastavit automatický posun' : countdown !== null ? 'Zrušit odpočet' : 'Spustit odpočet a automatický posun'} aria-pressed={autoScroll} onClick={performanceAction}><span aria-hidden="true">{autoScroll ? 'Ⅱ' : countdown ?? '▶'}</span><small>{autoScroll ? 'Pauza' : countdown !== null ? 'Start' : 'Posun'}</small></button>}
          {settingsOpen && <div className="reader-sheet-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}><section className="reader-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="reader-settings-heading" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" aria-hidden="true" /><header><span><small>Nastavení výkonu</small><h2 id="reader-settings-heading">Zobrazení písně</h2></span><button type="button" className="icon-button" aria-label="Zavřít nastavení" onClick={() => setSettingsOpen(false)}>×</button></header><label htmlFor="reader-font-size"><span>Velikost textu</span><output>{settings.fontSize} px</output><input id="reader-font-size" aria-label="Nastavit velikost textu" type="range" min="14" max="34" step="2" value={settings.fontSize} onChange={(event) => updateSettings({ fontSize: Number(event.target.value) })} /></label><label htmlFor="reader-scroll-speed"><span>Rychlost posunu</span><output>{settings.autoScrollSpeed}</output><input id="reader-scroll-speed" aria-label="Nastavit rychlost posunu" type="range" min="5" max="100" value={settings.autoScrollSpeed} onChange={(event) => updateSettings({ autoScrollSpeed: Number(event.target.value) })} /></label><div className="sheet-theme-options" role="group" aria-label="Motiv čtečky">{(['light', 'dark', 'system'] as const).map((theme) => <button type="button" className={settings.theme === theme ? 'active' : ''} aria-pressed={settings.theme === theme} onClick={() => updateSettings({ theme })} key={theme}>{theme === 'light' ? 'Světlý' : theme === 'dark' ? 'Tmavý' : 'Systém'}</button>)}</div><button type="button" className="primary-button" onClick={() => setSettingsOpen(false)}>Hotovo</button></section></div>}
        </>
      ) : <ScoreViewer assets={song.scoreAssets} catalogVersion={catalogVersion} />}
    </article>
  );
}
