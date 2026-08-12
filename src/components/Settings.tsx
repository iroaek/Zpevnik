import { useRef, useState } from 'react';
import { beginMigratedAccountActivation, signOutSecureAccount, type SecureProfile } from '../auth/secureAccess';
import type { Song } from '../domain/song';
import type { CloudSyncState } from '../hooks/useCloudUserState';
import { downloadPersonalLibrary } from '../personalLibraryDownload';
import { exportFullBackup, importFullBackup, type UserProfile, type UserState } from '../storage/database';
import { QrCodeGenerator } from './QrCodeGenerator';

interface SettingsProps {
  userState: UserState;
  userProfile: UserProfile;
  secureProfile?: SecureProfile | null;
  secureMode?: boolean;
  cloudSync?: CloudSyncState;
  personalSongs: Song[];
  onUserStateChange: React.Dispatch<React.SetStateAction<UserState>>;
  onUserProfileChange: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  onPersonalLibraryChanged: () => Promise<void>;
  onNavigate: (path: string) => void;
  onRefreshSecureProfile?: () => Promise<void>;
  onOpenGuide?: () => void;
}

export function Settings({
  userState,
  userProfile,
  secureProfile = null,
  secureMode = false,
  cloudSync,
  personalSongs,
  onUserStateChange,
  onUserProfileChange,
  onPersonalLibraryChanged,
  onNavigate,
  onRefreshSecureProfile,
  onOpenGuide,
}: SettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState('');
  const settings = userState.settings;
  const serverAdmin = secureMode && secureProfile?.role === 'admin';
  const localAdmin = userProfile.role === 'admin' && (!secureMode || serverAdmin);
  const update = (change: Partial<UserState['settings']>) => onUserStateChange((current) => ({ ...current, settings: { ...current.settings, ...change } }));
  const pendingSyncLabel = cloudSync?.pendingCount
    ? `${cloudSync.pendingCount} ${cloudSync.pendingCount === 1 ? 'změna čeká' : cloudSync.pendingCount < 5 ? 'změny čekají' : 'změn čeká'}`
    : null;
  const nextSyncAttempt = cloudSync?.nextRetryAt
    ? ` Další pokus ${new Date(cloudSync.nextRetryAt).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`
    : '';

  const refreshPermissions = async () => {
    if (!onRefreshSecureProfile) return;
    setPermissionBusy(true);
    setPermissionMessage('Obnovuji oprávnění účtu…');
    try {
      await onRefreshSecureProfile();
      setPermissionMessage('Oprávnění účtu byla obnovena ze serveru.');
    } catch (error) {
      setPermissionMessage(error instanceof Error ? `Oprávnění nelze obnovit: ${error.message}` : 'Oprávnění nelze obnovit.');
    } finally {
      setPermissionBusy(false);
    }
  };

  const activateMigratedAccount = async () => {
    setPermissionBusy(true);
    setPermissionMessage('Připravuji bezpečnou aktivaci Neon účtu…');
    try {
      await beginMigratedAccountActivation();
    } catch (error) {
      setPermissionMessage(error instanceof Error ? `Aktivaci nelze zahájit: ${error.message}` : 'Aktivaci nelze zahájit.');
      setPermissionBusy(false);
    }
  };

  const exportBackup = async () => {
    setBackupBusy(true);
    setMessage('Připravuji zálohu osobní knihovny…');
    try {
      const count = await exportFullBackup(userState, personalSongs);
      setMessage(`Záloha byla vytvořena: ${count} osobních písní a nastavení.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Zálohu nelze vytvořit: ${error.message}` : 'Zálohu nelze vytvořit.');
    } finally {
      setBackupBusy(false);
    }
  };

  const importBackup = async (file: File | undefined) => {
    if (!file) return;
    setBackupBusy(true);
    try {
      const imported = await importFullBackup(file);
      onUserStateChange(imported.state);
      await onPersonalLibraryChanged();
      setMessage(`Záloha byla obnovena${imported.personalSongCount ? ` včetně ${imported.personalSongCount} osobních písní` : ''}.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Zálohu nelze načíst: ${error.message}` : 'Zálohu nelze načíst.');
    } finally {
      setBackupBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const downloadLegacyLibrary = async () => {
    setBackupBusy(true);
    setMessage('Stahuji a odemykám osobní písně…');
    try {
      const imported = await downloadPersonalLibrary(accessCode);
      onUserStateChange(imported.state);
      onUserProfileChange((current) => current ? { ...current, role: 'admin', monochromeMode: true, updatedAt: new Date().toISOString() } : current);
      await onPersonalLibraryChanged();
      setAccessCode('');
      setMessage(`Hotovo: do tohoto zařízení bylo uloženo ${imported.personalSongCount} osobních písní.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Osobní písně nelze stáhnout.');
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <p className="eyebrow">Podle vás</p><h1 id="settings-heading">Nastavení</h1>
      <section className="profile-card">
        <span className="profile-avatar" aria-hidden="true">{userProfile.displayName.slice(0, 1).toLocaleUpperCase('cs')}</span>
        <span><strong>{userProfile.displayName}</strong><small>{secureMode ? `${serverAdmin ? 'Administrátor' : 'Schválený člen'} · ${secureProfile?.email ?? ''}` : userProfile.role === 'admin' ? 'Administrátor tohoto zařízení' : 'Profil tohoto zařízení'}</small></span>
        {secureMode && <button type="button" className="secondary-button profile-signout" onClick={() => void signOutSecureAccount()}>Odhlásit</button>}
      </section>

      {secureMode && <section className={`account-role-card ${serverAdmin ? 'account-role-card--admin' : ''}`} aria-label="Oprávnění účtu"><span><small>Oprávnění účtu</small><strong>{serverAdmin ? 'Administrátor' : 'Schválený člen'}</strong><p>{serverAdmin ? 'Správa uživatelů a návrhů písní je aktivní.' : 'Administrace je dostupná pouze správcům.'}</p></span><button type="button" className="secondary-button" disabled={permissionBusy} onClick={() => void refreshPermissions()}>{permissionBusy ? 'Obnovuji…' : 'Obnovit oprávnění'}</button></section>}
      {secureMode && !secureProfile?.auth_user_id && <section className="migration-note account-activation-note" aria-label="Aktivace Neon účtu"><strong>Dokončete přechod na nové přihlášení</strong><span>Stažené písně zůstanou v tomto zařízení. Po ověření stejného e-mailu se obnoví vaše schválení, role i setlisty.</span><button type="button" className="primary-button" disabled={permissionBusy} onClick={() => void activateMigratedAccount()}>{permissionBusy ? 'Připravuji…' : 'Aktivovat přihlášení přes Neon'}</button></section>}
      {permissionMessage && <p className="info-message" role="status">{permissionMessage}</p>}
      {secureMode && cloudSync && <section className={`cloud-sync-card cloud-sync-card--${cloudSync.status}`} aria-label="Synchronizace mezi zařízeními"><span className="cloud-sync-icon" aria-hidden="true">↻</span><span><small>Synchronizace</small><strong>{pendingSyncLabel ?? (cloudSync.status === 'synced' ? 'Synchronizováno' : cloudSync.status === 'syncing' || cloudSync.status === 'loading' ? 'Ukládám změny…' : cloudSync.status === 'offline' ? 'Čeká na připojení' : cloudSync.status === 'error' ? 'Vyžaduje pozornost' : 'Není aktivní')}</strong><p>{cloudSync.error ?? (cloudSync.lastSyncedAt ? `Naposledy ${new Date(cloudSync.lastSyncedAt).toLocaleString('cs-CZ')}` : 'Čeká na první synchronizaci.')}{nextSyncAttempt}</p></span><button type="button" className="secondary-button" disabled={cloudSync.status === 'loading' || cloudSync.status === 'syncing'} onClick={() => void cloudSync.refresh()}>Obnovit</button></section>}

      {serverAdmin && <section className="admin-entry-card" aria-label="Administrace"><span><small>Pouze administrátor</small><strong>Správa zpěvníku</strong><p>Uživatelé, žádosti, písně a systém.</p></span><button type="button" className="primary-button" onClick={() => onNavigate('admin')}>Otevřít administraci</button></section>}

      <div className="results-heading settings-section-heading"><h2>Běžné nastavení</h2><span>Vzhled a čtečka</span></div>
      <div className="settings-grid">
        <label>Vzhled<select value={settings.theme} onChange={(event) => update({ theme: event.target.value as UserState['settings']['theme'] })}><option value="system">Podle zařízení</option><option value="light">Světlý</option><option value="dark">Tmavý – k ohni</option></select></label>
        <label>Značení akordů<select value={settings.notation} onChange={(event) => update({ notation: event.target.value as UserState['settings']['notation'] })}><option value="czech">České (H / B)</option><option value="international">Mezinárodní (B / Bb)</option></select></label>
        <label>Velikost textu <output>{settings.fontSize} px</output><input type="range" min="14" max="34" step="2" value={settings.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label>
        <label>Formát tisku<select value={settings.printSize} onChange={(event) => update({ printSize: event.target.value as 'A4' | 'A5' })}><option value="A4">A4</option><option value="A5">A5</option></select></label>
        <label className="switch-row"><input type="checkbox" checked={settings.showChords} onChange={(event) => update({ showChords: event.target.checked })} /> Zobrazovat akordy</label>
        <label className="switch-row"><input type="checkbox" checked={settings.collapseRepeatedChoruses} onChange={(event) => update({ collapseRepeatedChoruses: event.target.checked })} /> Sbalit opakované refrény</label>
        {localAdmin && <label className="switch-row"><input type="checkbox" checked={userProfile.monochromeMode} onChange={(event) => onUserProfileChange((current) => current ? { ...current, monochromeMode: event.target.checked, updatedAt: new Date().toISOString() } : current)} /> Monochromatický administrátorský režim – barevné pouze akordy</label>}
      </div>

      {!secureMode && <section className="backup-card personal-download-card"><h2>{userProfile.role === 'admin' ? 'Stáhnout moji osobní knihovnu' : 'Aktivovat správcovské zařízení'}</h2><p>Balíček je na serveru pouze v zašifrované podobě. Správný osobní kód odemkne písně v tomto zařízení a aktivuje administrátorské funkce.</p><form onSubmit={(event) => { event.preventDefault(); void downloadLegacyLibrary(); }}><label htmlFor="library-access-code">Osobní administrátorský kód</label><div className="access-code-row"><input id="library-access-code" type="password" autoComplete="off" spellCheck={false} value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" disabled={backupBusy} /><button type="submit" className="primary-button" disabled={backupBusy || !accessCode.trim()}>{backupBusy ? 'Stahuji…' : 'Odemknout a stáhnout'}</button></div></form></section>}

      {localAdmin && !serverAdmin && <QrCodeGenerator />}

      <section className="backup-card"><h2>Přenos celého zpěvníku souborem</h2><p>Záloha obsahuje nastavení, oblíbené, setlisty i všechny osobní písně ({personalSongs.length}). Soubor zůstane u vás a lze jej ručně načíst v telefonu.</p><div className="button-row"><button type="button" className="secondary-button" disabled={backupBusy} onClick={() => void exportBackup()}>{backupBusy ? 'Pracuji…' : 'Exportovat celou zálohu'}</button><label className={backupBusy ? 'secondary-button file-button disabled' : 'secondary-button file-button'}>Importovat celou zálohu<input ref={fileRef} type="file" accept="application/json,.json" disabled={backupBusy} onChange={(event) => void importBackup(event.target.files?.[0])} /></label></div>{message && <p role="status">{message}</p>}</section>
      <section className="privacy-card"><h2>Soukromí a offline provoz</h2><p>{secureMode ? 'Účet, schválení a návrhy zpracovává zabezpečený server. Soukromé soubory podléhají pravidlům účtu; veřejná PWA je neobsahuje.' : 'V místním režimu se profil, importované písně ani návrhy ze zařízení neodesílají.'} Po stažení mohou vybrané písně fungovat offline.</p></section>
      <section className="settings-links" aria-label="Nápověda a instalace">{onOpenGuide && <button className="secondary-button" type="button" onClick={onOpenGuide}>Spustit úvodního průvodce</button>}<button className="secondary-button" type="button" onClick={() => onNavigate('install')}>Nainstalovat zpěvník</button><button className="secondary-button" type="button" onClick={() => onNavigate('offline')}>Offline obsah</button><button className="secondary-button" type="button" onClick={() => onNavigate('help')}>Nápověda pro táborníky</button>{import.meta.env.DEV && <button className="secondary-button" type="button" onClick={() => onNavigate('diagnostics')}>Vývojová diagnostika</button>}</section>
    </section>
  );
}
