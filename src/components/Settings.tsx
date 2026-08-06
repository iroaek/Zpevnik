import { useRef, useState } from 'react';
import type { Song } from '../domain/song';
import { exportFullBackup, importFullBackup, type UserState } from '../storage/database';

interface SettingsProps {
  userState: UserState;
  personalSongs: Song[];
  onUserStateChange: React.Dispatch<React.SetStateAction<UserState>>;
  onPersonalLibraryChanged: () => Promise<void>;
  onNavigate: (path: string) => void;
}

export function Settings({ userState, personalSongs, onUserStateChange, onPersonalLibraryChanged, onNavigate }: SettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const settings = userState.settings;
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

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <p className="eyebrow">Podle vás</p><h1 id="settings-heading">Nastavení</h1>
      <div className="settings-grid">
        <label>Vzhled<select value={settings.theme} onChange={(event) => update({ theme: event.target.value as UserState['settings']['theme'] })}><option value="system">Podle zařízení</option><option value="light">Světlý</option><option value="dark">Tmavý – k ohni</option></select></label>
        <label>Značení akordů<select value={settings.notation} onChange={(event) => update({ notation: event.target.value as UserState['settings']['notation'] })}><option value="czech">České (H / B)</option><option value="international">Mezinárodní (B / Bb)</option></select></label>
        <label>Velikost textu <output>{settings.fontSize} px</output><input type="range" min="14" max="34" step="2" value={settings.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label>
        <label>Formát tisku<select value={settings.printSize} onChange={(event) => update({ printSize: event.target.value as 'A4' | 'A5' })}><option value="A4">A4</option><option value="A5">A5</option></select></label>
        <label className="switch-row"><input type="checkbox" checked={settings.showChords} onChange={(event) => update({ showChords: event.target.checked })} /> Zobrazovat akordy</label>
        <label className="switch-row"><input type="checkbox" checked={settings.collapseRepeatedChoruses} onChange={(event) => update({ collapseRepeatedChoruses: event.target.checked })} /> Sbalit opakované refrény</label>
      </div>
      <section className="backup-card"><h2>Přenos celého zpěvníku</h2><p>Záloha obsahuje nastavení, oblíbené, setlisty i všechny osobní písně ({personalSongs.length}). Soubor zůstane u vás a lze jej jednou načíst v telefonu; na server se nic neposílá.</p><div className="button-row"><button type="button" className="primary-button" disabled={backupBusy} onClick={() => void exportBackup()}>{backupBusy ? 'Pracuji…' : 'Exportovat celou zálohu'}</button><label className={backupBusy ? 'secondary-button file-button disabled' : 'secondary-button file-button'}>Importovat celou zálohu<input ref={fileRef} type="file" accept="application/json,.json" disabled={backupBusy} onChange={(event) => void importBackup(event.target.files?.[0])} /></label></div>{message && <p role="status">{message}</p>}</section>
      <section className="privacy-card"><h2>Soukromí a offline provoz</h2><p>Aplikace nepoužívá externí API a neposílá písně ani uživatelská data třetím stranám. Po prvním načtení jsou hlavní soubory uloženy v offline cache.</p></section>
      <section className="settings-links" aria-label="Nápověda a instalace"><button className="secondary-button" type="button" onClick={() => onNavigate('install')}>Nainstalovat zpěvník</button><button className="secondary-button" type="button" onClick={() => onNavigate('offline')}>Offline obsah</button><button className="secondary-button" type="button" onClick={() => onNavigate('help')}>Nápověda pro táborníky</button></section>
    </section>
  );
}
