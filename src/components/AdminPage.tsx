import { useState } from 'react';
import type { CloudSyncState } from '../hooks/useCloudUserState';
import { AdminAccessPanel } from './AdminAccessPanel';
import { AdminUsersPanel } from './AdminUsersPanel';
import { QrCodeGenerator } from './QrCodeGenerator';

type AdminTab = 'users' | 'requests' | 'songs' | 'system';

export function AdminPage({ cloudSync, online, onNavigate }: { cloudSync: CloudSyncState; online: boolean; onNavigate: (path: string) => void }) {
  const [tab, setTab] = useState<AdminTab>('users');
  const labels: Array<[AdminTab, string, string]> = [
    ['users', 'Uživatelé', 'Databáze členů a jejich dostupnost'],
    ['requests', 'Žádosti', 'Schválení nových registrací'],
    ['songs', 'Písně', 'Návrhy a nahrané soubory'],
    ['system', 'Systém', 'Synchronizace, instalace a QR kódy'],
  ];

  return <section className="admin-page" aria-labelledby="admin-page-heading">
    <header className="admin-page-hero"><p className="eyebrow">Pouze administrátor</p><h1 id="admin-page-heading">Správa zpěvníku</h1><p>Uživatelé, žádosti, nové písně a provoz aplikace jsou oddělené do přehledných sekcí.</p></header>
    <nav className="admin-tabs scroll-strip" aria-label="Sekce administrace">{labels.map(([value, label, description]) => <button type="button" key={value} className={tab === value ? 'active' : ''} aria-pressed={tab === value} onClick={() => setTab(value)}><strong>{label}</strong><small>{description}</small></button>)}</nav>
    {tab === 'users' && <AdminUsersPanel />}
    {tab === 'requests' && <AdminAccessPanel mode="accounts" />}
    {tab === 'songs' && <AdminAccessPanel mode="songs" />}
    {tab === 'system' && <div className="admin-system-grid"><section className={`cloud-sync-card cloud-sync-card--${cloudSync.status}`}><span className="cloud-sync-icon" aria-hidden="true">↻</span><span><small>Stav aplikace</small><strong>{online ? 'Server je dostupný' : 'Zařízení je offline'}</strong><p>{cloudSync.status === 'synced' ? 'Uživatelská data jsou synchronizovaná.' : cloudSync.status === 'syncing' || cloudSync.status === 'loading' ? 'Probíhá synchronizace…' : cloudSync.error ?? 'Synchronizace čeká na připojení.'}</p></span><button type="button" className="secondary-button" disabled={!online || cloudSync.status === 'syncing' || cloudSync.status === 'loading'} onClick={() => void cloudSync.refresh()}>Synchronizovat</button></section><QrCodeGenerator /><section className="backup-card"><h2>Provozní nástroje</h2><p>Stažené balíčky a aktualizace aplikace spravujete v Offline obsahu.</p><div className="button-row"><button type="button" className="secondary-button" onClick={() => onNavigate('offline')}>Offline obsah</button><button type="button" className="secondary-button" onClick={() => onNavigate('settings')}>Běžné nastavení</button></div></section></div>}
  </section>;
}
