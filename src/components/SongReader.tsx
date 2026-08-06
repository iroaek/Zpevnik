import { useEffect, useMemo, useState } from 'react';
import { metadataValue, parseChordPro } from '../domain/chordpro';
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
}

export function SongReader({ song, userState, onUserStateChange, onBack, catalogVersion }: SongReaderProps) {
  const [source, setSource] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [semitones, setSemitones] = useState(0);
  const [tab, setTab] = useState<'lyrics' | 'score'>('lyrics');
  const [autoScroll, setAutoScroll] = useState(false);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [fireMode, setFireMode] = useState(false);
  const [orientationLocked, setOrientationLocked] = useState(false);
  const [setlistId, setSetlistId] = useState(userState.setlists[0]?.id ?? '');
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
      .then(setSource)
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setLoadError(error instanceof Error ? error.message : 'Píseň je nečitelná.');
      });
    return () => controller.abort();
  }, [catalogVersion, song]);

  useEffect(() => {
    if (!autoScroll) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      window.scrollBy(0, settings.autoScrollSpeed * elapsed / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoScroll, settings.autoScrollSpeed]);

  useEffect(() => () => { void wakeLock?.release(); }, [wakeLock]);

  useEffect(() => {
    document.documentElement.dataset.fireMode = fireMode ? 'true' : 'false';
    return () => { delete document.documentElement.dataset.fireMode; };
  }, [fireMode]);

  useEffect(() => () => { screen.orientation.unlock?.(); }, []);

  const parsedSource = useMemo(() => source && !isLayoutText ? parseChordPro(source) : null, [isLayoutText, source]);
  const sourceNotation = metadataValue(parsedSource?.metadata ?? {}, 'chord_notation') === 'international' ? 'international' : 'czech';
  const targetKey = useMemo(() => {
    if (!song.originalKey) return null;
    const parsed = parseChord(song.originalKey, sourceNotation);
    return parsed ? renderPitch(transposeCanonicalChord(parsed, semitones).root, settings.notation, parsed.root.accidental === 'flat' ? 'flat' : 'sharp') : song.originalKey;
  }, [song.originalKey, sourceNotation, semitones, settings.notation]);
  const capoOptions = targetKey ? calculateCapoOptions(targetKey, settings.notation) : [];
  const isFavorite = userState.favorites.includes(song.id);

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
    if (!setlistId) return;
    onUserStateChange((current) => {
      const setlist = current.setlists.find((candidate) => candidate.id === setlistId);
      if (!setlist || setlist.songIds.includes(song.id)) return current;
      return updateSetlistSongs(current, setlistId, [...setlist.songIds, song.id]);
    });
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  };

  const toggleFireMode = async () => {
    const next = !fireMode;
    setFireMode(next);
    if (next && !document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen?.(); } catch { /* Fullscreen není povinný. */ }
    }
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
    <article className="song-reader">
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
              <button type="button" className="icon-button" aria-label="Zmenšit písmo" onClick={() => updateSettings({ fontSize: Math.max(14, settings.fontSize - 2) })}>A−</button>
              <button type="button" className="icon-button" aria-label="Zvětšit písmo" onClick={() => updateSettings({ fontSize: Math.min(34, settings.fontSize + 2) })}>A+</button>
              {!isLayoutText && <button type="button" className="icon-button" aria-label={settings.showChords ? 'Skrýt akordy' : 'Zobrazit akordy'} aria-pressed={settings.showChords} onClick={() => updateSettings({ showChords: !settings.showChords })}>♯</button>}
              <button type="button" className="icon-button" aria-label="Celoobrazovkový režim" onClick={toggleFullscreen}>⛶</button>
              <button type="button" className="icon-button fire-button" aria-label="Režim U ohně" aria-pressed={fireMode} onClick={() => void toggleFireMode()}>♨</button>
            </div>
          </section>
          {targetKey && capoOptions.length > 1 && <p className="capo-hint">Možnosti kapodastru: {capoOptions.map((option) => option.capo === 0 ? `bez kapodastru (${option.shapeKey})` : `${option.capo}. pražec, hraj ${option.shapeKey}`).join(' · ')}</p>}
          {song.chordsVerified && <p className="verified-chords-note">✓ Akordy jsou označené jako zkontrolované. Transpozice i návrhy kapodastru jsou aktivní.</p>}
          {loadError && <p className="error-message" role="alert">{loadError}</p>}
          {!source && !loadError && <p role="status">Načítám píseň…</p>}
          {source && <div className="fire-tap-zone" onPointerDown={() => { if (autoScroll) setAutoScroll(false); }}>
            {isLayoutText
              ? <pre className="layout-song-sheet" style={{ '--song-font-size': `${fireMode ? Math.max(settings.fontSize, 28) : settings.fontSize}px` } as React.CSSProperties}>{source}</pre>
              : <ChordSheet source={source} semitones={semitones} notation={settings.notation} sourceNotation={sourceNotation} showChords={settings.showChords} collapseRepeatedChoruses={settings.collapseRepeatedChoruses} fontSize={fireMode ? Math.max(settings.fontSize, 28) : settings.fontSize} />}
          </div>}
          <section className="field-actions" aria-label="Funkce pro zpívání">
            <button type="button" className={autoScroll ? 'secondary-button active' : 'secondary-button'} aria-pressed={autoScroll} onClick={() => setAutoScroll((value) => !value)}>{autoScroll ? 'Zastavit posun' : 'Automatický posun'}</button>
            <label>Rychlost <input type="range" min="5" max="100" value={settings.autoScrollSpeed} onChange={(event) => updateSettings({ autoScrollSpeed: Number(event.target.value) })} /></label>
            {navigator.wakeLock && <button type="button" className="secondary-button" aria-pressed={Boolean(wakeLock)} onClick={toggleWakeLock}>{wakeLock ? 'Povolit zhasnutí' : 'Nezhasínat displej'}</button>}
            <button type="button" className="secondary-button" onClick={() => window.print()}>Tisk písně</button>
          </section>
          <section className="setlist-add" aria-label="Přidat do setlistu">
            {userState.setlists.length > 0 ? <><label>Setlist<select value={setlistId} onChange={(event) => setSetlistId(event.target.value)}>{userState.setlists.map((setlist) => <option value={setlist.id} key={setlist.id}>{setlist.name}</option>)}</select></label><button type="button" className="primary-button" onClick={addToSetlist}>Přidat</button></> : <p>Setlist lze nejdřív vytvořit v části Setlisty.</p>}
          </section>
          <footer className="rights-card"><strong>Práva a původ</strong><span>{song.source}</span><span>{song.personalOnly ? 'Ke kontrole · pouze osobní místní koncept' : song.rightsStatus} · {song.license}</span><span>{song.attribution}</span></footer>
          {fireMode && <div className="fire-dock" aria-label="Rychlé ovládání režimu U ohně"><button type="button" className={autoScroll ? 'primary-button' : 'secondary-button'} onClick={() => setAutoScroll((value) => !value)}>{autoScroll ? '■ Zastavit' : '▶ Posun'}</button>{screen.orientation.lock && <button type="button" className="secondary-button" aria-pressed={orientationLocked} onClick={() => void toggleOrientationLock()}>{orientationLocked ? 'Odemknout otočení' : 'Zamknout na výšku'}</button>}<button type="button" className="secondary-button" onClick={() => void toggleFireMode()}>Ukončit U ohně</button></div>}
        </>
      ) : <ScoreViewer assets={song.scoreAssets} catalogVersion={catalogVersion} />}
    </article>
  );
}
