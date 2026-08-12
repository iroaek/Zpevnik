import { useState } from 'react';
import type { CloudSyncState } from '../hooks/useCloudUserState';
import { AdminAccessPanel } from './AdminAccessPanel';
import { AdminOverview } from './AdminOverview';
import { AdminUsersPanel } from './AdminUsersPanel';
import { QrCodeGenerator } from './QrCodeGenerator';

type AdminTab = 'overview' | 'users' | 'requests' | 'songs' | 'system';

export function AdminPage({ cloudSync, online, onNavigate }: { cloudSync: CloudSyncState; online: boolean; onNavigate: (path: string) => void }) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const pendingLabel = cloudSync.pendingCount
    ? `${cloudSync.pendingCount} ${cloudSync.pendingCount === 1 ? 'změna čeká na odeslání' : cloudSync.pendingCount < 5 ? 'změny čekají na odeslání' : 'změn čeká na odeslání'}`
    : null;
  const labels: Array<[AdminTab, string, string]> = [
    ['overview', 'Přehled', 'Metriky, fronty a stav provozu'],
    ['users', 'Uživatelé', 'Databáze členů a jejich dostupnost'],
    ['requests', 'Žádosti', 'Schválení nových registrací'],
    ['songs', 'Písně', 'Návrhy a nahrané soubory'],
    ['system', 'Systém', 'Synchronizace, instalace a QR kódy'],
  ];

  return <section className="admin-page" aria-labelledby="admin-page-heading">
    <header className="admin-page-hero"><span><p className="eyebrow">Neon control center</p><h1 id="admin-page-heading">Správa zpěvníku</h1><p>Profesionální přehled členů, schvalování obsahu a provozu soukromé aplikace.</p></span><div className="admin-hero-status"><span className={`admin-live-pill ${online ? 'online' : 'offline'}`}><i />{online ? 'Neon online' : 'Offline režim'}</span><span className={`admin-live-pill admin-live-pill--sync ${cloudSync.status}`}><i />{pendingLabel ?? (cloudSync.status === 'synced' ? 'Data aktuální' : 'Synchronizace')}</span></div></header>
    <nav className="admin-tabs scroll-strip" aria-label="Sekce administrace">{labels.map(([value, label, description]) => <button type="button" key={value} className={tab === value ? 'active' : ''} aria-pressed={tab === value} onClick={() => setTab(value)}><strong>{label}</strong><small>{description}</small></button>)}</nav>
    {tab === 'overview' && <AdminOverview cloudSync={cloudSync} online={online} onOpen={setTab} />}
    {tab === 'users' && <AdminUsersPanel />}
    {tab === 'requests' && <AdminAccessPanel mode="accounts" />}
    {tab === 'songs' && <AdminAccessPanel mode="songs" />}
    {tab === 'system' && <div className="admin-system-grid"><section className={`cloud-sync-card cloud-sync-card--${cloudSync.status}`}><span className="cloud-sync-icon" aria-hidden="true">↻</span><span><small>Stav aplikace</small><strong>{pendingLabel ?? (online ? 'Server je dostupný' : 'Zařízení je offline')}</strong><p>{cloudSync.status === 'synced' ? 'Uživatelská data jsou synchronizovaná.' : cloudSync.status === 'syncing' || cloudSync.status === 'loading' ? 'Probíhá synchronizace…' : cloudSync.error ?? 'Synchronizace čeká na připojení.'}</p></span><button type="button" className="secondary-button" disabled={!online || cloudSync.status === 'syncing' || cloudSync.status === 'loading'} onClick={() => void cloudSync.refresh()}>Synchronizovat</button></section><QrCodeGenerator /><section className="backup-card"><h2>Provozní nástroje</h2><p>Stažené balíčky a aktualizace aplikace spravujete v Offline obsahu.</p><div className="button-row"><button type="button" className="secondary-button" onClick={() => onNavigate('offline')}>Offline obsah</button><button type="button" className="secondary-button" onClick={() => onNavigate('settings')}>Běžné nastavení</button></div></section></div>}
  </section>;
}
