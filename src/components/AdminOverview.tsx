import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { loadAllProfiles, loadRemoteSongSubmissions, type SecureProfile } from '../auth/secureAccess';
import type { CloudSyncState } from '../hooks/useCloudUserState';
import { isProfileOnline } from './adminUserPresence';
import { Icon } from '../ui/Icon';
import { friendlyError } from '../ui/friendlyError';

type AdminDestination = 'users' | 'requests' | 'songs' | 'system';

const statusLabels: Record<SecureProfile['status'], string> = {
  approved: 'Schválení',
  pending: 'Čekající',
  rejected: 'Zamítnutí',
  suspended: 'Pozastavení',
};

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
  const approvalPercentage = profiles.length ? Math.round(statusCounts.approved / profiles.length * 100) : 0;
  const pendingTotal = statusCounts.pending + pendingSongs + cloudSync.pendingCount;
  const newestProfiles = [...profiles]
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, 4);
  const weeklyActivity = useMemo(() => {
    if (!observedAt) return [];
    const formatter = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short' });
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(observedAt - (6 - index) * 86_400_000);
      const key = day.toISOString().slice(0, 10);
      return {
        key,
        label: formatter.format(day).replace('.', ''),
        count: profiles.filter((profile) => profile.last_seen_at?.slice(0, 10) === key).length,
      };
    });
  }, [observedAt, profiles]);
  const peakActivity = Math.max(1, ...weeklyActivity.map((day) => day.count));

  return <section className="admin-overview" aria-labelledby="admin-overview-heading">
    <div className="admin-command-bar">
      <span><p className="eyebrow">Živý provoz</p><h2 id="admin-overview-heading">Přehled administrace</h2><small>{observedAt ? `Aktualizováno ${new Date(observedAt).toLocaleTimeString('cs-CZ')}` : 'Načítám aktuální stav z Neonu…'}</small></span>
      <button type="button" className="secondary-button" disabled={loading || !online} onClick={() => void refresh()}><Icon name="sync" />{loading ? 'Načítám…' : 'Obnovit data'}</button>
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}

    <div className={`admin-kpi-grid ${loading ? 'admin-kpi-grid--loading' : ''}`} aria-label="Hlavní provozní ukazatele" aria-busy={loading}>
      <button type="button" onClick={() => onOpen('users')}><span className="admin-kpi-icon"><Icon name="users" /></span><small>Registrovaní</small><strong>{profiles.length}</strong><em>celkem profilů</em></button>
      <button type="button" onClick={() => onOpen('users')}><span className="admin-kpi-icon admin-kpi-icon--online"><Icon name="wifi" /></span><small>Online nyní</small><strong>{onlineCount}</strong><em>poslední 2 minuty</em></button>
      <button type="button" onClick={() => onOpen('users')}><span className="admin-kpi-icon"><Icon name="check" /></span><small>Autorizovaní</small><strong>{statusCounts.approved}</strong><em>{approvalPercentage} % účtů</em></button>
      <button type="button" className={pendingTotal ? 'admin-kpi--attention' : ''} onClick={() => onOpen(statusCounts.pending ? 'requests' : pendingSongs ? 'songs' : 'system')}><span className="admin-kpi-icon"><Icon name="alert" /></span><small>Vyžaduje pozornost</small><strong>{pendingTotal}</strong><em>účty, písně a sync</em></button>
    </div>

    <div className={`admin-insight-grid ${loading ? 'admin-insight-grid--loading' : ''}`} aria-busy={loading}>
      <article className="admin-chart-card">
        <header><span><small>Stav členské základny</small><h3>Schválené účty</h3></span><strong>{approvalPercentage} %</strong></header>
        <div className="admin-donut-layout">
          <div className="admin-donut" role="img" aria-label={`${statusCounts.approved} z ${profiles.length} účtů je schválených`} style={{ '--admin-approved-angle': `${approvalPercentage * 3.6}deg` } as CSSProperties}><span><strong>{statusCounts.approved}</strong><small>z {profiles.length}</small></span></div>
          <div className="admin-chart-legend">{(Object.keys(statusCounts) as Array<keyof typeof statusCounts>).map((status) => <span key={status}><i className={`admin-legend-dot admin-legend-dot--${status}`} /> <small>{statusLabels[status]}</small><strong>{statusCounts[status]}</strong></span>)}</div>
        </div>
      </article>

      <article className="admin-chart-card">
        <header><span><small>Rozložení stavů</small><h3>Účty podle oprávnění</h3></span><button type="button" className="text-button" onClick={() => onOpen('users')}>Detail</button></header>
        <div className="admin-bars">{(Object.keys(statusCounts) as Array<keyof typeof statusCounts>).map((status) => {
          const percentage = profiles.length ? Math.round(statusCounts[status] / profiles.length * 100) : 0;
          return <div key={status}><span><small>{statusLabels[status]}</small><strong>{statusCounts[status]}</strong></span><div role="progressbar" aria-label={statusLabels[status]} aria-valuemin={0} aria-valuemax={profiles.length} aria-valuenow={statusCounts[status]}><i className={`admin-bar admin-bar--${status}`} style={{ '--admin-bar-width': `${percentage}%` } as CSSProperties} /></div></div>;
        })}</div>
      </article>

      <article className="admin-queue-card">
        <header><span><small>Pracovní fronta</small><h3>Co čeká na vyřízení</h3></span><strong>{pendingTotal}</strong></header>
        <button type="button" onClick={() => onOpen('requests')}><Icon name="users" /><span><strong>Nové registrace</strong><small>Schválit nebo zamítnout účet</small></span><em>{statusCounts.pending}</em></button>
        <button type="button" onClick={() => onOpen('songs')}><Icon name="music" /><span><strong>Návrhy písní</strong><small>Ruční kontrola práv a obsahu</small></span><em>{pendingSongs}</em></button>
        <button type="button" onClick={() => onOpen('system')}><Icon name="sync" /><span><strong>Čekající synchronizace</strong><small>Změny uložené v zařízení</small></span><em>{cloudSync.pendingCount}</em></button>
      </article>

      <article className="admin-health-card">
        <header><span><small>Provozní stav</small><h3>Systém a bezpečnost</h3></span><span className={`admin-live-pill ${online ? 'online' : 'offline'}`}><i />{online ? 'Online' : 'Offline'}</span></header>
        <dl>
          <div><dt>Neon server</dt><dd>{online ? 'Dostupný' : 'Bez spojení'}</dd></div>
          <div><dt>Synchronizace</dt><dd>{cloudSync.status === 'synced' ? 'Aktuální' : cloudSync.status === 'offline' ? 'Lokální režim' : cloudSync.status === 'error' ? 'Vyžaduje kontrolu' : 'Probíhá'}</dd></div>
          <div><dt>Offline přístup</dt><dd>Podepsané oprávnění</dd></div>
        </dl>
        <button type="button" className="secondary-button" onClick={() => onOpen('system')}>Otevřít provozní nástroje</button>
      </article>

      <article className="admin-chart-card admin-activity-card">
        <header><span><small>Posledních 7 dní</small><h3>Aktivita členů</h3></span><strong>{weeklyActivity.reduce((sum, day) => sum + day.count, 0)}</strong></header>
        <div className="admin-activity-chart" role="img" aria-label="Počet uživatelů podle dne jejich poslední aktivity">
          {weeklyActivity.map((day) => <span key={day.key}><i style={{ '--admin-activity-level': `${Math.max(8, day.count / peakActivity * 100)}%` } as CSSProperties} /><strong>{day.count}</strong><small>{day.label}</small></span>)}
        </div>
        <p>Graf pracuje pouze s posledním bezpečně evidovaným přístupem účtu; nejde o sledování jednotlivých návštěv.</p>
      </article>
    </div>

    <article className="admin-recent-card">
      <header><span><small>Poslední registrace</small><h3>Nejnovější členové</h3></span><button type="button" className="text-button" onClick={() => onOpen('users')}>Všichni uživatelé</button></header>
      <div>{newestProfiles.length ? newestProfiles.map((profile) => <span key={profile.id}><i className={`admin-user-presence ${isProfileOnline(profile, observedAt) ? 'online' : 'offline'}`} /><span><strong>{profile.display_name}</strong><small>{profile.email}</small></span><em className={`status-badge status-badge--${profile.status}`}>{statusLabels[profile.status]}</em></span>) : <p className="empty-state">Zatím nejsou dostupné žádné profily.</p>}</div>
    </article>
  </section>;
}
