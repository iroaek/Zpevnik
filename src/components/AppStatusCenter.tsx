import type { SecureProfile } from '../auth/secureAccess';
import type { CloudSyncState } from '../hooks/useCloudUserState';
import { Icon } from '../ui/Icon';

interface AppStatusCenterProps {
  open: boolean;
  online: boolean;
  profile: SecureProfile | null;
  offlineAuthenticated: boolean;
  cloudSync: CloudSyncState;
  downloadedSongs: number;
  availableSongs: number;
  catalogVersion: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export function AppStatusCenter({ open, online, profile, offlineAuthenticated, cloudSync, downloadedSongs, availableSongs, catalogVersion, onClose, onNavigate }: AppStatusCenterProps) {
  if (!open) return null;
  const synced = cloudSync.status === 'synced' && cloudSync.pendingCount === 0;
  const downloadedRatio = availableSongs ? Math.min(100, Math.round(downloadedSongs / availableSongs * 100)) : 0;
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
      <dl className="status-center-meta"><div><dt>Verze katalogu</dt><dd>{catalogVersion.slice(0, 12)}</dd></div><div><dt>Dostupné písně</dt><dd>{availableSongs}</dd></div></dl>
      <div className="status-center-actions"><button type="button" className="primary-button" disabled={!online || cloudSync.status === 'loading' || cloudSync.status === 'syncing'} onClick={() => void cloudSync.refresh()}><Icon name="sync" />Synchronizovat</button><button type="button" className="secondary-button" onClick={() => { onClose(); onNavigate('offline'); }}><Icon name="download" />Offline obsah</button><button type="button" className="secondary-button" onClick={() => { onClose(); onNavigate('settings'); }}><Icon name="settings" />Nastavení</button></div>
    </section>
  </div>;
}
