import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import catalogJson from './generated/catalog.json';
import { AccountAccessPage } from './components/AccountAccessPage';
import { AdminPage } from './components/AdminPage';
import { ApprovalGate } from './components/ApprovalGate';
import { HelpPage } from './components/HelpPage';
import { InstallPage } from './components/InstallPage';
import { Library } from './components/Library';
import { OfflineContent } from './components/OfflineContent';
import { PasswordRecoveryPage } from './components/PasswordRecoveryPage';
import { PdfImportPage } from './components/PdfImportPage';
import { PublicSetlistPage } from './components/PublicSetlistPage';
import { RegistrationPage } from './components/RegistrationPage';
import { Setlists } from './components/Setlists';
import { Settings } from './components/Settings';
import { SongReader } from './components/SongReader';
import { UpdateBanner } from './components/UpdateBanner';
import { DiagnosticsPage } from './components/DiagnosticsPage';
import { catalogSchema, type Catalog } from './domain/song';
import { useConnectivity } from './hooks/useConnectivity';
import { useCloudUserState } from './hooks/useCloudUserState';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { useSecureAccount } from './hooks/useSecureAccount';
import { useUserProfile } from './hooks/useUserProfile';
import { useUserState } from './hooks/useUserState';
import { loadLatestCatalog } from './pwa/contentCache';
import { canonicalUrl, relativeRoute, routePath } from './pwa/paths';
import { activateWaitingUpdate, hasWaitingUpdate } from './pwa/updateManager';
import { addRecent, createUserProfile, isDownloadedLibrarySong, loadPersonalSongs, toggleFavorite, updateSetlistSongs } from './storage/database';
import type { PersonalLibrarySummary } from './personalLibrary';

type Route =
  | { name: 'library' }
  | { name: 'setlists' }
  | { name: 'settings' }
  | { name: 'admin' }
  | { name: 'import' }
  | { name: 'offline' }
  | { name: 'install' }
  | { name: 'help' }
  | { name: 'diagnostics' }
  | { name: 'song'; id: string }
  | { name: 'public-setlist'; id: string }
  | { name: 'not-found' };

const bundledCatalog = catalogSchema.parse(catalogJson as unknown);

function parseRoute(pathname = window.location.pathname): Route {
  const relative = relativeRoute(pathname);
  if (!relative) return { name: 'library' };
  if (relative === 'setlists') return { name: 'setlists' };
  if (relative === 'settings') return { name: 'settings' };
  if (relative === 'admin') return { name: 'admin' };
  if (relative === 'import') return { name: 'import' };
  if (relative === 'offline') return { name: 'offline' };
  if (relative === 'install') return { name: 'install' };
  if (relative === 'help') return { name: 'help' };
  if (relative === 'diagnostics' && import.meta.env.DEV) return { name: 'diagnostics' };
  const song = relative.match(/^songs\/([a-z0-9-]+)$/);
  if (song) return { name: 'song', id: song[1] };
  const setlist = relative.match(/^setlists\/([a-z0-9-]+)$/);
  if (setlist) return { name: 'public-setlist', id: setlist[1] };
  return { name: 'not-found' };
}

function routeRelativePath(route: Route): string {
  switch (route.name) {
    case 'library': return '';
    case 'song': return `songs/${route.id}`;
    case 'public-setlist': return `setlists/${route.id}`;
    case 'not-found': return relativeRoute(window.location.pathname);
    default: return route.name;
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [catalog, setCatalog] = useState<Catalog>(bundledCatalog);
  const [devPersonalSongs, setDevPersonalSongs] = useState<Catalog['songs']>([]);
  const [deviceSongs, setDeviceSongs] = useState<Catalog['songs']>([]);
  const [personalSummary, setPersonalSummary] = useState<PersonalLibrarySummary | null>(null);
  const [userState, setUserState, hydrated, storageError] = useUserState();
  const [userProfile, setUserProfile, profileHydrated, profileError] = useUserProfile();
  const secureAccount = useSecureAccount();
  const cloudSync = useCloudUserState(secureAccount.enabled, secureAccount.profile, hydrated, userState, setUserState);
  const [updateAvailable, setUpdateAvailable] = useState(hasWaitingUpdate);
  const [systemMessage, setSystemMessage] = useState('');
  const [readerSequence, setReaderSequence] = useState<string[]>([]);
  const libraryScroll = useRef(0);
  const online = useConnectivity();
  const installPrompt = useInstallPrompt();

  useEffect(() => {
    const serverProfile = secureAccount.profile;
    if (!secureAccount.enabled || serverProfile?.status !== 'approved') return;
    setUserProfile((current) => {
      const role = serverProfile.role === 'admin' ? 'admin' : 'member';
      if (current?.id === serverProfile.id && current.displayName === serverProfile.display_name && current.role === role) return current;
      const synchronized = createUserProfile(serverProfile.display_name, { id: serverProfile.id, role });
      return current?.id === serverProfile.id
        ? { ...synchronized, monochromeMode: role === 'admin' ? (current.role === 'admin' ? current.monochromeMode : true) : false, createdAt: current.createdAt }
        : synchronized;
    });
  }, [secureAccount.enabled, secureAccount.profile, setUserProfile]);
  const allSongs = useMemo(() => {
    const byId = new Map([...catalog.songs, ...devPersonalSongs, ...deviceSongs].map((song) => [song.id, song]));
    return [...byId.values()].sort((left, right) => left.sortTitle.localeCompare(right.sortTitle, 'cs'));
  }, [catalog.songs, devPersonalSongs, deviceSongs]);
  const downloadedLibrarySongs = useMemo(
    () => deviceSongs.filter(isDownloadedLibrarySong),
    [deviceSongs],
  );
  const selectedSong = useMemo(() => route.name === 'song' ? allSongs.find((song) => song.id === route.id) : undefined, [allSongs, route]);
  const selectedPublicSetlist = useMemo(() => route.name === 'public-setlist' ? catalog.publicSetlists.find((setlist) => setlist.id === route.id) : undefined, [catalog, route]);

  useEffect(() => {
    const popstate = () => setRoute(parseRoute());
    window.addEventListener('popstate', popstate);
    return () => window.removeEventListener('popstate', popstate);
  }, []);

  useEffect(() => {
    void loadLatestCatalog(bundledCatalog).then((latest) => {
      setCatalog(latest);
      const previous = localStorage.getItem('zpevnik-catalog-version');
      if (previous && previous !== latest.version) setSystemMessage(`Katalog byl aktualizován na verzi ${latest.version}; nyní obsahuje ${latest.songs.length} písní.`);
      localStorage.setItem('zpevnik-catalog-version', latest.version);
    });
  }, [online]);

  useEffect(() => {
    if (!systemMessage) return;
    const timer = window.setTimeout(() => setSystemMessage(''), 4500);
    return () => window.clearTimeout(timer);
  }, [systemMessage]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    void import('./personalLibrary')
      .then(({ loadPersonalLibrary }) => loadPersonalLibrary(controller.signal))
      .then((personal) => {
        setDevPersonalSongs(personal?.songs ?? []);
        setPersonalSummary(personal?.summary ?? null);
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setSystemMessage(error instanceof Error ? error.message : 'Osobní katalog se nepodařilo načíst.');
      });
    return () => controller.abort();
  }, []);

  const protectedContentOwnerId = secureAccount.enabled ? secureAccount.profile?.id : undefined;
  const refreshDeviceSongs = useCallback(async () => {
    setDeviceSongs(await loadPersonalSongs(protectedContentOwnerId));
  }, [protectedContentOwnerId]);

  useEffect(() => {
    if (secureAccount.enabled && !secureAccount.hydrated) return;
    loadPersonalSongs(protectedContentOwnerId)
      .then(setDeviceSongs)
      .catch(() => setSystemMessage('Písně uložené v tomto zařízení se nepodařilo načíst.'));
  }, [protectedContentOwnerId, secureAccount.enabled, secureAccount.hydrated]);

  useEffect(() => {
    const available = () => setUpdateAvailable(true);
    const offlineReady = () => setSystemMessage('Základ aplikace je uložený. Písně a noty stáhnete v Offline obsahu.');
    const updateError = (event: Event) => setSystemMessage(`Aktualizace se nezdařila: ${(event as CustomEvent<string>).detail || 'neznámá chyba'}`);
    window.addEventListener('zpevnik:update-available', available);
    window.addEventListener('zpevnik:offline-shell-ready', offlineReady);
    window.addEventListener('zpevnik:update-error', updateError);
    const waitingCheck = window.setTimeout(() => {
      if (hasWaitingUpdate()) setUpdateAvailable(true);
    }, 0);
    return () => {
      window.clearTimeout(waitingCheck);
      window.removeEventListener('zpevnik:update-available', available);
      window.removeEventListener('zpevnik:offline-shell-ready', offlineReady);
      window.removeEventListener('zpevnik:update-error', updateError);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const monochrome = userProfile?.role === 'admin' && userProfile.monochromeMode;
      const dark = userState.settings.theme === 'dark' || (userState.settings.theme === 'system' && media.matches);
      root.dataset.theme = monochrome ? 'monochrome' : dark ? 'dark' : 'light';
      root.style.colorScheme = monochrome || dark ? 'dark' : 'light';
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [userProfile?.monochromeMode, userProfile?.role, userState.settings.theme]);

  useEffect(() => {
    document.body.dataset.printSize = userState.settings.printSize;
  }, [userState.settings.printSize]);

  useEffect(() => {
    const relative = routeRelativePath(route);
    const canonical = canonicalUrl(relative);
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', canonical);
    const label = route.name === 'song' ? selectedSong?.title : route.name === 'public-setlist' ? selectedPublicSetlist?.title : ({ library: 'Písně', setlists: 'Setlisty', import: 'Import PDF', settings: 'Nastavení', admin: 'Administrace', offline: 'Offline obsah', install: 'Instalace', help: 'Nápověda', diagnostics: 'Diagnostika', 'not-found': 'Nenalezeno' } as const)[route.name];
    document.title = label ? `${label} · Český zpěvník` : 'Český digitální zpěvník';
    if (route.name === 'library') requestAnimationFrame(() => window.scrollTo({ top: libraryScroll.current }));
    else window.scrollTo({ top: 0 });
  }, [route, selectedPublicSetlist?.title, selectedSong?.title]);

  const navigate = (relative: string, replace = false) => {
    const destination = routePath(relative);
    if (replace) history.replaceState({}, '', destination);
    else history.pushState({}, '', destination);
    setRoute(parseRoute(destination));
  };

  const openSong = (id: string, sequence: string[] = []) => {
    if (route.name === 'library') libraryScroll.current = window.scrollY;
    setReaderSequence(sequence);
    navigate(`songs/${id}`);
    setUserState((current) => addRecent(current, id));
  };

  const readerIndex = selectedSong ? readerSequence.indexOf(selectedSong.id) : -1;
  const previousReaderSong = readerIndex > 0 ? allSongs.find((song) => song.id === readerSequence[readerIndex - 1]) : undefined;
  const nextReaderSong = readerIndex >= 0 && readerIndex < readerSequence.length - 1 ? allSongs.find((song) => song.id === readerSequence[readerIndex + 1]) : undefined;
  const openReaderSibling = (song: Catalog['songs'][number]) => {
    navigate(`songs/${song.id}`);
    setUserState((current) => addRecent(current, song.id));
  };

  const navScreen = route.name === 'library' || route.name === 'setlists' || route.name === 'import' || route.name === 'settings' || route.name === 'offline' ? route.name : null;

  if (!hydrated || !profileHydrated || (secureAccount.enabled && !secureAccount.hydrated)) return <main className="loading-screen"><span className="brand-mark" aria-hidden="true">♫</span><p>Otevírám zpěvník…</p></main>;

  if (secureAccount.required && !secureAccount.enabled) return <main className="app-main"><section className="registration-page"><div className="registration-card"><p className="eyebrow">Soukromý režim</p><h1>Server není připojený</h1><p className="lead">{secureAccount.error}</p><small>Žádné soukromé písně nebyly načteny. Tuto konfiguraci musí dokončit administrátor.</small></div></section></main>;

  if (secureAccount.enabled && secureAccount.passwordRecovery) return <PasswordRecoveryPage onComplete={secureAccount.finishPasswordRecovery} />;

  if (secureAccount.enabled && secureAccount.authState.status === 'offline-access-expired') return <main className="app-main"><section className="registration-page"><div className="registration-card"><p className="eyebrow">Offline oprávnění vypršelo</p><h1>Krátce se připojte k internetu</h1><p className="lead">Stažená data jsme nesmazali, ale před dalším otevřením chráněných písní musí server obnovit oprávnění tohoto zařízení.</p><button type="button" className="primary-button" onClick={() => void secureAccount.refresh()}>Ověřit přístup</button></div></section>{secureAccount.error && <p className="global-warning" role="alert">{secureAccount.error}</p>}</main>;

  if (secureAccount.enabled && secureAccount.authState.status === 'unauthenticated') return <main className="app-main"><AccountAccessPage canInstall={installPrompt.canPrompt} installed={installPrompt.installed} onInstall={installPrompt.install} />{secureAccount.error && <p className="global-warning" role="alert">{secureAccount.error}</p>}</main>;

  if (secureAccount.enabled && secureAccount.authState.status === 'authenticated-online' && !secureAccount.profile) return <main className="app-main"><section className="registration-page"><div className="registration-card"><p className="eyebrow">Ověření účtu</p><h1>Profil se nepodařilo načíst</h1><p className="lead">{secureAccount.error ?? 'Zkuste stav účtu načíst znovu.'}</p><button type="button" className="primary-button" onClick={() => void secureAccount.refresh()}>Načíst znovu</button></div></section></main>;

  if (secureAccount.enabled && secureAccount.profile && secureAccount.profile.status !== 'approved') return <ApprovalGate profile={secureAccount.profile} onRefresh={secureAccount.refresh} />;

  if (!userProfile) return <main className="app-main"><RegistrationPage canInstall={installPrompt.canPrompt} installed={installPrompt.installed} onInstall={installPrompt.install} onRegister={setUserProfile} />{(storageError || profileError) && <p className="global-warning" role="alert">{storageError || profileError}</p>}</main>;

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" type="button" onClick={() => navigate('')} aria-label="Přejít na seznam písní"><span className="brand-mark" aria-hidden="true">♫</span><span><strong>Český zpěvník</strong><small>odkaz · PWA · offline</small></span></button>
        <div className="header-status"><button type="button" className={`sync-badge sync-badge--${cloudSync.status}`} onClick={() => navigate('settings')} aria-label="Otevřít stav synchronizace"><span aria-hidden="true">↻</span><span>{cloudSync.status === 'synced' ? 'Uloženo' : cloudSync.status === 'syncing' || cloudSync.status === 'loading' ? 'Ukládám' : cloudSync.status === 'error' ? 'Chyba' : cloudSync.status === 'offline' ? 'Čeká' : 'Místně'}</span></button><button type="button" className={`connection-badge ${online ? 'online' : 'offline'}`} onClick={() => navigate('offline')} aria-label={`${online ? 'Online' : 'Offline'}; otevřít stav offline obsahu`}><span aria-hidden="true" />{online ? 'Online' : 'Offline'}</button></div>
      </header>
      {secureAccount.authState.status === 'authenticated-offline' && <aside className="offline-auth-banner" role="status"><strong>Offline režim</strong><span>Oprávnění platí do {new Date(secureAccount.authState.offlineValidUntil).toLocaleDateString('cs-CZ')} · obsah {secureAccount.authState.contentVersion.slice(0, 12)}</span></aside>}
      {updateAvailable && <UpdateBanner onUpdate={() => void activateWaitingUpdate()} onLater={() => setUpdateAvailable(false)} />}
      {(storageError || profileError) && <p className="global-warning" role="alert">{storageError || profileError}</p>}
      {systemMessage && <div className="system-message toast-message" role="status"><span>{systemMessage}</span><button type="button" aria-label="Zavřít zprávu" onClick={() => setSystemMessage('')}>×</button></div>}
      <main id="main-content" className="app-main">
        {route.name === 'library' && <Library songs={allSongs} personalSummary={personalSummary} deviceSongCount={deviceSongs.length} favorites={userState.favorites} recent={userState.recentSongIds} setlistCount={userState.setlists.length} setlists={userState.setlists} onOpenSong={(id) => openSong(id)} onNavigate={navigate} onToggleFavorite={(id) => setUserState((current) => toggleFavorite(current, id))} onAddToSetlist={(songId, setlistId) => setUserState((current) => { const setlist = current.setlists.find((candidate) => candidate.id === setlistId); return !setlist || setlist.songIds.includes(songId) ? current : updateSetlistSongs(current, setlistId, [...setlist.songIds, songId]); })} onNotify={setSystemMessage} />}
        {route.name === 'setlists' && <Setlists songs={allSongs} publicSetlists={catalog.publicSetlists} catalogVersion={catalog.version} userState={userState} onUserStateChange={setUserState} onOpenSong={openSong} onOpenPublicSetlist={(id) => navigate(`setlists/${id}`)} />}
        {route.name === 'import' && <PdfImportPage allSongs={allSongs} deviceSongs={deviceSongs} defaultNotation={userState.settings.notation} onLibraryChanged={refreshDeviceSongs} onOpenSong={openSong} userProfile={userProfile} secureProfile={secureAccount.profile} secureMode={secureAccount.enabled} />}
        {route.name === 'settings' && <Settings userState={userState} userProfile={userProfile} secureProfile={secureAccount.profile} secureMode={secureAccount.enabled} cloudSync={cloudSync} personalSongs={allSongs.filter((song) => song.personalOnly)} onUserStateChange={setUserState} onUserProfileChange={setUserProfile} onPersonalLibraryChanged={refreshDeviceSongs} onNavigate={navigate} onRefreshSecureProfile={secureAccount.refresh} />}
        {route.name === 'admin' && secureAccount.enabled && secureAccount.profile?.role === 'admin' && <AdminPage cloudSync={cloudSync} online={online} onNavigate={navigate} />}
        {route.name === 'offline' && <OfflineContent catalog={catalog} secureProfile={secureAccount.profile} secureMode={secureAccount.enabled} offlineGrant={secureAccount.offlineGrant} downloadedLibrarySongs={downloadedLibrarySongs} onPersonalLibraryChanged={refreshDeviceSongs} onNavigate={navigate} />}
        {route.name === 'install' && <InstallPage canPrompt={installPrompt.canPrompt} installed={installPrompt.installed} isIosLike={installPrompt.isIosLike} onInstall={installPrompt.install} onNavigate={navigate} />}
        {route.name === 'help' && <HelpPage onNavigate={navigate} />}
        {route.name === 'diagnostics' && import.meta.env.DEV && <DiagnosticsPage onBack={() => navigate('settings')} />}
        {route.name === 'song' && selectedSong && <SongReader key={selectedSong.id} song={selectedSong} catalogVersion={catalog.version} userState={userState} onUserStateChange={setUserState} onBack={() => navigate(readerSequence.length ? 'setlists' : '')} previousSong={previousReaderSong} nextSong={nextReaderSong} onPreviousSong={previousReaderSong ? () => openReaderSibling(previousReaderSong) : undefined} onNextSong={nextReaderSong ? () => openReaderSibling(nextReaderSong) : undefined} />}
        {route.name === 'public-setlist' && selectedPublicSetlist && <PublicSetlistPage setlist={selectedPublicSetlist} songs={catalog.songs} onOpenSong={(id) => openSong(id, selectedPublicSetlist.songIds)} onBack={() => navigate('setlists')} />}
        {((route.name === 'song' && !selectedSong) || (route.name === 'public-setlist' && !selectedPublicSetlist) || (route.name === 'admin' && (!secureAccount.enabled || secureAccount.profile?.role !== 'admin')) || route.name === 'not-found') && <section className="info-page not-found"><p className="eyebrow">404</p><h1>Tato stránka ve zpěvníku není</h1><p>Odkaz může být starý nebo chybný.</p><button type="button" className="primary-button" onClick={() => navigate('')}>Přejít na písně</button></section>}
      </main>
      {route.name !== 'song' && <nav className="bottom-nav bottom-nav--five" aria-label="Hlavní navigace">
        <button type="button" className={navScreen === 'library' ? 'active' : ''} aria-current={navScreen === 'library' ? 'page' : undefined} onClick={() => navigate('')}><span aria-hidden="true">⌕</span>Písně</button>
        <button type="button" className={navScreen === 'setlists' ? 'active' : ''} aria-current={navScreen === 'setlists' ? 'page' : undefined} onClick={() => navigate('setlists')}><span aria-hidden="true">☷</span>Setlisty</button>
        <button type="button" className={navScreen === 'import' ? 'active' : ''} aria-current={navScreen === 'import' ? 'page' : undefined} onClick={() => navigate('import')}><span aria-hidden="true">＋</span>Přidat</button>
        <button type="button" className={navScreen === 'offline' ? 'active' : ''} aria-current={navScreen === 'offline' ? 'page' : undefined} onClick={() => navigate('offline')}><span aria-hidden="true">⇩</span>Offline</button>
        <button type="button" className={navScreen === 'settings' ? 'active' : ''} aria-current={navScreen === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><span aria-hidden="true">⚙</span>Nastavení</button>
      </nav>}
    </div>
  );
}
