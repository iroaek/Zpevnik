import { lazy, Suspense, useState } from 'react';
import type { CloudSyncState } from '../hooks/useCloudUserState';
import { AdminAccessPanel } from './AdminAccessPanel';
import { AdminOverview } from './AdminOverview';
import { AdminUsersPanel } from './AdminUsersPanel';
import { QrCodeGenerator } from './QrCodeGenerator';
import { Icon, type IconName } from '../ui/Icon';

type AdminTab = 'overview' | 'users' | 'requests' | 'songs' | 'corrections' | 'system';

const AdminCorrectionsPanel = lazy(() => import('./AdminCorrectionsPanel').then((module) => ({ default: module.AdminCorrectionsPanel })));

export function AdminPage({ cloudSync, online, onNavigate, catalogVersion = '', downloadedSongs = 0, availableSongs = 0 }: { cloudSync: CloudSyncState; online: boolean; onNavigate: (path: string) => void; catalogVersion?: string; downloadedSongs?: number; availableSongs?: number }) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const pendingLabel = cloudSync.pendingCount
    ? `${cloudSync.pendingCount} ${cloudSync.pendingCount === 1 ? 'změna čeká na odeslání' : cloudSync.pendingCount < 5 ? 'změny čekají na odeslání' : 'změn čeká na odeslání'}`
    : null;
  const labels: Array<[AdminTab, string, string, IconName]> = [
    ['overview', 'Přehled', 'Metriky, fronty a stav provozu', 'home'],
    ['users', 'Uživatelé', 'Databáze členů a jejich dostupnost', 'users'],
    ['requests', 'Žádosti', 'Schválení nových registrací', 'shield'],
    ['songs', 'Písně', 'Návrhy a nahrané soubory', 'music'],
    ['corrections', 'Opravy', 'Porovnání, rozhodnutí a historie', 'edit'],
    ['system', 'Systém', 'Synchronizace, instalace a QR kódy', 'settings'],
  ];

  return <section className="admin-page" aria-labelledby="admin-page-heading">
    <header className="admin-page-hero"><span><p className="eyebrow">Neon control center</p><h1 id="admin-page-heading">Správa zpěvníku</h1><p>Profesionální přehled členů, schvalování obsahu a provozu soukromé aplikace.</p></span><div className="admin-hero-status"><span className={`admin-live-pill ${online ? 'online' : 'offline'}`}><i />{online ? 'Neon online' : 'Offline režim'}</span><span className={`admin-live-pill admin-live-pill--sync ${cloudSync.status}`}><i />{pendingLabel ?? (cloudSync.status === 'synced' ? 'Data aktuální' : 'Synchronizace')}</span></div></header>
    <nav className="admin-tabs scroll-strip" aria-label="Sekce administrace">{labels.map(([value, label, description, icon]) => <button type="button" key={value} className={tab === value ? 'active' : ''} aria-pressed={tab === value} onClick={() => setTab(value)}><Icon name={icon} /><span><strong>{label}</strong><small>{description}</small></span></button>)}</nav>
    {tab === 'overview' && <AdminOverview cloudSync={cloudSync} online={online} onOpen={setTab} />}
    {tab === 'users' && <AdminUsersPanel />}
    {tab === 'requests' && <AdminAccessPanel mode="accounts" />}
    {tab === 'songs' && <AdminAccessPanel mode="songs" />}
    {tab === 'corrections' && <Suspense fallback={<p role="status">Načítám centrum oprav…</p>}><AdminCorrectionsPanel /></Suspense>}
    {tab === 'system' && <div className="admin-system-grid"><section className={`cloud-sync-card cloud-sync-card--${cloudSync.status}`}><span className="cloud-sync-icon" aria-hidden="true"><Icon name="sync" /></span><span><small>Stav aplikace</small><strong>{pendingLabel ?? (online ? 'Server je dostupný' : 'Zařízení je offline')}</strong><p>{cloudSync.status === 'synced' ? 'Uživatelská data jsou synchronizovaná.' : cloudSync.status === 'syncing' || cloudSync.status === 'loading' ? 'Probíhá synchronizace…' : cloudSync.error ?? 'Synchronizace čeká na připojení.'}</p></span><button type="button" className="secondary-button" disabled={!online || cloudSync.status === 'syncing' || cloudSync.status === 'loading'} onClick={() => void cloudSync.refresh()}><Icon name="sync" />Synchronizovat</button></section><section className="admin-library-health"><header><span><small>Obsahová knihovna</small><h2>Stav katalogu</h2></span><Icon name="database" /></header><dl><div><dt>Verze</dt><dd>{catalogVersion.slice(0, 12) || '—'}</dd></div><div><dt>Dostupné písně</dt><dd>{availableSongs}</dd></div><div><dt>Staženo v zařízení</dt><dd>{downloadedSongs}</dd></div></dl><button type="button" className="secondary-button" onClick={() => onNavigate('offline')}><Icon name="download" />Spravovat offline obsah</button></section><QrCodeGenerator /><section className="backup-card"><h2>Provozní nástroje</h2><p>Stažené balíčky a aktualizace aplikace spravujete v Offline obsahu.</p><div className="button-row"><button type="button" className="secondary-button" onClick={() => onNavigate('offline')}>Offline obsah</button><button type="button" className="secondary-button" onClick={() => onNavigate('settings')}>Běžné nastavení</button></div></section></div>}
  </section>;
}
