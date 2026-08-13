import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadApprovedLibrary, loadApprovedLibraryManifest, type SecureProfile } from '../auth/secureAccess';
import type { OfflineGrantPayload } from '../auth/offlineGrant';
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
import { requestPersistentStorage, storagePersistenceState } from '../pwa/storagePersistence';
import {
  loadDownloadedLibraryMetadata,
  inspectContentPackageIntegrity,
  removeDownloadedLibrarySongs,
  removePersonalSong,
  removeProtectedSong,
  type DownloadedLibraryMetadata,
  type ContentPackageIntegrity,
  type LibraryManifest,
} from '../storage/database';
import { friendlyError } from '../ui/friendlyError';

const LIBRARY_PAGE_SIZE = 40;

type Operation = 'member-library' | 'repair' | 'songs' | 'scores' | 'remove' | 'remove-songs' | 'remove-scores' | 'remove-library' | 'remove-song' | 'update';
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
  offlineGrant?: OfflineGrantPayload | null;
  downloadedLibrarySongs?: Song[];
  onPersonalLibraryChanged?: () => Promise<void>;
  onNavigate: (path: string) => void;
}

export function OfflineContent({
  catalog,
  secureProfile = null,
  secureMode = false,
  offlineGrant = null,
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
  const [memberIntegrity, setMemberIntegrity] = useState<ContentPackageIntegrity | null>(null);
  const [storagePersistent, setStoragePersistent] = useState<boolean | null>(null);
  const [storageUsage, setStorageUsage] = useState<{ usage: number; quota: number } | null>(null);
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
    setMemberIntegrity(secureProfile ? await inspectContentPackageIntegrity(secureProfile.id) : null);
    if (secureMode && secureProfile?.status === 'approved' && navigator.onLine) {
      setRemoteManifest(await loadApprovedLibraryManifest(secureProfile));
    }
  }, [secureMode, secureProfile]);

  useEffect(() => {
    inspectOfflineContent(catalog).then(setStats).catch(() => setStats(null));
    void storagePersistenceState().then(setStoragePersistent);
    if (navigator.storage?.estimate) navigator.storage.estimate().then((estimate) => {
      setStorageUsage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
    }).catch(() => setStorageUsage(null));
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
      if (navigator.storage?.persist) setStoragePersistent(await navigator.storage.persist().catch(() => false));
      await refresh();
      setNotice({ tone: 'success', text: kind === 'songs' ? 'Ukázkové písně byly staženy a ověřeny.' : 'Všechny notové party byly staženy a ověřeny.' });
    } catch (error) {
      setNotice({ tone: 'error', text: friendlyError(error, 'Stažení se nezdařilo. Zkontrolujte připojení a volné místo.') });
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
        await removeDownloadedLibrarySongs(secureProfile?.id);
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
      setNotice({ tone: 'error', text: friendlyError(error, 'Odstranění se nezdařilo.') });
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
      setNotice({ tone: 'error', text: friendlyError(error, 'Kontrola aktualizace se nezdařila.') });
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
      setNotice({ tone: 'error', text: friendlyError(error, 'Aktualizaci nelze nainstalovat. Zkuste aplikaci zavřít a znovu otevřít.') });
    } finally {
      setOperation(null);
    }
  };

  const downloadMemberLibrary = async () => {
    setOperation('member-library');
    setNotice({ tone: 'info', text: 'Stahuji soukromou členskou knihovnu…' });
    try {
      if (!secureProfile || secureProfile.status !== 'approved') throw new Error('Členský účet není schválený nebo se nepodařilo načíst jeho profil.');
      const estimate = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
      const expectedBytes = remoteManifest?.packageBytes ?? remoteManifest?.contentBytes ?? 0;
      if (estimate?.quota && expectedBytes > 0 && expectedBytes > Math.max(0, estimate.quota - (estimate.usage ?? 0))) {
        throw new Error(`Pro bezpečnou aktualizaci není dost volného místa. Je potřeba až ${formatBytes(expectedBytes)}.`);
      }
      setProgress({ completed: 0, total: 1, downloadedBytes: 0, estimatedBytes: expectedBytes, currentLabel: 'Porovnávám části knihovny…' });
      const result = await downloadApprovedLibrary(secureProfile, {
        localSongCount: downloadedLibrarySongs.length,
        onProgress: (next) => setProgress({ completed: next.completed, total: next.total, downloadedBytes: next.downloadedBytes, estimatedBytes: expectedBytes || next.downloadedBytes + next.reusedBytes, currentLabel: `Ověřuji část ${next.completed} z ${next.total}` }),
      });
      setStoragePersistent(await requestPersistentStorage());
      await onPersonalLibraryChanged?.();
      await refreshLibraryVersion();
      setNotice({ tone: 'success', text: result.changed
        ? `Hotovo: bezpečně uloženo ${result.count} písní. Staženo ${formatBytes(result.downloadedBytes)}, z dříve ověřených částí znovu použito ${formatBytes(result.reusedBytes)}.`
        : `Knihovna je aktuální. V zařízení už je všech ${result.count} písní této verze.` });
    } catch (error) {
      setNotice({ tone: 'error', text: friendlyError(error, 'Členskou knihovnu nelze stáhnout. Obnovte oprávnění účtu a zkuste to znovu.') });
    } finally {
      setProgress(null);
      setOperation(null);
    }
  };

  const protectOfflineStorage = async () => {
    setOperation('repair');
    const persistent = await requestPersistentStorage();
    setStoragePersistent(persistent);
    setNotice({ tone: persistent === true ? 'success' : 'info', text: persistent === true
      ? 'Systém potvrdil ochranu místních dat před automatickým uvolňováním místa.'
      : 'Tento prohlížeč trvalou ochranu nepovolil. Offline data budou fungovat, dokud ručně nesmažete data aplikace nebo je systém neuvolní.' });
    setOperation(null);
  };

  const repairOfflineContent = async () => {
    setOperation('repair');
    setNotice({ tone: 'info', text: 'Kontroluji kontrolní součty a doplňuji chybějící části…' });
    setProgress(null);
    try {
      const before = await inspectOfflineContent(catalog);
      let repaired = 0;
      if (secureProfile && downloadedLibrarySongs.length > 0) {
        const libraryResult = await downloadApprovedLibrary(secureProfile, {
          force: !localManifest || localManifest.songCount !== downloadedLibrarySongs.length || memberIntegrity?.healthy === false,
          localSongCount: downloadedLibrarySongs.length,
        });
        if (libraryResult.changed) repaired += libraryResult.count;
      }
      if (before.downloadedSongs > 0 && !before.allSongsVerified) {
        await downloadAllSongs(catalog, setProgress);
        repaired += before.totalSongs - before.downloadedSongs;
      }
      if (before.downloadedScores > 0 && !before.allScoresVerified) {
        await downloadAllScores(catalog, setProgress);
        repaired += before.totalScores - before.downloadedScores;
      }
      await onPersonalLibraryChanged?.();
      await Promise.all([refresh(), refreshLibraryVersion()]);
      setNotice({ tone: 'success', text: repaired > 0
        ? `Kontrola dokončena. Opraveno nebo doplněno bylo ${repaired} položek.`
        : 'Kontrola dokončena. Stažená data jsou úplná a jejich integrita souhlasí.' });
    } catch (error) {
      setNotice({ tone: 'error', text: friendlyError(error, 'Opravu se nepodařilo dokončit. Již ověřená data zůstala zachovaná a příště lze pokračovat.') });
    } finally {
      setOperation(null);
    }
  };

  const removeMemberLibrary = async () => {
    setOperation('remove-library');
    setNotice(null);
    try {
      const removed = await removeDownloadedLibrarySongs(secureProfile?.id);
      await onPersonalLibraryChanged?.();
      setLocalManifest(null);
      setNotice({ tone: 'success', text: `Stažená soukromá knihovna byla z tohoto zařízení odstraněna (${removed} písní). Vlastní PDF importy zůstaly zachované.` });
    } catch (error) {
      setNotice({ tone: 'error', text: friendlyError(error, 'Knihovnu se nepodařilo odstranit.') });
    } finally {
      setConfirmRemoveLibrary(false);
      setOperation(null);
    }
  };

  const removeMemberSong = async (song: Song) => {
    setOperation('remove-song');
    setNotice(null);
    try {
      if (secureProfile) await removeProtectedSong(secureProfile.id, song.id);
      else await removePersonalSong(song.id);
      await onPersonalLibraryChanged?.();
      setNotice({ tone: 'success', text: `Píseň „${song.title}“ byla odstraněna pouze z tohoto zařízení.` });
    } catch (error) {
      setNotice({ tone: 'error', text: friendlyError(error, 'Píseň se nepodařilo odstranit.') });
    } finally {
      setConfirmRemoveSong(null);
      setOperation(null);
    }
  };

  const busy = operation !== null;
  const publicCatalogReady = Boolean(stats?.allSongsVerified);
  const memberLibraryReady = downloadedLibrarySongs.length > 0;
  const memberUpdateAvailable = Boolean(remoteManifest && (!localManifest || remoteManifest.version !== localManifest.version));
  const missingMemberSongs = memberIntegrity
    ? memberIntegrity.missingSongs + memberIntegrity.invalidSongs + memberIntegrity.missingContent + memberIntegrity.alteredContent
    : Math.max(0, (localManifest?.songCount ?? downloadedLibrarySongs.length) - downloadedLibrarySongs.length);
  const missingPublicSongs = Math.max(0, (stats?.totalSongs ?? 0) - (stats?.downloadedSongs ?? 0));
  const missingScores = Math.max(0, (stats?.totalScores ?? 0) - (stats?.downloadedScores ?? 0));
  const hasRepairableContent = downloadedLibrarySongs.length > 0 || (stats?.downloadedSongs ?? 0) > 0 || (stats?.downloadedScores ?? 0) > 0;
  const integrityHealthy = (memberIntegrity?.healthy ?? missingMemberSongs === 0)
    && ((stats?.downloadedSongs ?? 0) === 0 || missingPublicSongs === 0)
    && ((stats?.downloadedScores ?? 0) === 0 || missingScores === 0);
  const shellReady = Boolean(stats?.serviceWorkerActive);
  const authorizationReady = !secureMode || Boolean(offlineGrant);
  const ready = secureMode
    ? memberLibraryReady && authorizationReady && shellReady
    : publicCatalogReady && shellReady;
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
        <span><small>Offline oprávnění</small><strong>{offlineGrant ? `do ${new Date(offlineGrant.offlineValidUntil).toLocaleDateString('cs-CZ')}` : secureMode ? 'není aktivní' : 'nevyžaduje se'}</strong></span>
        <span><small>Trvalé úložiště</small><strong>{storagePersistent === true ? 'povoleno' : storagePersistent === false ? 'nepovoleno' : 'nezjištěno'}</strong></span>
      </div>
      <p className="last-update">Poslední změna offline obsahu: {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleString('cs-CZ') : 'zatím žádná'}</p>
      {storageUsage && <p className="last-update">Úložiště aplikace: přibližně {formatBytes(storageUsage.usage)} z dostupných {formatBytes(storageUsage.quota)}.</p>}

      <article className={`offline-readiness ${ready ? 'offline-readiness--ready' : ''}`} aria-labelledby="offline-readiness-heading">
        <header><span><p className="eyebrow">Cold start bez internetu</p><h2 id="offline-readiness-heading">{ready ? 'Zařízení je připravené' : 'Dokončete offline přípravu'}</h2></span><strong>{[shellReady, authorizationReady, secureMode ? memberLibraryReady : publicCatalogReady].filter(Boolean).length}/3</strong></header>
        <ul>
          <li className={shellReady ? 'complete' : ''}><span aria-hidden="true">{shellReady ? '✓' : '1'}</span><div><strong>Jádro aplikace</strong><small>{shellReady ? 'Service worker ovládá tuto instalaci.' : 'Načtěte aplikaci jednou online a obnovte ji.'}</small></div></li>
          <li className={authorizationReady ? 'complete' : ''}><span aria-hidden="true">{authorizationReady ? '✓' : '2'}</span><div><strong>Offline oprávnění</strong><small>{authorizationReady ? (offlineGrant ? `Podepsané oprávnění platí do ${new Date(offlineGrant.offlineValidUntil).toLocaleDateString('cs-CZ')}.` : 'Pro veřejný obsah není vyžadováno.') : 'Přihlaste se online a nechte oprávnění bezpečně uložit.'}</small></div></li>
          <li className={(secureMode ? memberLibraryReady : publicCatalogReady) ? 'complete' : ''}><span aria-hidden="true">{(secureMode ? memberLibraryReady : publicCatalogReady) ? '✓' : '3'}</span><div><strong>Obsah písní</strong><small>{secureMode ? `${downloadedLibrarySongs.length} členských písní v zařízení.` : `${stats?.downloadedSongs ?? 0} z ${stats?.totalSongs ?? catalog.songs.length} ukázek v zařízení.`}</small></div></li>
        </ul>
        <div className="offline-protection-row"><span><strong>Ochrana úložiště</strong><small>{storagePersistent === true ? 'Systém nebude data automaticky uvolňovat.' : 'Lze požádat systém o vyšší ochranu místních dat.'}</small></span>{storagePersistent !== true && <button type="button" className="secondary-button" disabled={busy} onClick={() => void protectOfflineStorage()}>Chránit offline data</button>}</div>
        <p className="offline-data-warning"><strong>Důležité:</strong> běžné zavření aplikace ani aktualizace vás neodhlásí. Volba telefonu „Smazat data webu/aplikace“ ale odstraní také bezpečný offline klíč, knihovnu a setlisty; potom je záměrně nutné znovu ověřit účet online.</p>
      </article>

      <article className={`offline-integrity-card ${integrityHealthy ? 'offline-integrity-card--healthy' : 'offline-integrity-card--attention'}`}>
        <div><p className="eyebrow">Kontrola dat</p><h2>{integrityHealthy ? 'Stažený obsah je v pořádku' : 'Některé položky je třeba doplnit'}</h2><p>{integrityHealthy ? 'Počty, přítomnost obsahu a uložené délky všech částí souhlasí.' : `K opravě: členské písně ${missingMemberSongs}, ukázky ${missingPublicSongs}, party ${missingScores}. Oprava pokračuje od již ověřených částí.`}</p>{memberIntegrity && <small>Ověřeno {memberIntegrity.completeSongs}/{memberIntegrity.expectedSongs} písní · {formatBytes(memberIntegrity.availableBytes)} z {formatBytes(memberIntegrity.expectedBytes)}</small>}</div>
        <button type="button" className="secondary-button" disabled={busy || !online || !hasRepairableContent} onClick={() => void repairOfflineContent()}>{operation === 'repair' ? 'Opravuji…' : 'Zkontrolovat a opravit'}</button>
      </article>

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
