import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadApprovedLibrary, type SecureProfile } from '../auth/secureAccess';
import type { Catalog } from '../domain/song';
import { useConnectivity } from '../hooks/useConnectivity';
import {
  downloadAllScores,
  downloadAllSongs,
  inspectOfflineContent,
  removeAllOfflineContent,
  removeScores,
  type DownloadProgress,
  type OfflineContentStats,
} from '../pwa/contentCache';
import { checkForUpdate } from '../pwa/updateManager';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface OfflineContentProps {
  catalog: Catalog;
  secureProfile?: SecureProfile | null;
  secureMode?: boolean;
  personalSongCount?: number;
  onPersonalLibraryChanged?: () => Promise<void>;
  onNavigate: (path: string) => void;
}

export function OfflineContent({
  catalog,
  secureProfile = null,
  secureMode = false,
  personalSongCount = 0,
  onPersonalLibraryChanged,
  onNavigate,
}: OfflineContentProps) {
  const online = useConnectivity();
  const [stats, setStats] = useState<OfflineContentStats | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [operation, setOperation] = useState<'member-library' | 'songs' | 'scores' | 'remove' | null>(null);
  const [message, setMessage] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const scoreEstimate = useMemo(() => catalog.songs.flatMap((song) => song.scoreAssets).reduce((sum, asset) => sum + asset.byteSize, 0), [catalog]);
  const songEstimate = useMemo(() => catalog.songs.reduce((sum, song) => sum + song.contentBytes, 0), [catalog]);

  const refresh = useCallback(async () => setStats(await inspectOfflineContent(catalog)), [catalog]);
  useEffect(() => {
    inspectOfflineContent(catalog).then(setStats).catch(() => setStats(null));
  }, [catalog]);

  const runDownload = async (kind: 'songs' | 'scores') => {
    setOperation(kind);
    setMessage('');
    setProgress(null);
    try {
      if (kind === 'songs') await downloadAllSongs(catalog, setProgress);
      else await downloadAllScores(catalog, setProgress);
      await refresh();
      setMessage(kind === 'songs' ? 'Všechny písně byly staženy a ověřeny.' : 'Všechny notové party byly staženy a ověřeny.');
    } catch (error) {
      setMessage(error instanceof Error ? `Stažení se nezdařilo: ${error.message}` : 'Stažení se nezdařilo.');
    } finally {
      setOperation(null);
    }
  };

  const remove = async (scoresOnly: boolean) => {
    setOperation('remove');
    try {
      if (scoresOnly) await removeScores(catalog);
      else await removeAllOfflineContent();
      await refresh();
      setMessage(scoresOnly ? 'Stažené noty byly odstraněny.' : 'Stažené písně, noty a katalog byly odstraněny.');
    } finally {
      setConfirmRemove(false);
      setOperation(null);
    }
  };

  const updateCheck = async () => {
    try {
      await checkForUpdate();
      setMessage('Kontrola nové verze byla spuštěna.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kontrola aktualizace se nezdařila.');
    }
  };

  const downloadMemberLibrary = async () => {
    setOperation('member-library');
    setMessage('Stahuji soukromou členskou knihovnu…');
    try {
      if (!secureProfile || secureProfile.status !== 'approved') throw new Error('Členský účet není schválený nebo se nepodařilo načíst jeho profil.');
      const count = await downloadApprovedLibrary(secureProfile);
      await onPersonalLibraryChanged?.();
      setMessage(`Hotovo: do tohoto zařízení bylo bezpečně uloženo ${count} ${secureProfile.role === 'admin' ? 'správcovských' : 'členských'} písní.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Členskou knihovnu nelze stáhnout: ${error.message}` : 'Členskou knihovnu nelze stáhnout.');
    } finally {
      setOperation(null);
    }
  };

  const busy = operation !== null;
  const ready = Boolean(stats?.allSongsVerified);
  return (
    <section className="offline-page" aria-labelledby="offline-heading">
      <p className="eyebrow">Bez signálu</p>
      <h1 id="offline-heading">Offline obsah</h1>
      <article className="install-callout"><div><strong>Chcete zpěvník jako aplikaci v telefonu?</strong><p>Otevřete instalační stránku s postupem pro Android, iPhone i počítač.</p></div><button type="button" className="primary-button" onClick={() => onNavigate('install')}>Přejít k instalaci</button></article>
      <div className={`offline-status offline-status--${ready ? 'ready' : online ? 'partial' : 'offline'}`} role="status">
        <span className="status-dot" aria-hidden="true" />
        <div><strong>{ready ? 'Písně jsou připravené offline' : online ? 'Některá data nejsou stažena' : 'Jste offline'}</strong><p>{ready ? 'Katalog i všechny texty byly ověřeny v místní cache.' : 'Stav připravenosti se zobrazí až po úplném ověření stažených souborů.'}</p></div>
      </div>

      <div className="offline-metrics">
        <span><small>Stažené písně</small><strong>{stats?.downloadedSongs ?? 0}/{stats?.totalSongs ?? catalog.songs.length}</strong></span>
        <span><small>Stažené party</small><strong>{stats?.downloadedScores ?? 0}/{stats?.totalScores ?? 0}</strong></span>
        <span><small>Verze katalogu</small><strong>{catalog.version}</strong></span>
        <span><small>Uložená data</small><strong>{formatBytes(stats?.bytes ?? 0)}</strong></span>
      </div>
      <p className="last-update">Poslední změna offline obsahu: {stats?.lastUpdated ? new Date(stats.lastUpdated).toLocaleString('cs-CZ') : 'zatím žádná'}</p>

      {progress && <div className="download-progress" aria-live="polite"><div className="results-heading"><strong>{progress.currentLabel}</strong><span>{progress.completed}/{progress.total}</span></div><progress max={progress.total} value={progress.completed} /><small>{formatBytes(progress.downloadedBytes)} z odhadovaných {formatBytes(progress.estimatedBytes)}</small></div>}
      {message && <p className={message.includes('nezdař') || message.includes('nelze') ? 'error-message' : 'success-message'} role="status">{message}</p>}

      <div className="offline-actions">
        {secureMode && <article className="member-library-download"><div><h2>{secureProfile?.role === 'admin' ? 'Soukromá správcovská knihovna' : 'Soukromá členská knihovna'}</h2><p>{personalSongCount > 0 ? `${personalSongCount} písní je uložených v tomto zařízení.` : 'V zařízení zatím nejsou stažené žádné členské písně.'}</p><small>Balíček je dostupný pouze přihlášenému a schválenému účtu. Po stažení fungují písně bez internetu.</small></div><button className="primary-button" type="button" disabled={busy || !online || !secureProfile} onClick={() => void downloadMemberLibrary()}>{operation === 'member-library' ? 'Stahuji…' : personalSongCount > 0 ? 'Obnovit členské písně' : 'Stáhnout členské písně'}</button></article>}
        <article><div><h2>Texty a akordy</h2><p>{catalog.songs.length} písní · přibližně {formatBytes(songEstimate)}</p></div><button className="primary-button" type="button" disabled={busy || !online} onClick={() => void runDownload('songs')}>{stats?.allSongsVerified ? 'Ověřit a stáhnout znovu' : 'Stáhnout celý zpěvník'}</button></article>
        <article><div><h2>Notové party</h2><p>{stats?.totalScores ?? 0} partů · přibližně {formatBytes(scoreEstimate)} · stahují se zvlášť</p></div><button className="secondary-button" type="button" disabled={busy || !online || scoreEstimate === 0} onClick={() => void runDownload('scores')}>{stats?.allScoresVerified ? 'Ověřit noty znovu' : 'Stáhnout všechny notové party'}</button></article>
        <article><div><h2>Nová verze</h2><p>Aktualizace se neaktivuje bez vašeho potvrzení.</p></div><button className="secondary-button" type="button" disabled={!online || busy} onClick={() => void updateCheck()}>Zkontrolovat aktualizaci</button></article>
      </div>

      <div className="danger-zone">
        <button className="secondary-button" type="button" disabled={busy || (stats?.downloadedScores ?? 0) === 0} onClick={() => void remove(true)}>Odstranit stažené noty</button>
        {!confirmRemove ? <button className="danger-button" type="button" disabled={busy} onClick={() => setConfirmRemove(true)}>Odstranit celý offline obsah</button> : <div className="confirm-row" role="alert"><span>Opravdu odstranit písně, noty a uložený katalog?</span><button className="danger-button" type="button" onClick={() => void remove(false)}>Ano, odstranit</button><button className="secondary-button" type="button" onClick={() => setConfirmRemove(false)}>Zrušit</button></div>}
      </div>
      {!stats?.serviceWorkerActive && <p className="score-note">Offline app shell ještě není aktivní. Nechte stránku jednou načíst online a poté ji obnovte.</p>}
    </section>
  );
}
