import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAllProfiles, loadAllSecureDevices, revokeSecureDevice, setSecureProfileStatus, type SecureDevice, type SecureProfile } from '../auth/secureAccess';
import { isProfileOnline } from './adminUserPresence';
import { friendlyError } from '../ui/friendlyError';

const statusLabels: Record<SecureProfile['status'], string> = {
  pending: 'Čeká na schválení',
  approved: 'Schválený',
  rejected: 'Zamítnutý',
  suspended: 'Pozastavený',
};

function lastActivity(profile: SecureProfile, online: boolean): string {
  if (online) return 'Online nyní';
  if (!profile.last_seen_at) return 'Dosud bez zaznamenané aktivity';
  return `Naposledy online ${new Date(profile.last_seen_at).toLocaleString('cs-CZ')}`;
}

export function AdminUsersPanel() {
  const [profiles, setProfiles] = useState<SecureProfile[]>([]);
  const [devices, setDevices] = useState<SecureDevice[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SecureProfile['status']>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [observedAt, setObservedAt] = useState(0);

  const refresh = useCallback(async () => {
    try {
      // Profily zůstávají spravovatelné i během postupného nasazení nové
      // tabulky zařízení. Neúspěch doplňkové telemetrie nesmí skrýt uživatele.
      const [nextProfiles, nextDevices] = await Promise.all([
        loadAllProfiles(),
        loadAllSecureDevices().catch(() => [] as SecureDevice[]),
      ]);
      setProfiles(nextProfiles);
      setDevices(nextDevices);
      setObservedAt(Date.now());
      setMessage('');
    } catch (caught) {
      setMessage(friendlyError(caught, 'Seznam uživatelů se nepodařilo načíst.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void refresh(), 0);
    const polling = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(polling);
    };
  }, [refresh]);

  const onlineCount = profiles.filter((profile) => isProfileOnline(profile, observedAt)).length;
  const approvedCount = profiles.filter((profile) => profile.status === 'approved').length;
  const visibleProfiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('cs');
    return profiles
      .filter((profile) => (statusFilter === 'all' || profile.status === statusFilter) && (!normalized || `${profile.display_name} ${profile.email}`.toLocaleLowerCase('cs').includes(normalized)))
      .sort((left, right) => {
        const onlineDifference = Number(isProfileOnline(right, observedAt)) - Number(isProfileOnline(left, observedAt));
        return onlineDifference || left.display_name.localeCompare(right.display_name, 'cs');
      });
  }, [observedAt, profiles, query, statusFilter]);

  const changeStatus = async (ids: string[], status: 'approved' | 'rejected' | 'suspended') => {
    if (ids.length === 0) return;
    setLoading(true);
    try {
      await Promise.all(ids.map((id) => setSecureProfileStatus(id, status)));
      setSelected([]);
      await refresh();
      setMessage(`${ids.length} účtů bylo aktualizováno.`);
    } catch (caught) {
      setMessage(friendlyError(caught, 'Hromadnou změnu se nepodařilo uložit.'));
      setLoading(false);
    }
  };

  const revokeDevice = async (device: SecureDevice) => {
    setLoading(true);
    try {
      await revokeSecureDevice(device.user_id, device.device_id);
      await refresh();
      setMessage(`Zařízení „${device.label}“ bylo odvoláno.`);
    } catch (caught) {
      setMessage(friendlyError(caught, 'Zařízení se nepodařilo odvolat.'));
      setLoading(false);
    }
  };

  return (
    <section className="backup-card admin-users-panel" aria-labelledby="admin-users-heading">
      <div className="results-heading"><span><p className="eyebrow">Pouze administrátor</p><h2 id="admin-users-heading">Databáze uživatelů</h2></span><button type="button" className="secondary-button" disabled={loading} onClick={() => void refresh()}>{loading ? 'Načítám…' : 'Obnovit seznam'}</button></div>
      <div className="admin-user-metrics" aria-label="Souhrn uživatelů">
        <span><small>Registrovaných</small><strong>{profiles.length}</strong></span>
        <span><small>Online</small><strong>{onlineCount}</strong></span>
        <span><small>Autorizovaných</small><strong>{approvedCount}</strong></span>
      </div>
      <div className="admin-user-toolbar"><label className="admin-user-search"><span>Hledat podle jména nebo e-mailu</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jméno nebo e-mail…" /></label><label>Stav<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Všechny stavy</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {visibleProfiles.length > 0 && <div className="admin-bulk-actions"><label><input type="checkbox" checked={selected.length === visibleProfiles.length} onChange={(event) => setSelected(event.target.checked ? visibleProfiles.map((profile) => profile.id) : [])} />Vybrat zobrazené ({selected.length})</label><div className="button-row"><button type="button" className="secondary-button" disabled={loading || selected.length === 0} onClick={() => void changeStatus(selected, 'approved')}>Schválit</button><button type="button" className="secondary-button" disabled={loading || selected.length === 0} onClick={() => void changeStatus(selected, 'suspended')}>Pozastavit</button><button type="button" className="danger-button" disabled={loading || selected.length === 0} onClick={() => void changeStatus(selected, 'rejected')}>Zamítnout</button></div></div>}
      {message && <p className="error-message" role="alert">{message}</p>}
      {!message && !loading && profiles.length === 0 && <p className="empty-state">Zatím není zaregistrovaný žádný uživatel.</p>}
      <div className="admin-user-list">
        {visibleProfiles.map((profile) => {
          const online = isProfileOnline(profile, observedAt);
          const profileDevices = devices.filter((device) => device.user_id === profile.id);
          return <article key={profile.id} className="admin-user-row">
            <div className="admin-user-primary">
              <label className="admin-user-select" title={`Vybrat uživatele ${profile.display_name}`}>
                <input type="checkbox" aria-label={`Vybrat uživatele ${profile.display_name}`} checked={selected.includes(profile.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, profile.id])] : current.filter((id) => id !== profile.id))} />
              </label>
              <span className="admin-user-avatar" aria-hidden="true">
                {profile.display_name.trim().charAt(0).toLocaleUpperCase('cs') || '?'}
                <i className={`admin-user-presence ${online ? 'online' : 'offline'}`} />
              </span>
              <span className="admin-user-identity"><strong>{profile.display_name}</strong><small className="admin-user-email">{profile.email}</small><small>{lastActivity(profile, online)}</small></span>
            </div>
            <div className="admin-user-badges">
              <span className={`status-badge status-badge--${profile.status}`}>{statusLabels[profile.status]}</span>
              {profile.role === 'admin' && <span className="status-badge status-badge--admin">Administrátor</span>}
              <button type="button" className="admin-user-device-button" aria-expanded={expandedId === profile.id} aria-controls={`admin-devices-${profile.id}`} onClick={() => setExpandedId(expandedId === profile.id ? '' : profile.id)}><span>{profileDevices.length} zařízení</span><i aria-hidden="true">⌄</i></button>
            </div>
            {expandedId === profile.id && <div className="admin-device-list" id={`admin-devices-${profile.id}`}>{profileDevices.length === 0 ? <p>Žádné zařízení zatím nebylo registrováno.</p> : profileDevices.map((device) => <div key={device.device_id}><span><strong>{device.label}</strong><small>Naposledy {new Date(device.last_seen_at).toLocaleString('cs-CZ')}</small><small>{device.revoked_at ? `Odvoláno ${new Date(device.revoked_at).toLocaleString('cs-CZ')}` : 'Aktivní offline přístup'}</small></span>{!device.revoked_at && <button type="button" className="danger-button" disabled={loading} onClick={() => void revokeDevice(device)}>Odvolat</button>}</div>)}</div>}
          </article>;
        })}
      </div>
      {observedAt > 0 && <p className="last-update">Naposledy obnoveno {new Date(observedAt).toLocaleTimeString('cs-CZ')}.</p>}
      <p className="score-note">Online znamená aktivitu v aplikaci během posledních dvou minut. Stav se automaticky obnovuje každých 30 sekund.</p>
    </section>
  );
}
