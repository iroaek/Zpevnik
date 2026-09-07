import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAllProfiles, loadRemoteSongSubmissions, type SecureProfile } from '../auth/secureAccess';
import type { CloudSyncState } from '../hooks/useCloudUserState';
import { isProfileOnline } from './adminUserPresence';
import { formatCount, formatDateTime } from '../ui/format';
import { Icon } from '../ui/Icon';
import { friendlyError } from '../ui/friendlyError';

type AdminDestination = 'users' | 'requests' | 'songs' | 'system';

export function AdminOverview({
  cloudSync,
  online,
  onOpen,
}: {
  cloudSync: CloudSyncState;
  online: boolean;
  onOpen: (destination: AdminDestination) => void;
}) {
  const [profiles, setProfiles] = useState<SecureProfile[]>([]);
  const [pendingSongs, setPendingSongs] = useState(0);
  const [observedAt, setObservedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProfiles, submissions] = await Promise.all([loadAllProfiles(), loadRemoteSongSubmissions()]);
      setProfiles(nextProfiles);
      setPendingSongs(submissions.filter((submission) => submission.status === 'pending_review').length);
      setObservedAt(Date.now());
      setError('');
    } catch (caught) {
      setError(friendlyError(caught, 'Provozní přehled se nepodařilo načíst.'));
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

  const statusCounts = useMemo(() => ({
    approved: profiles.filter((profile) => profile.status === 'approved').length,
    pending: profiles.filter((profile) => profile.status === 'pending').length,
    rejected: profiles.filter((profile) => profile.status === 'rejected').length,
    suspended: profiles.filter((profile) => profile.status === 'suspended').length,
  }), [profiles]);
  const onlineCount = profiles.filter((profile) => isProfileOnline(profile, observedAt)).length;
  const pendingTotal = statusCounts.pending + pendingSongs + cloudSync.pendingCount;

  const known = observedAt > 0;
  const stale = !online || Boolean(error);
  return <section className="admin-overview" aria-labelledby="admin-overview-heading">
    <div className="admin-command-bar"><span><h2 id="admin-overview-heading">Přehled administrace</h2><small>{known ? 'Data z ' + formatDateTime(observedAt) + (stale ? ' · zastaralá' : '') : loading ? 'Načítám přehled…' : 'Data nejsou dostupná'}</small></span><button type="button" className="icon-button" aria-label="Obnovit data" disabled={loading || !online} onClick={() => void refresh()}><Icon name="sync" /></button></div>
    {error && <p className="error-message" role="alert">{error}</p>}
    {loading && !known && <p role="status">Načítám účty a návrhy písní…</p>}
    {known && <>
      <article className="admin-queue-card" aria-label="Práce k vyřízení"><h3>Co čeká na vyřízení</h3>
        {pendingTotal === 0 && cloudSync.status !== 'error' ? <p><Icon name="check" size={18} /> Nic nečeká na vyřízení</p> : <>
          {statusCounts.pending > 0 && <button type="button" onClick={() => onOpen('requests')}><Icon name="users" /><span><strong>Nové registrace</strong><small>Schválit nebo zamítnout účet</small></span><em>{formatCount(statusCounts.pending)}</em></button>}
          {pendingSongs > 0 && <button type="button" onClick={() => onOpen('songs')}><Icon name="music" /><span><strong>Návrhy písní</strong><small>Kontrola práv a obsahu</small></span><em>{formatCount(pendingSongs)}</em></button>}
          {(cloudSync.pendingCount > 0 || cloudSync.status === 'error') && <button type="button" onClick={() => onOpen('system')}><Icon name={cloudSync.status === 'error' ? 'alert' : 'sync'} /><span><strong>{cloudSync.status === 'error' ? 'Chyba synchronizace' : 'Čekající synchronizace'}</strong><small>Změny v tomto zařízení</small></span><em>{formatCount(cloudSync.pendingCount)}</em></button>}
        </>}
      </article>
      <div className="admin-kpi-grid" aria-label="Hlavní provozní ukazatele" aria-busy={loading}>
        <button type="button" onClick={() => onOpen('users')}><small>Registrovaní</small><strong>{formatCount(profiles.length)}</strong><em>celkem profilů</em></button>
        <button type="button" onClick={() => onOpen('users')}><small>Schválení členové</small><strong>{formatCount(statusCounts.approved)}</strong><em>mají přístup</em></button>
        <button type="button" onClick={() => onOpen('users')}><small>Online při kontrole</small><strong>{formatCount(onlineCount)}</strong><em>aktivita do 2 minut</em></button>
        <button type="button" onClick={() => onOpen('requests')}><small>Čekající účty</small><strong>{formatCount(statusCounts.pending)}</strong><em>na schválení</em></button>
      </div>
      <div className="admin-status-list"><span>Zamítnutí: {formatCount(statusCounts.rejected)}</span><span>Pozastavení: {formatCount(statusCounts.suspended)}</span></div>
    </>}
    <div className="admin-status-list" aria-label="Provozní stav"><span>Síť: {online ? 'online' : 'bez připojení'}</span><span>Synchronizace: {cloudSync.status === 'synced' ? 'aktuální' : cloudSync.status === 'error' ? 'vyžaduje kontrolu' : cloudSync.status === 'offline' ? 'místní změny' : 'čeká / probíhá'}</span></div>
    <button type="button" className="secondary-button" onClick={() => onOpen('system')}>Provozní nástroje</button>
  </section>;
}
