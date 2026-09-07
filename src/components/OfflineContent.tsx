import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadApprovedLibrary, loadApprovedLibraryManifest, type SecureProfile } from '../auth/secureAccess';
import { offlineGrantAllowsReading, type OfflineGrantPayload } from '../auth/offlineGrant';
import { OfflinePreparationError, type OfflineErrorCode } from '../auth/offlineDiagnostics';
import { withDeadline } from '../domain/asyncDeadline';
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
  loadPendingMutations,
  removeDownloadedLibrarySongs,
  removePersonalSong,
  removeProtectedSong,
  type DownloadedLibraryMetadata,
  type ContentPackageIntegrity,
  type LibraryManifest,
  type StoredOfflineGrantRecord,
} from '../storage/database';
import { inspectAppShell, type AppShellInspection } from '../pwa/appShell';
import { Icon } from '../ui/Icon';
import { Dialog } from '../ui/Dialog';
import { formatCount, formatDecimal, formatDateTime } from '../ui/format';
import { friendlyError } from '../ui/friendlyError';

const LIBRARY_PAGE_SIZE = 40;
async function localInspection<T>(operation: Promise<T>): Promise<T> {
  try { return await withDeadline(operation, 8_000, 'Místní úložiště neodpovídá.'); }
  catch { throw new OfflinePreparationError('local_store_unavailable'); }
}

type Operation = 'member-library' | 'repair' | 'songs' | 'scores' | 'remove' | 'remove-songs' | 'remove-scores' | 'remove-library' | 'remove-song' | 'update';
type Notice = { text: string; tone: 'success' | 'error' | 'info' };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatDecimal(bytes / 1024)} kB`;
  return `${formatDecimal(bytes / 1024 / 1024)} MB`;
}

interface OfflineContentProps {
  catalog: Catalog;
  secureProfile?: SecureProfile | null;
  secureMode?: boolean;
  offlineGrant?: OfflineGrantPayload | null;
  downloadedLibrarySongs?: Song[];
  onPersonalLibraryChanged?: () => Promise<void>;
  onRefreshAuthorization?: () => Promise<void>;
  onPrepareAuthorization?: () => Promise<StoredOfflineGrantRecord>;
  offlineProblem?: { code: OfflineErrorCode; message: string } | null;
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
  onRefreshAuthorization,
  onPrepareAuthorization,
  offlineProblem,
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
  const [pendingChanges, setPendingChanges] = useState(0);
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [shell, setShell] = useState<AppShellInspection | null>(null);
  const [confirmKind, setConfirmKind] = useState<'songs' | 'scores' | null>(null);
  const scoreEstimate = useMemo(() => catalog.songs.flatMap((song) => song.scoreAssets).reduce((sum, asset) => sum + asset.byteSize, 0), [catalog]);
  const songEstimate = useMemo(() => catalog.songs.reduce((sum, song) => sum + song.contentBytes, 0), [catalog]);
  const filteredLibrarySongs = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase('cs');
    if (!query) return downloadedLibrarySongs;
    return downloadedLibrarySongs.filter((song) => [song.title, ...song.authors, song.firstLine]
      .some((value) => value.toLocaleLowerCase('cs').includes(query)));
  }, [downloadedLibrarySongs, libraryQuery]);

  const refresh = useCallback(async () => {
    const [content, appShell] = await withDeadline(Promise.all([inspectOfflineContent(catalog), inspectAppShell()]), 8_000, 'Místní úložiště neodpovídá.');
    setStats(content); setShell(appShell); setOpenedAt(Date.now());
  }, [catalog]);
  const refreshLibraryVersion = useCallback(async () => {
    setLocalManifest(await loadDownloadedLibraryMetadata());
    setMemberIntegrity(secureProfile ? await inspectContentPackageIntegrity(secureProfile.id) : null);
    if (secureMode && secureProfile?.status === 'approved' && navigator.onLine) {
      setRemoteManifest(await loadApprovedLibraryManifest(secureProfile));
    }
  }, [secureMode, secureProfile]);

  useEffect(() => {
    void localInspection(Promise.all([inspectOfflineContent(catalog), inspectAppShell()])).then(([content, appShell]) => { setStats(content); setShell(appShell); }).catch(() => {
      setStats(null); setShell({ status: 'unverified', checkedAt: new Date().toISOString(), missing: 0 });
      setNotice({ tone: 'error', text: 'Místní úložiště neodpovídá. (local_store_unavailable)' });
    });
    void storagePersistenceState().then(setStoragePersistent);
    if (navigator.storage?.estimate) navigator.storage.estimate().then((estimate) => {
      setStorageUsage({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
    }).catch(() => setStorageUsage(null));
  }, [catalog, refresh]);

  useEffect(() => {
    let active = true;
    const pending = secureProfile ? loadPendingMutations(secureProfile.id) : Promise.resolve([]);
    void pending.then((items) => { if (active) setPendingChanges(items.length); }).catch(() => { if (active) setPendingChanges(0); });
    return () => { active = false; };
  }, [online, secureProfile]);

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

  useEffect(() => {
    if (!offlineGrant) return;
    const updateClock = () => setOpenedAt(Date.now());
    const nextBoundary = [Date.parse(offlineGrant.notBefore), Date.parse(offlineGrant.offlineValidUntil)]
      .filter((time) => time > openedAt).sort((a, b) => a - b)[0];
    const timer = nextBoundary === undefined ? null : window.setTimeout(updateClock, Math.min(2_147_483_647, Math.max(1, nextBoundary - Date.now() + 1)));
    const onVisible = () => { if (document.visibilityState === 'visible') updateClock(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { if (timer !== null) window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [offlineGrant, openedAt]);

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
  const publicCatalogReady = catalog.songs.length > 0 && Boolean(stats?.allSongsVerified);
  const memberLibraryReady = downloadedLibrarySongs.length > 0 && memberIntegrity?.healthy === true && memberIntegrity.expectedSongs > 0;
  const memberUpdateAvailable = Boolean(remoteManifest && (!localManifest || remoteManifest.version !== localManifest.version));
  const missingMemberSongs = memberIntegrity
    ? memberIntegrity.missingSongs + memberIntegrity.invalidSongs + memberIntegrity.missingContent + memberIntegrity.alteredContent
    : Math.max(0, (localManifest?.songCount ?? downloadedLibrarySongs.length) - downloadedLibrarySongs.length);
  const missingPublicSongs = Math.max(0, (stats?.totalSongs ?? 0) - (stats?.downloadedSongs ?? 0));
  const missingScores = Math.max(0, (stats?.totalScores ?? 0) - (stats?.downloadedScores ?? 0));
  const hasRepairableContent = downloadedLibrarySongs.length > 0 || (stats?.downloadedSongs ?? 0) > 0 || (stats?.downloadedScores ?? 0) > 0;
  const integrityHealthy = hasRepairableContent
    && (downloadedLibrarySongs.length === 0 || memberIntegrity?.healthy === true)
    && ((stats?.downloadedSongs ?? 0) === 0 || stats?.allSongsVerified === true)
    && ((stats?.downloadedScores ?? 0) === 0 || stats?.allScoresVerified === true);
  const shellReady = shell?.status === 'verified';
  const authorizationReady = !secureMode || offlineGrantAllowsReading(offlineGrant, secureProfile, openedAt);
  const grantDaysRemaining = offlineGrant ? Math.ceil((new Date(offlineGrant.offlineValidUntil).getTime() - openedAt) / 86_400_000) : null;
  const ready = secureMode
    ? memberLibraryReady && authorizationReady && shellReady
    : publicCatalogReady && shellReady;
  const contentReady = secureMode ? memberLibraryReady : publicCatalogReady;
  const readinessCount = [shellReady, authorizationReady, contentReady].filter(Boolean).length;
  const verifiedTexts = secureMode ? memberIntegrity?.completeSongs ?? 0 : stats?.downloadedSongs ?? 0;
  const totalTexts = secureMode ? memberIntegrity?.expectedSongs || remoteManifest?.songCount || localManifest?.songCount || downloadedLibrarySongs.length : catalog.songs.length;
  const textProgress = totalTexts > 0 ? Math.min(1, verifiedTexts / totalTexts) : 0;
  const refreshAuthorization = async () => {
    setOperation('update'); setNotice(null);
    try { await onRefreshAuthorization?.(); await refresh(); await refreshLibraryVersion(); }
    catch (error) { setNotice({ tone: 'error', text: friendlyError(error, 'Oprávnění se nepodařilo obnovit.') }); }
    finally { setOperation(null); }
  };
  const completePreparation = async () => {
    setOperation('repair'); setNotice({ tone: 'info', text: 'Ověřuji a ukládám oprávnění…' });
    try {
      if (secureMode) {
        const grant = await onPrepareAuthorization?.();
        if (!grant || !offlineGrantAllowsReading(grant.payload, secureProfile)) throw new OfflinePreparationError('grant_issue_failed');
        setNotice({ tone: 'info', text: 'Kontroluji uložené texty a akordy…' });
        const before = await localInspection(inspectContentPackageIntegrity(grant.profile.id));
        if (!before?.healthy || !before.expectedSongs) {
          await downloadApprovedLibrary(grant.profile, { force: true, localSongCount: downloadedLibrarySongs.length });
          if (onPersonalLibraryChanged) await localInspection(onPersonalLibraryChanged());
        }
        const checked = await localInspection(inspectContentPackageIntegrity(grant.profile.id));
        setMemberIntegrity(checked);
        setLocalManifest(await localInspection(loadDownloadedLibraryMetadata()));
        if (!checked?.healthy || !checked.expectedSongs) throw new OfflinePreparationError('content_incomplete');
      } else if (!publicCatalogReady) await downloadAllSongs(catalog, setProgress);
      setNotice({ tone: 'info', text: 'Ověřuji soubory aplikace v zařízení…' });
      const checkedShell = await localInspection(inspectAppShell()); setShell(checkedShell);
      if (checkedShell.status !== 'verified') throw new OfflinePreparationError('shell_incomplete');
      await refresh();
      setNotice({ tone: 'success', text: 'Oprávnění, soubory aplikace i texty jsou uložené a ověřené.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof OfflinePreparationError ? `${error.message} (${error.code})` : friendlyError(error, 'Offline přípravu se nepodařilo dokončit.') });
    } finally { setOperation(null); }
  };

  return (
    <section className="offline-page" aria-labelledby="offline-heading">
      <div className="page-heading"><h1 id="offline-heading">Offline</h1><span className="muted">{online ? 'Online' : 'Bez připojení'}</span></div>
      <article className={'offline-readiness ' + (ready ? 'offline-readiness--ready' : '')} aria-labelledby="offline-readiness-heading">
        <header><div><h2 id="offline-readiness-heading">{!shell ? 'Kontroluji offline přípravu…' : ready ? 'Připraveno bez internetu' : 'Offline příprava není dokončena'}</h2><p>{!shell ? 'Ověřuji soubory uložené v tomto zařízení.' : ready ? 'Aplikace, oprávnění a texty jsou ověřené v tomto zařízení.' : !authorizationReady ? 'Chybí platné offline oprávnění.' : !contentReady ? 'Texty ještě nejsou kompletně uložené a ověřené.' : 'Uložení aplikace je třeba ověřit.'}</p></div><strong className="readiness-counter" aria-label="Splněné podmínky">{readinessCount}/3</strong></header>
        <div className="offline-progress" role="img" aria-label={`${formatCount(verifiedTexts)} z ${formatCount(totalTexts)} textů ověřeno. ${readinessCount} ze 3 podmínek připravenosti splněno.`}>
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="offline-progress__track" cx="60" cy="60" r="51" /><circle className="offline-progress__value" cx="60" cy="60" r="51" pathLength="100" strokeDasharray={`${textProgress * 100} 100`} transform="rotate(-90 60 60)" /></svg>
          <span><strong>{formatCount(verifiedTexts)}</strong><small>ověřených písní</small></span>
        </div>
        <ul className="readiness-checks">
          <li className={shellReady ? 'complete' : ''}><Icon name={shellReady ? 'check' : 'alert'} size={20} /><div><strong>Aplikace</strong><small>{shellReady ? 'Soubory této verze jsou uložené a ověřené.' : shell?.status === 'missing' ? 'Část souborů aplikace chybí nebo nesouhlasí.' : 'Neověřeno. Otevřete aktuální verzi online.'}</small></div></li>
          <li className={authorizationReady ? 'complete' : ''}><Icon name={authorizationReady ? 'check' : 'lock'} size={20} /><div><strong>Offline oprávnění</strong><small>{authorizationReady ? offlineGrant ? 'Platné do ' + formatDateTime(offlineGrant.offlineValidUntil) : 'Veřejné ukázky oprávnění nevyžadují.' : offlineGrant ? 'Platnost skončila nebo nesouhlasí s účtem.' : 'Připojte se a obnovte oprávnění účtu.'}</small></div></li>
          <li className={contentReady ? 'complete' : ''}><Icon name={contentReady ? 'check' : 'download'} size={20} /><div><strong>Texty a akordy</strong><small>{secureMode ? formatCount(memberIntegrity?.completeSongs ?? 0) + ' z ' + formatCount(memberIntegrity?.expectedSongs ?? localManifest?.songCount ?? downloadedLibrarySongs.length) + ' členských písní ověřeno' : formatCount(stats?.downloadedSongs ?? 0) + ' z ' + formatCount(catalog.songs.length) + ' ukázek ověřeno'}</small></div></li>
        </ul>
        {onPrepareAuthorization ? <button type="button" className="primary-button" disabled={busy || !online} onClick={() => void completePreparation()}>{busy ? 'Dokončuji přípravu…' : 'Dokončit offline přípravu'}</button> : !authorizationReady ? <button type="button" className="primary-button" disabled={busy || !online} onClick={() => onRefreshAuthorization ? void refreshAuthorization() : onNavigate('settings')}>{busy ? 'Ověřuji…' : 'Obnovit oprávnění'}</button> : !contentReady ? <button type="button" className="primary-button" disabled={busy || !online} onClick={() => secureMode ? void downloadMemberLibrary() : void runDownload('songs')}>{busy ? 'Stahuji…' : 'Stáhnout písně'}</button> : <button type="button" className="primary-button" disabled={busy} onClick={() => void refresh().catch((error) => setNotice({ tone: 'error', text: friendlyError(error) }))}>Ověřit připravenost</button>}
        {offlineProblem && <p className="error-message" role="status">{offlineProblem.message} <small>({offlineProblem.code})</small></p>}
        {!online && !ready && <p className="last-update">K dokončení chybějících kroků se připojte k internetu.</p>}
      </article>
      <dl className="offline-summary"><div><dt>Písně v zařízení</dt><dd>{formatCount(secureMode ? downloadedLibrarySongs.length : stats?.downloadedSongs ?? 0)}</dd></div><div><dt>Volitelné noty</dt><dd>{formatCount(stats?.downloadedScores ?? 0)} / {formatCount(stats?.totalScores ?? 0)} partů</dd></div></dl>
      <p className="last-update">Poslední kontrola: {shell ? formatDateTime(shell.checkedAt) : 'probíhá…'}. Noty se stahují samostatně.</p>
      {storageUsage && storageUsage.quota > 0 && <div className="storage-estimate"><label htmlFor="offline-storage-meter"><span>Odhad využití kvóty prohlížeče</span><span>{formatBytes(storageUsage.usage)} / {formatBytes(storageUsage.quota)}</span></label><meter id="offline-storage-meter" min={0} max={storageUsage.quota} value={Math.min(storageUsage.usage, storageUsage.quota)} /></div>}
      {progress && <div className="download-progress" aria-live="polite"><div className="results-heading"><strong>{progress.currentLabel}</strong><span>{progress.completed}/{progress.total}</span></div><progress max={progress.total} value={progress.completed} /><small>{formatBytes(progress.downloadedBytes)} z odhadovaných {formatBytes(progress.estimatedBytes)}</small></div>}
      {notice && <p className={`${notice.tone === 'error' ? 'error-message' : notice.tone === 'success' ? 'success-message' : 'info-message'} offline-notice`} role="status">{notice.text}</p>}

      <details className="offline-management"><summary>Správa obsahu a zařízení</summary><div>
      <article className={`offline-integrity-card ${integrityHealthy ? 'offline-integrity-card--healthy' : 'offline-integrity-card--attention'}`}>
        <div><p className="eyebrow">Kontrola dat</p><h2>{integrityHealthy ? 'Stažený obsah je v pořádku' : !hasRepairableContent ? 'Zatím není co ověřit' : 'Některé položky je třeba doplnit'}</h2><p>{integrityHealthy ? 'Počty, přítomnost obsahu a uložené délky všech částí souhlasí.' : `K opravě: členské písně ${missingMemberSongs}, ukázky ${missingPublicSongs}, party ${missingScores}. Oprava pokračuje od již ověřených částí.`}</p>{memberIntegrity && <small>Ověřeno {memberIntegrity.completeSongs}/{memberIntegrity.expectedSongs} písní · {formatBytes(memberIntegrity.availableBytes)} z {formatBytes(memberIntegrity.expectedBytes)}</small>}</div>
        <button type="button" className="secondary-button" disabled={busy || !online || !hasRepairableContent} onClick={() => void repairOfflineContent()}>{operation === 'repair' ? 'Opravuji…' : 'Zkontrolovat a opravit'}</button>
      </article>
        <p className="last-update">Poslední změna obsahu: {stats?.lastUpdated ? formatDateTime(stats.lastUpdated) : 'zatím žádná'}.</p>
        {storageUsage && <p className="last-update">Odhad využití aplikace: {formatBytes(storageUsage.usage)}. Kvóta prohlížeče: {formatBytes(storageUsage.quota)}; nejde o volnou kapacitu telefonu.</p>}
        <p>{storagePersistent === true ? 'Prohlížeč udělil vyšší ochranu úložiště. Data může stále odstranit uživatel nebo systém.' : 'Lze požádat prohlížeč o vyšší ochranu místních dat.'}</p>
        {storagePersistent !== true && <button type="button" className="secondary-button" disabled={busy} onClick={() => void protectOfflineStorage()}>Chránit offline data</button>}
        <button type="button" className="secondary-button" onClick={() => onNavigate('settings')}>Exportovat zálohu</button>
        <p className="last-update">Čekající změny: {formatCount(pendingChanges)}. {grantDaysRemaining === null ? 'Offline platnost není evidována.' : 'Zbývající platnost: ' + formatCount(Math.max(0, grantDaysRemaining)) + ' dní.'}</p>
      <div className="offline-actions">
        {secureMode && <>
          <div className="offline-section-heading"><span className="step-number" aria-hidden="true">1</span><span><p className="eyebrow">Vaše hlavní písně</p><h2>Soukromá knihovna</h2></span></div>
          <article className="member-library-download"><div><h3>{secureProfile?.role === 'admin' ? 'Správcovský balíček' : 'Členský balíček'}</h3><p>{downloadedLibrarySongs.length > 0 ? `${downloadedLibrarySongs.length} písní je uloženo v tomto zařízení; použitelnost určuje kontrola výše.` : 'V zařízení zatím nejsou stažené žádné členské písně.'}</p><div className="library-version-row"><span className={`status-badge ${memberUpdateAvailable ? 'status-badge--pending' : localManifest && remoteManifest ? 'status-badge--approved' : ''}`}>{memberUpdateAvailable ? 'Je dostupná nová verze' : localManifest ? remoteManifest ? 'Knihovna je aktuální' : 'Aktuálnost na serveru neověřena' : 'Verze zatím není evidována'}</span>{localManifest && <small>Staženo {new Date(localManifest.downloadedAt).toLocaleString('cs-CZ')} · verze {localManifest.version.slice(0, 8)}</small>}{remoteManifest && <small>Na serveru {remoteManifest.songCount} písní · {formatBytes(remoteManifest.contentBytes)}</small>}</div><small>Obnovení proběhne bezpečně až po kontrole celého balíčku. Vaše vlastní PDF importy zůstanou zachované.</small></div><div className="offline-card-actions"><button className="primary-button" type="button" disabled={busy || !online || !secureProfile} onClick={() => void downloadMemberLibrary()}>{operation === 'member-library' ? 'Stahuji…' : memberUpdateAvailable ? 'Nainstalovat novou knihovnu' : downloadedLibrarySongs.length > 0 ? 'Ověřit aktuálnost' : 'Stáhnout knihovnu'}</button>{downloadedLibrarySongs.length > 0 && <button className="danger-button" type="button" disabled={busy} onClick={() => setConfirmRemoveLibrary(true)}>Odstranit knihovnu</button>}</div></article>
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
            <article><div><h3>Ukázkový veřejný katalog</h3><p>{catalog.songs.length} písní · přibližně {formatBytes(songEstimate)}. Soukromá členská knihovna se spravuje samostatně výše.</p></div><div className="offline-card-actions"><button className="secondary-button" type="button" disabled={busy || !online} onClick={() => void runDownload('songs')}>{operation === 'songs' ? 'Stahuji…' : stats?.allSongsVerified ? 'Ověřit znovu' : 'Stáhnout ukázky'}</button><button className="danger-button" type="button" disabled={busy || (stats?.downloadedSongs ?? 0) === 0} onClick={() => setConfirmKind('songs')}>{operation === 'remove-songs' ? 'Odstraňuji…' : 'Odstranit ukázky'}</button></div></article>
            <article><div><h3>Notové party</h3><p>{stats?.totalScores ?? 0} partů · přibližně {formatBytes(scoreEstimate)} · stahují se zvlášť</p></div><div className="offline-card-actions"><button className="secondary-button" type="button" disabled={busy || !online || scoreEstimate === 0} onClick={() => void runDownload('scores')}>{operation === 'scores' ? 'Stahuji…' : stats?.allScoresVerified ? 'Ověřit znovu' : 'Stáhnout noty'}</button><button className="danger-button" type="button" disabled={busy || (stats?.downloadedScores ?? 0) === 0} onClick={() => setConfirmKind('scores')}>{operation === 'remove-scores' ? 'Odstraňuji…' : 'Odstranit noty'}</button></div></article>
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
      </div></details>
      <Dialog open={confirmKind !== null} title="Odstranit stažený obsah?" onClose={() => setConfirmKind(null)}><p>Odstranění platí pro toto zařízení. Obsah lze později znovu stáhnout.</p><button type="button" className="danger-button" onClick={() => { if (confirmKind) void removeCached(confirmKind); setConfirmKind(null); }}>Ano, odstranit</button><button type="button" className="secondary-button" onClick={() => setConfirmKind(null)}>Zrušit</button></Dialog>
      {!stats?.serviceWorkerActive && <p className="score-note">Offline jádro aplikace ještě není aktivní. Nechte stránku jednou načíst online a poté ji obnovte.</p>}
    </section>
  );
}
