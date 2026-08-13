import { useEffect, useState } from 'react';
import type { SecureProfile } from '../auth/secureAccess';
import type { CloudSyncState } from '../hooks/useCloudUserState';
import { checkForUpdate } from '../pwa/updateManager';
import { Icon } from '../ui/Icon';
import { friendlyError } from '../ui/friendlyError';

interface AppStatusCenterProps {
  open: boolean;
  online: boolean;
  profile: SecureProfile | null;
  offlineAuthenticated: boolean;
  cloudSync: CloudSyncState;
  downloadedSongs: number;
  availableSongs: number;
  catalogVersion: string;
  updateAvailable: boolean;
  onUpdateAvailable: () => void;
  onInstallUpdate: () => Promise<void>;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export function AppStatusCenter({ open, online, profile, offlineAuthenticated, cloudSync, downloadedSongs, availableSongs, catalogVersion, updateAvailable, onUpdateAvailable, onInstallUpdate, onClose, onNavigate }: AppStatusCenterProps) {
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'current' | 'available' | 'installing' | 'error'>('idle');
  const [updateMessage, setUpdateMessage] = useState('');
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', keydown);
    if (navigator.storage?.estimate) {
      void navigator.storage.estimate().then((estimate) => {
        if (typeof estimate.usage === 'number' && typeof estimate.quota === 'number') setStorage({ usage: estimate.usage, quota: estimate.quota });
      }).catch(() => undefined);
    }
    return () => window.removeEventListener('keydown', keydown);
  }, [onClose, open, updateAvailable]);

  if (!open) return null;
  const synced = cloudSync.status === 'synced' && cloudSync.pendingCount === 0;
  const downloadedRatio = availableSongs ? Math.min(100, Math.round(downloadedSongs / availableSongs * 100)) : 0;
  const storageRatio = storage?.quota ? Math.min(100, Math.round(storage.usage / storage.quota * 100)) : null;

  const checkUpdate = async () => {
    setUpdateState('checking');
    setUpdateMessage('Kontroluji serverovou verzi…');
    try {
      const result = await checkForUpdate();
      if (result === 'update-available') {
        setUpdateState('available');
        setUpdateMessage('Nová verze je stažená a připravená.');
        onUpdateAvailable();
      } else {
        setUpdateState('current');
        setUpdateMessage(result === 'up-to-date' ? 'Používáte nejnovější dostupnou verzi.' : 'Offline jádro se aktivuje po dalším obnovení aplikace.');
      }
    } catch (error) {
      setUpdateState('error');
      setUpdateMessage(friendlyError(error, 'Kontrola aktualizace se nezdařila.'));
    }
  };

  const installUpdate = async () => {
    setUpdateState('installing');
    setUpdateMessage('Instaluji aktualizaci…');
    try { await onInstallUpdate(); }
    catch (error) {
      setUpdateState('error');
      setUpdateMessage(friendlyError(error, 'Aktualizaci se nepodařilo nainstalovat.'));
    }
  };

  return <div className="status-center-backdrop" role="presentation" onClick={onClose}>
    <section className="status-center" role="dialog" aria-modal="true" aria-labelledby="status-center-heading" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" aria-hidden="true" />
      <header><span><p className="eyebrow">Vše na jednom místě</p><h2 id="status-center-heading">Stav zpěvníku</h2></span><button type="button" className="icon-button" aria-label="Zavřít stav zpěvníku" onClick={onClose}><Icon name="close" /></button></header>
      <div className="status-center-grid">
        <article><Icon name="shield" /><span><small>Účet</small><strong>{profile?.display_name ?? 'Místní profil'}</strong><p>{profile ? `${profile.role === 'admin' ? 'Administrátor' : 'Schválený člen'}${offlineAuthenticated ? ' · ověřeno offline' : ''}` : 'Bez serverového účtu'}</p></span></article>
        <article><Icon name={online ? 'wifi' : 'cloud'} /><span><small>Připojení</small><strong>{online ? 'Online' : 'Offline'}</strong><p>{online ? 'Serverové funkce jsou dostupné.' : 'Používají se data uložená v zařízení.'}</p></span></article>
        <article><Icon name="sync" /><span><small>Synchronizace</small><strong>{synced ? 'Vše uloženo' : cloudSync.pendingCount ? `${cloudSync.pendingCount} změn čeká` : 'Probíhá kontrola'}</strong><p>{cloudSync.lastSyncedAt ? `Naposledy ${new Date(cloudSync.lastSyncedAt).toLocaleString('cs-CZ')}` : 'Čeká na první úplnou synchronizaci.'}</p></span></article>
        <article><Icon name="download" /><span><small>Offline knihovna</small><strong>{downloadedSongs} uložených písní</strong><p>{downloadedRatio} % aktuálně dostupné knihovny v zařízení.</p><span className="status-progress" role="progressbar" aria-label="Stažená knihovna" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadedRatio}><i style={{ width: `${downloadedRatio}%` }} /></span></span></article>
      </div>
      <section className={`status-update-card status-update-card--${updateAvailable || updateState === 'available' ? 'available' : updateState}`} aria-labelledby="status-update-heading">
        <Icon name={updateAvailable || updateState === 'available' ? 'download' : 'sync'} />
        <span><small>Verze aplikace</small><strong id="status-update-heading">{updateAvailable || updateState === 'available' ? 'Aktualizace je připravená' : updateState === 'checking' ? 'Probíhá kontrola' : 'Aktualizační centrum'}</strong><p>{updateMessage || 'Novou verzi lze zkontrolovat ručně. Stažené písně, přihlášení a setlisty instalace zachová.'}</p></span>
        {updateAvailable || updateState === 'available'
          ? <button type="button" className="primary-button" disabled={updateState === 'installing'} onClick={() => void installUpdate()}>{updateState === 'installing' ? 'Instaluji…' : 'Nainstalovat'}</button>
          : <button type="button" className="secondary-button" disabled={!online || updateState === 'checking'} onClick={() => void checkUpdate()}>{updateState === 'checking' ? 'Kontroluji…' : 'Zkontrolovat'}</button>}
      </section>
      <dl className="status-center-meta"><div><dt>Verze aplikace</dt><dd>{__APP_VERSION__} · {__BUILD_ID__}</dd></div><div><dt>Verze katalogu</dt><dd>{catalogVersion.slice(0, 12)}</dd></div><div><dt>Dostupné písně</dt><dd>{availableSongs}</dd></div><div><dt>Úložiště zařízení</dt><dd>{storageRatio === null ? 'Neznámé' : `${storageRatio} % využito`}</dd></div></dl>
      <div className="status-center-actions"><button type="button" className="primary-button" disabled={!online || cloudSync.status === 'loading' || cloudSync.status === 'syncing'} onClick={() => void cloudSync.refresh()}><Icon name="sync" />Synchronizovat</button><button type="button" className="secondary-button" onClick={() => { onClose(); onNavigate('offline'); }}><Icon name="download" />Offline obsah</button><button type="button" className="secondary-button" onClick={() => { onClose(); onNavigate('settings'); }}><Icon name="settings" />Nastavení</button></div>
    </section>
  </div>;
}
