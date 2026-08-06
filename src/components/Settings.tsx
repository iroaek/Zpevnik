import { useRef, useState } from 'react';
import { downloadApprovedLibrary, signOutSecureAccount, type SecureProfile } from '../auth/secureAccess';
import type { Song } from '../domain/song';
import { downloadPersonalLibrary } from '../personalLibraryDownload';
import { exportFullBackup, importFullBackup, type UserProfile, type UserState } from '../storage/database';
import { AdminAccessPanel } from './AdminAccessPanel';

interface SettingsProps {
  userState: UserState;
  userProfile: UserProfile;
  secureProfile?: SecureProfile | null;
  secureMode?: boolean;
  personalSongs: Song[];
  onUserStateChange: React.Dispatch<React.SetStateAction<UserState>>;
  onUserProfileChange: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  onPersonalLibraryChanged: () => Promise<void>;
  onNavigate: (path: string) => void;
}

export function Settings({
  userState,
  userProfile,
  secureProfile = null,
  secureMode = false,
  personalSongs,
  onUserStateChange,
  onUserProfileChange,
  onPersonalLibraryChanged,
  onNavigate,
}: SettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const settings = userState.settings;
  const serverAdmin = secureMode && secureProfile?.role === 'admin';
  const localAdmin = userProfile.role === 'admin' && (!secureMode || serverAdmin);
  const update = (change: Partial<UserState['settings']>) => onUserStateChange((current) => ({ ...current, settings: { ...current.settings, ...change } }));

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

  const downloadMemberLibrary = async () => {
    setBackupBusy(true);
    setMessage('Stahuji soukromou členskou knihovnu…');
    try {
      if (!secureProfile) throw new Error('Chybí profil přihlášeného účtu.');
      const count = await downloadApprovedLibrary(secureProfile);
      await onPersonalLibraryChanged();
      setMessage(`Do tohoto zařízení bylo bezpečně uloženo ${count} ${serverAdmin ? 'správcovských' : 'členských'} písní.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Členskou knihovnu nelze stáhnout.');
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
      <div className="settings-grid">
        <label>Vzhled<select value={settings.theme} onChange={(event) => update({ theme: event.target.value as UserState['settings']['theme'] })}><option value="system">Podle zařízení</option><option value="light">Světlý</option><option value="dark">Tmavý – k ohni</option></select></label>
        <label>Značení akordů<select value={settings.notation} onChange={(event) => update({ notation: event.target.value as UserState['settings']['notation'] })}><option value="czech">České (H / B)</option><option value="international">Mezinárodní (B / Bb)</option></select></label>
        <label>Velikost textu <output>{settings.fontSize} px</output><input type="range" min="14" max="34" step="2" value={settings.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label>
        <label>Formát tisku<select value={settings.printSize} onChange={(event) => update({ printSize: event.target.value as 'A4' | 'A5' })}><option value="A4">A4</option><option value="A5">A5</option></select></label>
        <label className="switch-row"><input type="checkbox" checked={settings.showChords} onChange={(event) => update({ showChords: event.target.checked })} /> Zobrazovat akordy</label>
        <label className="switch-row"><input type="checkbox" checked={settings.collapseRepeatedChoruses} onChange={(event) => update({ collapseRepeatedChoruses: event.target.checked })} /> Sbalit opakované refrény</label>
        {localAdmin && <label className="switch-row"><input type="checkbox" checked={userProfile.monochromeMode} onChange={(event) => onUserProfileChange((current) => current ? { ...current, monochromeMode: event.target.checked, updatedAt: new Date().toISOString() } : current)} /> Monochromatický administrátorský režim – barevné pouze akordy</label>}
      </div>

      {secureMode && <section className="backup-card private-library-card"><h2>{serverAdmin ? 'Soukromá správcovská knihovna' : 'Soukromá členská knihovna'}</h2><p>{serverAdmin ? 'Server vydá tento balík pouze schválenému administrátorovi. Obsah ke kontrole se nedostane běžným členům.' : 'Server soubor vydá pouze přihlášenému a schválenému účtu. Do členského balíčku smějí jen písně s ověřenými právy.'}</p><button type="button" className="primary-button" disabled={backupBusy} onClick={() => void downloadMemberLibrary()}>{backupBusy ? 'Stahuji…' : 'Stáhnout do tohoto zařízení'}</button></section>}

      {!secureMode && <section className="backup-card personal-download-card"><h2>{userProfile.role === 'admin' ? 'Stáhnout moji osobní knihovnu' : 'Aktivovat správcovské zařízení'}</h2><p>Balíček je na serveru pouze v zašifrované podobě. Správný osobní kód odemkne písně v tomto zařízení a aktivuje administrátorské funkce.</p><form onSubmit={(event) => { event.preventDefault(); void downloadLegacyLibrary(); }}><label htmlFor="library-access-code">Osobní administrátorský kód</label><div className="access-code-row"><input id="library-access-code" type="password" autoComplete="off" spellCheck={false} value={accessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" disabled={backupBusy} /><button type="submit" className="primary-button" disabled={backupBusy || !accessCode.trim()}>{backupBusy ? 'Stahuji…' : 'Odemknout a stáhnout'}</button></div></form></section>}

      {serverAdmin && <AdminAccessPanel />}

      <section className="backup-card"><h2>Přenos celého zpěvníku souborem</h2><p>Záloha obsahuje nastavení, oblíbené, setlisty i všechny osobní písně ({personalSongs.length}). Soubor zůstane u vás a lze jej ručně načíst v telefonu.</p><div className="button-row"><button type="button" className="secondary-button" disabled={backupBusy} onClick={() => void exportBackup()}>{backupBusy ? 'Pracuji…' : 'Exportovat celou zálohu'}</button><label className={backupBusy ? 'secondary-button file-button disabled' : 'secondary-button file-button'}>Importovat celou zálohu<input ref={fileRef} type="file" accept="application/json,.json" disabled={backupBusy} onChange={(event) => void importBackup(event.target.files?.[0])} /></label></div>{message && <p role="status">{message}</p>}</section>
      <section className="privacy-card"><h2>Soukromí a offline provoz</h2><p>{secureMode ? 'Účet, schválení a návrhy zpracovává zabezpečený server. Soukromé soubory podléhají pravidlům účtu; veřejná PWA je neobsahuje.' : 'V místním režimu se profil, importované písně ani návrhy ze zařízení neodesílají.'} Po stažení mohou vybrané písně fungovat offline.</p></section>
      <section className="settings-links" aria-label="Nápověda a instalace"><button className="secondary-button" type="button" onClick={() => onNavigate('install')}>Nainstalovat zpěvník</button><button className="secondary-button" type="button" onClick={() => onNavigate('offline')}>Offline obsah</button><button className="secondary-button" type="button" onClick={() => onNavigate('help')}>Nápověda pro táborníky</button></section>
    </section>
  );
}
