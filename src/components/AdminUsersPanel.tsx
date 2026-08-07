import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAllProfiles, type SecureProfile } from '../auth/secureAccess';
import { isProfileOnline } from './adminUserPresence';

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
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [observedAt, setObservedAt] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const nextProfiles = await loadAllProfiles();
      setProfiles(nextProfiles);
      setObservedAt(Date.now());
      setMessage('');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Seznam uživatelů se nepodařilo načíst.');
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
      .filter((profile) => !normalized || `${profile.display_name} ${profile.email}`.toLocaleLowerCase('cs').includes(normalized))
      .sort((left, right) => {
        const onlineDifference = Number(isProfileOnline(right, observedAt)) - Number(isProfileOnline(left, observedAt));
        return onlineDifference || left.display_name.localeCompare(right.display_name, 'cs');
      });
  }, [observedAt, profiles, query]);

  return (
    <section className="backup-card admin-users-panel" aria-labelledby="admin-users-heading">
      <div className="results-heading"><span><p className="eyebrow">Pouze administrátor</p><h2 id="admin-users-heading">Databáze uživatelů</h2></span><button type="button" className="secondary-button" disabled={loading} onClick={() => void refresh()}>{loading ? 'Načítám…' : 'Obnovit seznam'}</button></div>
      <div className="admin-user-metrics" aria-label="Souhrn uživatelů">
        <span><small>Registrovaných</small><strong>{profiles.length}</strong></span>
        <span><small>Online</small><strong>{onlineCount}</strong></span>
        <span><small>Autorizovaných</small><strong>{approvedCount}</strong></span>
      </div>
      <label className="admin-user-search"><span>Hledat podle jména nebo e-mailu</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jméno nebo e-mail…" /></label>
      {message && <p className="error-message" role="alert">{message}</p>}
      {!message && !loading && profiles.length === 0 && <p className="empty-state">Zatím není zaregistrovaný žádný uživatel.</p>}
      <div className="admin-user-list">
        {visibleProfiles.map((profile) => {
          const online = isProfileOnline(profile, observedAt);
          return <article key={profile.id}>
            <span className={`admin-user-presence ${online ? 'online' : 'offline'}`} aria-label={online ? 'Online' : 'Offline'} aria-hidden="true" />
            <span className="admin-user-identity"><strong>{profile.display_name}</strong><small>{profile.email}</small><small>{lastActivity(profile, online)}</small></span>
            <span className="admin-user-badges"><span className={`status-badge status-badge--${profile.status}`}>{statusLabels[profile.status]}</span>{profile.role === 'admin' && <span className="status-badge">Administrátor</span>}</span>
          </article>;
        })}
      </div>
      {observedAt > 0 && <p className="last-update">Naposledy obnoveno {new Date(observedAt).toLocaleTimeString('cs-CZ')}.</p>}
      <p className="score-note">Online znamená aktivitu v aplikaci během posledních dvou minut. Stav se automaticky obnovuje každých 30 sekund.</p>
    </section>
  );
}
