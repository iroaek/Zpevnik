import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadApprovedLibrary, loadApprovedLibraryManifest, type SecureProfile } from '../auth/secureAccess';
import type { Catalog, Song } from '../domain/song';
import { useConnectivity } from '../hooks/useConnectivity';
import {
  downloadAllScores,
  downloadAllSongs,
  inspectOfflineContent,
  removeAllOfflineContent,
  removeScores,
  removeSongs,
  type DownloadProgress,
  type OfflineContentStats,
} from '../pwa/contentCache';
import { activateWaitingUpdate, checkForUpdate, hasWaitingUpdate } from '../pwa/updateManager';
import {
  loadDownloadedLibraryMetadata,
  removeDownloadedLibrarySongs,
  removePersonalSong,
  type DownloadedLibraryMetadata,
  type LibraryManifest,
} from '../storage/database';

const LIBRARY_PAGE_SIZE = 40;

type Operation = 'member-library' | 'songs' | 'scores' | 'remove' | 'remove-songs' | 'remove-scores' | 'remove-library' | 'remove-song' | 'update';
type Notice = { text: string; tone: 'success' | 'error' | 'info' };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface OfflineContentProps {
  catalog: Catalog;
  secureProfile?: SecureProfile | null;
  secureMode?: boolean;
  downloadedLibrarySongs?: Song[];
  onPersonalLibraryChanged?: () => Promise<void>;
  onNavigate: (path: string) => void;
}

export function OfflineContent({
  catalog,
  secureProfile = null,
  secureMode = false,
  downloadedLibrarySongs = [],
  onPersonalLibraryChanged,
  onNavigate,
}: OfflineContentProps) {
  const online = useConnectivity();
  const [stats, setStats] = useState<OfflineContentStats | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmRemoveLibrary, setConfirmRemoveLibrary] = useState(false);
  const [confirmRemoveSong, setConfirmRemoveSong] = useState<string | null>(null);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [visibleLibrarySongs, setVisibleLibrarySongs] = useState(LIBRARY_PAGE_SIZE);
  const [updateReady, setUpdateReady] = useState(hasWaitingUpdate);
  const [localManifest, setLocalManifest] = useState<DownloadedLibraryMetadata | null>(null);
  const [remoteManifest, setRemoteManifest] = useState<LibraryManifest | null>(null);
  const scoreEstimate = useMemo(() => catalog.songs.flatMap((song) => song.scoreAssets).reduce((sum, asset) => sum + asset.byteSize, 0), [catalog]);
  const songEstimate = useMemo(() => catalog.songs.reduce((sum, song) => sum + song.contentBytes, 0), [catalog]);
  const filteredLibrarySongs = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase('cs');
    if (!query) return downloadedLibrarySongs;
    return downloadedLibrarySongs.filter((song) => [song.title, ...song.authors, song.firstLine]
      .some((value) => value.toLocaleLowerCase('cs').includes(query)));
  }, [downloadedLibrarySongs, libraryQuery]);

  const refresh = useCallback(async () => setStats(await inspectOfflineContent(catalog)), [catalog]);
  const refreshLibraryVersion = useCallback(async () => {
    setLocalManifest(await loadDownloadedLibraryMetadata());
    if (secureMode && secureProfile?.status === 'approved' && navigator.onLine) {
      setRemoteManifest(await loadApprovedLibraryManifest(secureProfile));
    }
  }, [secureMode, secureProfile]);

  useEffect(() => {
    inspectOfflineContent(catalog).then(setStats).catch(() => setStats(null));
  }, [catalog]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshLibraryVersion().catch(() => setRemoteManifest(null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshLibraryVersion]);

  useEffect(() => {
    const available = () => setUpdateReady(true);
    window.addEventListener('zpevnik:update-available', available);
    return () => window.removeEventListener('zpevnik:update-available', available);
  }, []);

  const runDownload = async (kind: 'songs' | 'scores') => {
    setOperation(kind);
    setNotice(null);
    setProgress(null);
    try {
      if (kind === 'songs') await downloadAllSongs(catalog, setProgress);
      else await downloadAllScores(catalog, setProgress);
      await refresh();
      setNotice({ tone: 'success', text: kind === 'songs' ? 'Ukázkové písně byly staženy a ověřeny.' : 'Všechny notové party byly staženy a ověřeny.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? `Stažení se nezdařilo: ${error.message}` : 'Stažení se nezdařilo.' });
    } finally {
      setOperation(null);
    }
  };

  const removeCached = async (kind: 'songs' | 'scores' | 'all') => {
    setOperation(kind === 'all' ? 'remove' : kind === 'songs' ? 'remove-songs' : 'remove-scores');
    setNotice(null);
    try {
      if (kind === 'scores') await removeScores();
      else if (kind === 'songs') await removeSongs();
      else {
        await removeAllOfflineContent();
        await removeDownloadedLibrarySongs();
        await onPersonalLibraryChanged?.();
      }
      await refresh();
      setNotice({
        tone: 'success',
        text: kind === 'scores'
          ? 'Všechny stažené notové party byly z tohoto zařízení odstraněny.'
          : kind === 'songs'
            ? 'Stažené soubory ukázkového katalogu byly z tohoto zařízení odstraněny.'
            : 'Všechna stažená data včetně soukromé knihovny byla odstraněna. Aplikace a vlastní PDF importy zůstaly zachované.',
      });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? `Odstranění se nezdařilo: ${error.message}` : 'Odstranění se nezdařilo.' });
    } finally {
      setConfirmRemove(false);
      setOperation(null);
    }
  };

  const updateCheck = async () => {
    setOperation('update');
    setNotice({ tone: 'info', text: 'Kontroluji novou verzi aplikace…' });
    try {
      const result = await checkForUpdate();
      setUpdateReady(result === 'update-available');
      setNotice({
        tone: result === 'service-worker-unavailable' ? 'info' : 'success',
        text: result === 'update-available'
          ? 'Nová verze je stažená a připravená k instalaci.'
          : result === 'up-to-date'
            ? 'Používáte nejnovější dostupnou verzi aplikace.'
            : 'Aktualizační služba ještě není aktivní. Nechte aplikaci online, zavřete ji a znovu otevřete.',
      });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Kontrola aktualizace se nezdařila.' });
    } finally {
      setOperation(null);
    }
  };

  const installUpdate = async () => {
    setOperation('update');
    setNotice({ tone: 'info', text: 'Instaluji novou verzi a znovu načítám aplikaci…' });
    try {
      await activateWaitingUpdate();
      setUpdateReady(false);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? `Aktualizaci nelze nainstalovat: ${error.message}` : 'Aktualizaci nelze nainstalovat.' });
    } finally {
      setOperation(null);
    }
  };

  const downloadMemberLibrary = async () => {
    setOperation('member-library');
    setNotice({ tone: 'info', text: 'Stahuji soukromou členskou knihovnu…' });
    try {
      if (!secureProfile || secureProfile.status !== 'approved') throw new Error('Členský účet není schválený nebo se nepodařilo načíst jeho profil.');
      const result = await downloadApprovedLibrary(secureProfile, { localSongCount: downloadedLibrarySongs.length });
      await onPersonalLibraryChanged?.();
      await refreshLibraryVersion();
      setNotice({ tone: 'success', text: result.changed
        ? `Hotovo: do tohoto zařízení bylo bezpečně uloženo ${result.count} ${secureProfile.role === 'admin' ? 'správcovských' : 'členských'} písní.`
        : `Knihovna je aktuální. V zařízení už je všech ${result.count} písní této verze.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? `Členskou knihovnu nelze stáhnout: ${error.message}` : 'Členskou knihovnu nelze stáhnout.' });
    } finally {
      setOperation(null);
    }
  };

  const removeMemberLibrary = async () => {
    setOperation('remove-library');
    setNotice(null);
    try {
      const removed = await removeDownloadedLibrarySongs();
      await onPersonalLibraryChanged?.();
      setLocalManifest(null);
      setNotice({ tone: 'success', text: `Stažená soukromá knihovna byla z tohoto zařízení odstraněna (${removed} písní). Vlastní PDF importy zůstaly zachované.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? `Knihovnu se nepodařilo odstranit: ${error.message}` : 'Knihovnu se nepodařilo odstranit.' });
    } finally {
      setConfirmRemoveLibrary(false);
      setOperation(null);
    }
  };

  const removeMemberSong = async (song: Song) => {
    setOperation('remove-song');
    setNotice(null);
    try {
      await removePersonalSong(song.id);
      await onPersonalLibraryChanged?.();
      setNotice({ tone: 'success', text: `Píseň „${song.title}“ byla odstraněna pouze z tohoto zařízení.` });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? `Píseň se nepodařilo odstranit: ${error.message}` : 'Píseň se nepodařilo odstranit.' });
    } finally {
      setConfirmRemoveSong(null);
      setOperation(null);
    }
  };

  const busy = operation !== null;
  const publicCatalogReady = Boolean(stats?.allSongsVerified);
  const memberLibraryReady = downloadedLibrarySongs.length > 0;
  const memberUpdateAvailable = Boolean(remoteManifest && (!localManifest || remoteManifest.version !== localManifest.version));
  const ready = publicCatalogReady || memberLibraryReady;
  const statusTitle = memberLibraryReady
    ? 'Soukromá knihovna je připravená offline'
    : publicCatalogReady
      ? 'Ukázkové písně jsou připravené offline'
      : online ? 'Zatím není stažena žádná knihovna' : 'Jste offline';
  const statusDescription = memberLibraryReady
    ? `${downloadedLibrarySongs.length} soukromých písní je uloženo přímo v tomto zařízení.`
    : publicCatalogReady
      ? 'Katalog i všechny ukázkové texty byly ověřeny v místní cache.'
      : secureMode
        ? 'Schválenou členskou knihovnu stáhněte v první kartě níže.'
        : 'Ukázkové písně a noty můžete stáhnout v první sekci níže.';

  return (
    <section className="offline-page" aria-labelledby="offline-heading">
      <p className="eyebrow">Bez signálu</p>
      <h1 id="offline-heading">Offline obsah</h1>
      <p className="lead offline-intro">Na jednom místě zde stáhnete, obnovíte i odstraníte soukromé písně, ukázky, noty a aktualizace aplikace.</p>

      <div className={`offline-status offline-status--${ready ? 'ready' : online ? 'partial' : 'offline'}`} role="status">
        <span className="status-dot" aria-hidden="true" />
        <div><strong>{statusTitle}</strong><p>{statusDescription}</p></div>
      </div>

      <div className="offline-metrics">
        <span><small>Členská knihovna</small><strong>{downloadedLibrarySongs.length}</strong></span>
        <span><small>Ukázkové písně</small><strong>{stats?.downloadedSongs ?? 0}/{stats?.totalSongs ?? catalog.songs.length}</strong></span>
        <span><small>Stažené party</small><strong>{stats?.downloadedScores ?? 0}/{stats?.totalScores ?? 0}</strong></span>
        <span><small>Uložená cache</small><strong>{formatBytes(stats?.bytes ?? 0)}</strong></span>
      </div>
      <p className="last-update">Poslední změna offline obsahu: {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleString('cs-CZ') : 'zatím žádná'}</p>

      {progress && <div className="download-progress" aria-live="polite"><div className="results-heading"><strong>{progress.currentLabel}</strong><span>{progress.completed}/{progress.total}</span></div><progress max={progress.total} value={progress.completed} /><small>{formatBytes(progress.downloadedBytes)} z odhadovaných {formatBytes(progress.estimatedBytes)}</small></div>}
      {notice && <p className={`${notice.tone === 'error' ? 'error-message' : notice.tone === 'success' ? 'success-message' : 'info-message'} offline-notice`} role="status">{notice.text}</p>}

      <div className="offline-actions">
        {secureMode && <>
          <div className="offline-section-heading"><span className="step-number" aria-hidden="true">1</span><span><p className="eyebrow">Vaše hlavní písně</p><h2>Soukromá knihovna</h2></span></div>
          <article className="member-library-download"><div><h3>{secureProfile?.role === 'admin' ? 'Správcovský balíček' : 'Členský balíček'}</h3><p>{downloadedLibrarySongs.length > 0 ? `${downloadedLibrarySongs.length} písní je uloženo v tomto zařízení a funguje bez internetu.` : 'V zařízení zatím nejsou stažené žádné členské písně.'}</p><div className="library-version-row"><span className={`status-badge ${memberUpdateAvailable ? 'status-badge--pending' : localManifest ? 'status-badge--approved' : ''}`}>{memberUpdateAvailable ? 'Je dostupná nová verze' : localManifest ? 'Knihovna je aktuální' : 'Verze zatím není evidována'}</span>{localManifest && <small>Staženo {new Date(localManifest.downloadedAt).toLocaleString('cs-CZ')} · verze {localManifest.version.slice(0, 8)}</small>}{remoteManifest && <small>Na serveru {remoteManifest.songCount} písní · {formatBytes(remoteManifest.contentBytes)}</small>}</div><small>Obnovení proběhne bezpečně až po kontrole celého balíčku. Vaše vlastní PDF importy zůstanou zachované.</small></div><div className="offline-card-actions"><button className="primary-button" type="button" disabled={busy || !online || !secureProfile} onClick={() => void downloadMemberLibrary()}>{operation === 'member-library' ? 'Stahuji…' : memberUpdateAvailable ? 'Nainstalovat novou knihovnu' : downloadedLibrarySongs.length > 0 ? 'Ověřit aktuálnost' : 'Stáhnout knihovnu'}</button>{downloadedLibrarySongs.length > 0 && <button className="danger-button" type="button" disabled={busy} onClick={() => setConfirmRemoveLibrary(true)}>Odstranit knihovnu</button>}</div></article>
          {confirmRemoveLibrary && <div className="confirm-row prominent-confirm" role="alert"><strong>Odstranit všech {downloadedLibrarySongs.length} stažených členských písní?</strong><span>Odstranění platí pouze pro toto zařízení. Písně lze později znovu stáhnout.</span><div className="button-row"><button type="button" className="danger-button" disabled={busy} onClick={() => void removeMemberLibrary()}>Ano, odstranit knihovnu</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmRemoveLibrary(false)}>Zrušit</button></div></div>}
          {downloadedLibrarySongs.length > 0 && <details className="downloaded-library-manager">
            <summary>Odstranit jednotlivé písně ({downloadedLibrarySongs.length})</summary>
            <div className="downloaded-library-manager__content">
              <label><span className="visually-hidden">Hledat ve stažených písních</span><input type="search" value={libraryQuery} onChange={(event) => { setLibraryQuery(event.target.value); setVisibleLibrarySongs(LIBRARY_PAGE_SIZE); }} placeholder="Název nebo autor…" /></label>
              <p className="last-update">Nalezeno {filteredLibrarySongs.length} písní. Odstranění platí pouze pro toto zařízení.</p>
              <div className="device-song-list">
                {filteredLibrarySongs.slice(0, visibleLibrarySongs).map((song) => (
                  <article key={song.id}>
                    <span className="downloaded-song-label"><strong>{song.title}</strong><small>{song.authors.join(', ') || 'Autor neuveden'}</small></span>
                    {confirmRemoveSong === song.id
                      ? <span className="device-song-confirm"><button type="button" className="danger-button" disabled={busy} onClick={() => void removeMemberSong(song)}>Potvrdit</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmRemoveSong(null)}>Zrušit</button></span>
                      : <button type="button" className="icon-button" disabled={busy} aria-label={`Odstranit ${song.title} z tohoto zařízení`} onClick={() => setConfirmRemoveSong(song.id)}>×</button>}
                  </article>
                ))}
              </div>
              {filteredLibrarySongs.length === 0 && <p className="empty-state">Tomuto hledání neodpovídá žádná stažená píseň.</p>}
              {visibleLibrarySongs < filteredLibrarySongs.length && <button type="button" className="secondary-button" disabled={busy} onClick={() => setVisibleLibrarySongs((value) => value + LIBRARY_PAGE_SIZE)}>Zobrazit dalších {Math.min(LIBRARY_PAGE_SIZE, filteredLibrarySongs.length - visibleLibrarySongs)}</button>}
            </div>
          </details>}
        </>}

        <details className="optional-offline-panel" open={!secureMode}>
          <summary><span><strong>Volitelné ukázky a noty</strong><small>Nejsou nutné pro soukromou knihovnu</small></span></summary>
          <div className="optional-offline-panel__content">
            <article><div><h3>Ukázkový veřejný katalog</h3><p>{catalog.songs.length} písní · přibližně {formatBytes(songEstimate)}. Soukromá členská knihovna se spravuje samostatně výše.</p></div><div className="offline-card-actions"><button className="secondary-button" type="button" disabled={busy || !online} onClick={() => void runDownload('songs')}>{operation === 'songs' ? 'Stahuji…' : stats?.allSongsVerified ? 'Ověřit znovu' : 'Stáhnout ukázky'}</button><button className="danger-button" type="button" disabled={busy || (stats?.downloadedSongs ?? 0) === 0} onClick={() => void removeCached('songs')}>{operation === 'remove-songs' ? 'Odstraňuji…' : 'Odstranit ukázky'}</button></div></article>
            <article><div><h3>Notové party</h3><p>{stats?.totalScores ?? 0} partů · přibližně {formatBytes(scoreEstimate)} · stahují se zvlášť</p></div><div className="offline-card-actions"><button className="secondary-button" type="button" disabled={busy || !online || scoreEstimate === 0} onClick={() => void runDownload('scores')}>{operation === 'scores' ? 'Stahuji…' : stats?.allScoresVerified ? 'Ověřit znovu' : 'Stáhnout noty'}</button><button className="danger-button" type="button" disabled={busy || (stats?.downloadedScores ?? 0) === 0} onClick={() => void removeCached('scores')}>{operation === 'remove-scores' ? 'Odstraňuji…' : 'Odstranit noty'}</button></div></article>
          </div>
        </details>

        <div className="offline-section-heading"><span className="step-number" aria-hidden="true">{secureMode ? '3' : '2'}</span><span><p className="eyebrow">Verze aplikace</p><h2>Aktualizace</h2></span></div>
        <article className="update-card"><div><h3>{updateReady ? 'Nová verze je připravená' : 'Zkontrolovat novou verzi'}</h3><p>{updateReady ? 'Instalace zachová písně, setlisty i nastavení a potom aplikaci znovu načte.' : 'Kontrola nyní vrátí jasný výsledek. Na pozadí se opakuje každých 15 minut.'}</p></div><div className="offline-card-actions">{updateReady && <button className="primary-button" type="button" disabled={busy} onClick={() => void installUpdate()}>Nainstalovat aktualizaci</button>}<button className="secondary-button" type="button" disabled={!online || busy} onClick={() => void updateCheck()}>{operation === 'update' ? 'Kontroluji…' : 'Zkontrolovat aktualizaci'}</button></div></article>
      </div>

      <article className="install-callout"><div><strong>Chcete zpěvnik jako aplikaci v telefonu?</strong><p>Otevřete instalační stránku s postupem pro Android, iPhone i počítač.</p></div><button type="button" className="secondary-button" onClick={() => onNavigate('install')}>Přejít k instalaci</button></article>

      <details className="danger-zone"><summary>Pokročilá správa úložiště</summary><div className="danger-zone__content">
        <span><h2>Vyčistit stažená data</h2><p>Odstraní ukázky, noty a soukromou knihovnu. Samotná aplikace, profil, setlisty a vaše PDF importy zůstanou.</p></span>
        {!confirmRemove ? <button className="danger-button" type="button" disabled={busy} onClick={() => setConfirmRemove(true)}>Odstranit všechna stažená data</button> : <div className="confirm-row" role="alert"><strong>Opravdu odstranit všechna stažená data?</strong><span>Písně z členské knihovny lze později znovu stáhnout.</span><div className="button-row"><button className="danger-button" type="button" onClick={() => void removeCached('all')}>Ano, odstranit data</button><button className="secondary-button" type="button" onClick={() => setConfirmRemove(false)}>Zrušit</button></div></div>}
      </div></details>
      {!stats?.serviceWorkerActive && <p className="score-note">Offline jádro aplikace ještě není aktivní. Nechte stránku jednou načíst online a poté ji obnovte.</p>}
    </section>
  );
}
