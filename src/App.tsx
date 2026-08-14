import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import catalogJson from './generated/catalog.json';
import { AccountAccessPage } from './components/AccountAccessPage';
import { ApprovalGate } from './components/ApprovalGate';
import { HomeDashboard } from './components/HomeDashboard';
import { Library, type LibraryEntry } from './components/Library';
import { PasswordRecoveryPage } from './components/PasswordRecoveryPage';
import { RegistrationPage } from './components/RegistrationPage';
import { UpdateBanner } from './components/UpdateBanner';
import { FirstRunGuide } from './components/FirstRunGuide';
import { AppStatusCenter } from './components/AppStatusCenter';
import { LiveSetlistFollower } from './components/LiveSetlistFollower';
import { GuitarNeckLoader } from './components/GuitarNeckLoader';
import { hasCompletedFirstRunGuide } from './components/firstRunState';
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
import { addRecent, createSetlist, createUserProfile, isDownloadedLibrarySong, loadPersonalSongs, recordDiagnostic, removePersonalSong, removeProtectedSong, toggleFavorite, updateSetlistSongs } from './storage/database';
import type { PersonalLibrarySummary } from './personalLibrary';
import { routeMotionDirection, runRouteTransition, scrollWindowInstantly } from './ui/motion';
import { Icon } from './ui/Icon';
import { friendlyError } from './ui/friendlyError';
import { haptic } from './ui/haptics';

const loadAdminPage = () => import('./components/AdminPage');
const loadDiagnosticsPage = () => import('./components/DiagnosticsPage');
const loadHelpPage = () => import('./components/HelpPage');
const loadInstallPage = () => import('./components/InstallPage');
const loadOfflineContent = () => import('./components/OfflineContent');
const loadPdfImportPage = () => import('./components/PdfImportPage');
const loadPublicSetlistPage = () => import('./components/PublicSetlistPage');
const loadSetlists = () => import('./components/Setlists');
const loadSettings = () => import('./components/Settings');
const loadSongReader = () => import('./components/SongReader');

const AdminPage = lazy(() => loadAdminPage().then((module) => ({ default: module.AdminPage })));
const DiagnosticsPage = lazy(() => loadDiagnosticsPage().then((module) => ({ default: module.DiagnosticsPage })));
const HelpPage = lazy(() => loadHelpPage().then((module) => ({ default: module.HelpPage })));
const InstallPage = lazy(() => loadInstallPage().then((module) => ({ default: module.InstallPage })));
const OfflineContent = lazy(() => loadOfflineContent().then((module) => ({ default: module.OfflineContent })));
const PdfImportPage = lazy(() => loadPdfImportPage().then((module) => ({ default: module.PdfImportPage })));
const PublicSetlistPage = lazy(() => loadPublicSetlistPage().then((module) => ({ default: module.PublicSetlistPage })));
const Setlists = lazy(() => loadSetlists().then((module) => ({ default: module.Setlists })));
const Settings = lazy(() => loadSettings().then((module) => ({ default: module.Settings })));
const SongReader = lazy(() => loadSongReader().then((module) => ({ default: module.SongReader })));

function RouteLoading({ routeName }: { routeName: Route['name'] }) {
  return <section className={`route-loading route-loading--${routeName}`} role="status" aria-label="Načítám stránku" aria-busy="true"><span className="sr-only">Připravuji stránku…</span><span className="route-loading__skeleton route-loading__skeleton--title" /><span className="route-loading__skeleton route-loading__skeleton--panel" /><span className="route-loading__grid" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span></section>;
}

type Route =
  | { name: 'home' }
  | { name: 'library'; entry: LibraryEntry }
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

interface SystemNotice {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

function preloadRouteModule(name: Route['name']): Promise<unknown> | null {
  switch (name) {
    case 'admin': return loadAdminPage();
    case 'diagnostics': return loadDiagnosticsPage();
    case 'help': return loadHelpPage();
    case 'install': return loadInstallPage();
    case 'offline': return loadOfflineContent();
    case 'import': return loadPdfImportPage();
    case 'public-setlist': return loadPublicSetlistPage();
    case 'setlists': return loadSetlists();
    case 'settings': return loadSettings();
    case 'song': return loadSongReader();
    default: return null;
  }
}

function routeScrollKey(route: Route): string | null {
  if (route.name === 'library') return `library:${route.entry}`;
  return ['setlists', 'offline', 'admin'].includes(route.name) ? route.name : null;
}

const bundledCatalog = catalogSchema.parse(catalogJson as unknown);

function parseRoute(pathname = window.location.pathname): Route {
  const relative = relativeRoute(pathname);
  if (!relative) return { name: 'home' };
  if (relative === 'songs') return { name: 'library', entry: 'all' };
  if (relative === 'songs/favorites') return { name: 'library', entry: 'favorites' };
  if (relative === 'songs/artists') return { name: 'library', entry: 'artists' };
  if (relative === 'setlists') return { name: 'setlists' };
  if (relative === 'settings') return { name: 'settings' };
  if (relative === 'admin') return { name: 'admin' };
  if (relative === 'import') return { name: 'import' };
  if (relative === 'offline') return { name: 'offline' };
  if (relative === 'install') return { name: 'install' };
  if (relative === 'help') return { name: 'help' };
  if (relative === 'diagnostics') return { name: 'diagnostics' };
  const song = relative.match(/^songs\/([a-z0-9-]+)$/);
  if (song) return { name: 'song', id: song[1] };
  const setlist = relative.match(/^setlists\/([a-z0-9-]+)$/);
  if (setlist) return { name: 'public-setlist', id: setlist[1] };
  return { name: 'not-found' };
}

function routeRelativePath(route: Route): string {
  switch (route.name) {
    case 'home': return '';
    case 'library': return route.entry === 'all' ? 'songs' : `songs/${route.entry}`;
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
  const cloudSync = useCloudUserState(
    secureAccount.enabled && secureAccount.authState.status === 'authenticated-online',
    secureAccount.profile,
    hydrated,
    userState,
    setUserState,
  );
  const [updateAvailable, setUpdateAvailable] = useState(hasWaitingUpdate);
  const [systemNotice, setSystemNotice] = useState<SystemNotice | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const setSystemMessage = useCallback((message: string) => {
    setSystemNotice(message ? { id: Date.now(), message } : null);
  }, []);
  const showSystemNotice = useCallback((message: string, actionLabel?: string, onAction?: () => void) => {
    setSystemNotice({ id: Date.now(), message, actionLabel, onAction });
  }, []);
  const [readerSequence, setReaderSequence] = useState<string[]>([]);
  const [firstRunOpen, setFirstRunOpen] = useState(false);
  const [statusCenterOpen, setStatusCenterOpen] = useState(false);
  const [welcomeCompleteFor, setWelcomeCompleteFor] = useState<string | null>(null);
  const [followedLiveSetlistId, setFollowedLiveSetlistId] = useState(() => {
    try { return localStorage.getItem('zpevnik-follow-live-setlist-v1') ?? ''; } catch { return ''; }
  });
  const routeScrollPositions = useRef<Record<string, number>>({});
  const navigationIntent = useRef(0);
  const online = useConnectivity();
  const installPrompt = useInstallPrompt();
  const accountReady = Boolean(userProfile) && (!secureAccount.enabled || (
    (secureAccount.authState.status === 'authenticated-online' || secureAccount.authState.status === 'authenticated-offline')
    && secureAccount.profile?.status === 'approved'
  ));

  useEffect(() => {
    if (!accountReady || !userProfile || welcomeCompleteFor === userProfile.id) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = import.meta.env.MODE === 'e2e' ? 0 : reduced ? 320 : 1_150;
    const timer = window.setTimeout(() => setWelcomeCompleteFor(userProfile.id), duration);
    return () => window.clearTimeout(timer);
  }, [accountReady, userProfile, welcomeCompleteFor]);

  useEffect(() => {
    history.scrollRestoration = 'manual';
    return () => { history.scrollRestoration = 'auto'; };
  }, []);

  useEffect(() => {
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const prefetch = () => {
      const loaders: Promise<unknown>[] = [loadOfflineContent(), loadPdfImportPage(), loadSetlists(), loadSettings(), loadSongReader()];
      if (secureAccount.profile?.role === 'admin') loaders.push(loadAdminPage());
      void Promise.allSettled(loaders);
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(prefetch, { timeout: 1800 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(prefetch, 900);
    return () => window.clearTimeout(handle);
  }, [secureAccount.profile?.role]);

  useEffect(() => {
    if (import.meta.env.MODE === 'e2e' || !userProfile || hasCompletedFirstRunGuide(userProfile.id)) return;
    const timer = window.setTimeout(() => setFirstRunOpen(true), 450);
    return () => window.clearTimeout(timer);
  }, [userProfile]);

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
    const popstate = () => {
      const target = parseRoute();
      const currentKey = routeScrollKey(route);
      if (currentKey) routeScrollPositions.current[currentKey] = window.scrollY;
      const intent = ++navigationIntent.current;
      let pendingTimer: number | null = null;
      const commit = () => {
        if (intent !== navigationIntent.current) return;
        if (pendingTimer !== null) window.clearTimeout(pendingTimer);
        setNavigationPending(false);
        runRouteTransition(() => flushSync(() => setRoute(target)), routeMotionDirection(route.name, target.name));
      };
      const preload = preloadRouteModule(target.name);
      if (preload) {
        pendingTimer = window.setTimeout(() => {
          if (intent === navigationIntent.current) setNavigationPending(true);
        }, 140);
        void preload.then(commit, commit);
      }
      else commit();
    };
    window.addEventListener('popstate', popstate);
    return () => window.removeEventListener('popstate', popstate);
  }, [route]);

  useEffect(() => {
    void loadLatestCatalog(bundledCatalog).then((latest) => {
      setCatalog(latest);
      const previous = localStorage.getItem('zpevnik-catalog-version');
      if (previous && previous !== latest.version) setSystemMessage(`Katalog byl aktualizován na verzi ${latest.version}; nyní obsahuje ${latest.songs.length} písní.`);
      localStorage.setItem('zpevnik-catalog-version', latest.version);
    });
  }, [online, setSystemMessage]);

  useEffect(() => {
    if (!systemNotice) return;
    const timer = window.setTimeout(() => setSystemNotice(null), systemNotice.onAction ? 6500 : 4500);
    return () => window.clearTimeout(timer);
  }, [systemNotice]);

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
  }, [setSystemMessage]);

  const protectedContentOwnerId = secureAccount.enabled ? secureAccount.profile?.id : undefined;
  const refreshDeviceSongs = useCallback(async () => {
    setDeviceSongs(await loadPersonalSongs(protectedContentOwnerId));
  }, [protectedContentOwnerId]);

  useEffect(() => {
    if (secureAccount.enabled && !secureAccount.hydrated) return;
    loadPersonalSongs(protectedContentOwnerId)
      .then(setDeviceSongs)
      .catch(() => setSystemMessage('Písně uložené v tomto zařízení se nepodařilo načíst.'));
  }, [protectedContentOwnerId, secureAccount.enabled, secureAccount.hydrated, setSystemMessage]);

  useEffect(() => {
    const available = () => {
      setUpdateAvailable(true);
      void recordDiagnostic({ category: 'pwa', event: 'update_available', level: 'info' }).catch(() => undefined);
    };
    const offlineReady = () => {
      setSystemMessage('Základ aplikace je uložený. Písně a noty stáhnete v Offline obsahu.');
      void recordDiagnostic({ category: 'pwa', event: 'offline_shell_ready', level: 'info' }).catch(() => undefined);
    };
    const updateError = (event: Event) => {
      setSystemMessage(friendlyError((event as CustomEvent<string>).detail, 'Aktualizace se nezdařila. Zkuste ji spustit znovu v Offline obsahu.'));
      void recordDiagnostic({ category: 'pwa', event: 'update_failed', level: 'error' }).catch(() => undefined);
    };
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
  }, [setSystemMessage]);

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
    document.documentElement.dataset.motion = userState.settings.motion;
  }, [userState.settings.motion]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.contrast = userState.settings.accessibility.highContrast ? 'high' : 'normal';
    root.dataset.controls = userState.settings.accessibility.largeControls ? 'large' : 'standard';
    root.dataset.oneHanded = userState.settings.accessibility.oneHanded ? 'true' : 'false';
  }, [userState.settings.accessibility]);

  useEffect(() => {
    document.body.dataset.printSize = userState.settings.printSize;
  }, [userState.settings.printSize]);

  useEffect(() => {
    try {
      if (followedLiveSetlistId) localStorage.setItem('zpevnik-follow-live-setlist-v1', followedLiveSetlistId);
      else localStorage.removeItem('zpevnik-follow-live-setlist-v1');
    } catch { /* Sledování zůstane aktivní alespoň do zavření aplikace. */ }
  }, [followedLiveSetlistId]);

  useEffect(() => {
    const relative = routeRelativePath(route);
    const canonical = canonicalUrl(relative);
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', canonical);
    const label = route.name === 'song' ? selectedSong?.title : route.name === 'public-setlist' ? selectedPublicSetlist?.title : ({ home: 'Úvod', library: 'Písně', setlists: 'Setlisty', import: 'Import PDF', settings: 'Nastavení', admin: 'Administrace', offline: 'Offline obsah', install: 'Instalace', help: 'Nápověda', diagnostics: 'Diagnostika', 'not-found': 'Nenalezeno' } as const)[route.name];
    document.title = label ? `${label} · Český zpěvník` : 'Český digitální zpěvník';
  }, [route, selectedPublicSetlist?.title, selectedSong?.title]);

  useLayoutEffect(() => {
    const key = routeScrollKey(route);
    scrollWindowInstantly(key ? (routeScrollPositions.current[key] ?? 0) : 0);
    const heading = document.querySelector<HTMLElement>('.route-stage h1');
    if (heading) {
      const hadTabIndex = heading.hasAttribute('tabindex');
      if (!hadTabIndex) heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      if (!hadTabIndex) heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
    }
  }, [route]);

  const navigate = (relative: string, replace = false, sharedSource?: HTMLElement | null, sharedTargetSelector = '[data-view-transition-target="song-title"]', sharedName = 'shared-song-title') => {
    const destination = routePath(relative);
    const target = parseRoute(destination);
    const currentKey = routeScrollKey(route);
    if (currentKey) routeScrollPositions.current[currentKey] = window.scrollY;
    const intent = ++navigationIntent.current;
    let pendingTimer: number | null = null;
    const commit = () => {
      if (intent !== navigationIntent.current) return;
      if (pendingTimer !== null) window.clearTimeout(pendingTimer);
      setNavigationPending(false);
      runRouteTransition(() => flushSync(() => {
        if (replace) history.replaceState({}, '', destination);
        else history.pushState({}, '', destination);
        setRoute(target);
      }), routeMotionDirection(route.name, target.name), sharedSource ? {
        source: sharedSource,
        targetSelector: sharedTargetSelector,
        name: sharedName,
      } : undefined);
    };
    const preload = preloadRouteModule(target.name);
    if (preload) {
      pendingTimer = window.setTimeout(() => {
        if (intent === navigationIntent.current) setNavigationPending(true);
      }, 140);
      void preload.then(commit, commit);
    }
    else commit();
  };

  const openSong = (id: string, sequence: string[] = [], sharedSource?: HTMLElement | null) => {
    setReaderSequence(sequence);
    navigate(`songs/${id}`, false, sharedSource);
    setUserState((current) => addRecent(current, id));
  };

  const readerIndex = selectedSong ? readerSequence.indexOf(selectedSong.id) : -1;
  const previousReaderSong = readerIndex > 0 ? allSongs.find((song) => song.id === readerSequence[readerIndex - 1]) : undefined;
  const nextReaderSong = readerIndex >= 0 && readerIndex < readerSequence.length - 1 ? allSongs.find((song) => song.id === readerSequence[readerIndex + 1]) : undefined;
  const openReaderSibling = (song: Catalog['songs'][number]) => {
    navigate(`songs/${song.id}`);
    setUserState((current) => addRecent(current, song.id));
  };

  const addToTonightSetlist = (songId: string) => {
    const existing = userState.setlists.find((setlist) => setlist.name.toLocaleLowerCase('cs') === 'dnešní setlist');
    if (existing?.songIds.includes(songId)) {
      setSystemMessage('Píseň už v dnešním setlistu je.');
      return;
    }
    setUserState((current) => {
      const existing = current.setlists.find((setlist) => setlist.name.toLocaleLowerCase('cs') === 'dnešní setlist');
      const withSetlist = existing ? current : createSetlist(current, 'Dnešní setlist');
      const tonight = existing ?? withSetlist.setlists.find((setlist) => setlist.name === 'Dnešní setlist');
      return !tonight || tonight.songIds.includes(songId) ? withSetlist : updateSetlistSongs(withSetlist, tonight.id, [...tonight.songIds, songId]);
    });
    showSystemNotice('Píseň byla přidána do dnešního setlistu.', 'Vrátit zpět', () => {
      setUserState((current) => {
        const tonight = current.setlists.find((setlist) => setlist.name.toLocaleLowerCase('cs') === 'dnešní setlist');
        return !tonight ? current : updateSetlistSongs(current, tonight.id, tonight.songIds.filter((id) => id !== songId));
      });
      setSystemMessage('Píseň byla z dnešního setlistu odebrána.');
    });
  };

  const addSongToSetlist = (songId: string, setlistId: string) => {
    const target = userState.setlists.find((setlist) => setlist.id === setlistId);
    if (!target || target.songIds.includes(songId)) return;
    setUserState((current) => {
      const setlist = current.setlists.find((candidate) => candidate.id === setlistId);
      return !setlist || setlist.songIds.includes(songId) ? current : updateSetlistSongs(current, setlistId, [...setlist.songIds, songId]);
    });
    showSystemNotice(`Píseň byla přidána do setlistu „${target.name}“.`, 'Vrátit zpět', () => {
      setUserState((current) => {
        const setlist = current.setlists.find((candidate) => candidate.id === setlistId);
        return !setlist ? current : updateSetlistSongs(current, setlistId, setlist.songIds.filter((id) => id !== songId));
      });
      setSystemMessage('Přidání písně do setlistu bylo vráceno.');
    });
  };

  const deleteDeviceSong = async (songId: string) => {
    const song = deviceSongs.find((candidate) => candidate.id === songId);
    if (!song) throw new Error('Píseň není uložená v tomto zařízení.');
    if (protectedContentOwnerId && isDownloadedLibrarySong(song)) await removeProtectedSong(protectedContentOwnerId, songId);
    else await removePersonalSong(songId);
    await refreshDeviceSongs();
  };

  const navScreen = route.name === 'library' || route.name === 'setlists' || route.name === 'import' || route.name === 'settings' || route.name === 'offline' ? route.name : null;
  if (!hydrated || !profileHydrated || (secureAccount.enabled && !secureAccount.hydrated)) return <GuitarNeckLoader message="Otevírám zpěvník…" />;

  if (secureAccount.required && !secureAccount.enabled) return <main className="app-main"><section className="registration-page"><div className="registration-card"><p className="eyebrow">Soukromý režim</p><h1>Server není připojený</h1><p className="lead">{friendlyError(secureAccount.error, 'Připojení soukromého serveru není dokončené.')}</p><small>Žádné soukromé písně nebyly načteny. Tuto konfiguraci musí dokončit administrátor.</small></div></section></main>;

  if (secureAccount.enabled && secureAccount.passwordRecovery) return <PasswordRecoveryPage onComplete={secureAccount.finishPasswordRecovery} />;

  if (secureAccount.enabled && secureAccount.authState.status === 'offline-access-expired') return <main className="app-main"><section className="registration-page"><div className="registration-card"><p className="eyebrow">Offline oprávnění vypršelo</p><h1>Krátce se připojte k internetu</h1><p className="lead">Stažená data jsme nesmazali, ale před dalším otevřením chráněných písní musí server obnovit oprávnění tohoto zařízení.</p><button type="button" className="primary-button" onClick={() => void secureAccount.refresh()}>Ověřit přístup</button></div></section>{secureAccount.error && <p className="global-warning" role="alert">{secureAccount.error}</p>}</main>;

  if (secureAccount.enabled && secureAccount.authState.status === 'unauthenticated') return <main className="app-main"><AccountAccessPage canInstall={installPrompt.canPrompt} installed={installPrompt.installed} onInstall={installPrompt.install} />{secureAccount.error && <p className="global-warning" role="alert">{friendlyError(secureAccount.error)}</p>}</main>;

  if (secureAccount.enabled && secureAccount.authState.status === 'authenticated-online' && !secureAccount.profile) return <main className="app-main"><section className="registration-page"><div className="registration-card"><p className="eyebrow">Ověření účtu</p><h1>Profil se nepodařilo načíst</h1><p className="lead">{secureAccount.error ?? 'Zkuste stav účtu načíst znovu.'}</p><button type="button" className="primary-button" onClick={() => void secureAccount.refresh()}>Načíst znovu</button></div></section></main>;

  if (secureAccount.enabled && secureAccount.profile && secureAccount.profile.status !== 'approved') return <ApprovalGate profile={secureAccount.profile} onRefresh={secureAccount.refresh} />;

  if (!userProfile) return <main className="app-main"><RegistrationPage canInstall={installPrompt.canPrompt} installed={installPrompt.installed} onInstall={installPrompt.install} onRegister={setUserProfile} />{(storageError || profileError) && <p className="global-warning" role="alert">{storageError || profileError}</p>}</main>;

  if (accountReady && welcomeCompleteFor !== userProfile.id) return <GuitarNeckLoader message={`Vítejte, ${userProfile.displayName}`} />;

  return (
    <div className={`app-shell ${route.name === 'home' ? 'app-shell--home' : ''}`}>
      <div className={`navigation-progress${navigationPending ? ' navigation-progress--active' : ''}`} role="status" aria-live="polite" aria-label={navigationPending ? 'Načítám další obrazovku' : undefined}><span aria-hidden="true" /></div>
      {route.name !== 'home' && <header className="app-header">
        <button className="brand" type="button" onClick={() => navigate('')} aria-label="Přejít na úvodní stránku"><span className="brand-mark" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}icons/icon-lazec-192.png`} alt="" /></span><span><strong>Český zpěvník</strong><small>odkaz · PWA · offline</small></span></button>
        <div className="header-status"><button type="button" className={`sync-badge sync-badge--${cloudSync.status}`} onClick={() => setStatusCenterOpen(true)} aria-label="Otevřít stav zpěvníku"><Icon name="sync" size={17} /><span>{cloudSync.status === 'synced' ? 'Uloženo' : cloudSync.status === 'syncing' || cloudSync.status === 'loading' ? 'Ukládám' : cloudSync.status === 'error' ? 'Chyba' : cloudSync.status === 'offline' ? 'Čeká' : 'Místně'}</span></button><button type="button" className={`connection-badge ${online ? 'online' : 'offline'}`} onClick={() => setStatusCenterOpen(true)} aria-label={`${online ? 'Online' : 'Offline'}; otevřít stav zpěvníku`}><span aria-hidden="true" />{online ? 'Online' : 'Offline'}</button></div>
      </header>}
      {route.name !== 'home' && secureAccount.authState.status === 'authenticated-offline' && <aside className="offline-auth-banner" role="status"><strong>Offline režim</strong><span>Oprávnění platí do {new Date(secureAccount.authState.offlineValidUntil).toLocaleDateString('cs-CZ')} · obsah {secureAccount.authState.contentVersion.slice(0, 12)}</span></aside>}
      {route.name !== 'home' && updateAvailable && <UpdateBanner onUpdate={activateWaitingUpdate} onLater={() => setUpdateAvailable(false)} />}
      {route.name !== 'home' && (storageError || profileError) && <p className="global-warning" role="alert">{storageError || profileError}</p>}
      {route.name !== 'home' && systemNotice && <div className={`system-message toast-message${systemNotice.onAction ? ' toast-message--action' : ''}`} role="status" key={systemNotice.id}><Icon name="check" size={20} /><span>{systemNotice.message}</span><div className="toast-actions">{systemNotice.actionLabel && systemNotice.onAction && <button type="button" className="toast-undo" onClick={() => { const action = systemNotice.onAction; setSystemNotice(null); if (action) action(); }}>{systemNotice.actionLabel}</button>}<button type="button" aria-label="Zavřít zprávu" onClick={() => setSystemNotice(null)}><Icon name="close" size={19} /></button></div><i className="toast-life" aria-hidden="true" /></div>}
      <main id="main-content" className={`app-main ${route.name === 'home' ? 'app-main--home' : ''}`}>
        <div className="route-stage" key={routeRelativePath(route) || 'home'}><Suspense fallback={<RouteLoading routeName={route.name} />}>
        {route.name === 'home' && <HomeDashboard songs={allSongs} favorites={userState.favorites} recent={userState.recentSongIds} setlistCount={userState.setlists.length} onOpenSong={(id) => openSong(id)} onNavigate={navigate} />}
        {route.name === 'library' && <Library entry={route.entry} songs={allSongs} personalSummary={personalSummary} deviceSongCount={deviceSongs.length} favorites={userState.favorites} recent={userState.recentSongIds} setlists={userState.setlists} density={userState.settings.catalogDensity} onDensityChange={(catalogDensity) => setUserState((current) => ({ ...current, settings: { ...current.settings, catalogDensity } }))} onOpenSong={(id, source) => openSong(id, [], source)} onToggleFavorite={(id) => setUserState((current) => toggleFavorite(current, id))} onAddToSetlist={addSongToSetlist} onAddToTonight={addToTonightSetlist} onDeleteSong={deleteDeviceSong} onNotify={setSystemMessage} />}
        {route.name === 'setlists' && <Setlists songs={allSongs} publicSetlists={catalog.publicSetlists} catalogVersion={catalog.version} userState={userState} onUserStateChange={setUserState} onOpenSong={openSong} onOpenPublicSetlist={(id, source) => navigate(`setlists/${id}`, false, source, '[data-view-transition-target="setlist-title"]', 'shared-setlist-title')} secureProfile={secureAccount.profile} online={online} followedLiveSetlistId={followedLiveSetlistId} onFollowLiveSetlist={setFollowedLiveSetlistId} />}
        {route.name === 'import' && <PdfImportPage allSongs={allSongs} deviceSongs={deviceSongs} defaultNotation={userState.settings.notation} onLibraryChanged={refreshDeviceSongs} onOpenSong={openSong} userProfile={userProfile} secureProfile={secureAccount.profile} secureMode={secureAccount.enabled} />}
        {route.name === 'settings' && <Settings userState={userState} userProfile={userProfile} secureProfile={secureAccount.profile} secureMode={secureAccount.enabled} cloudSync={cloudSync} personalSongs={allSongs.filter((song) => song.personalOnly)} onUserStateChange={setUserState} onUserProfileChange={setUserProfile} onPersonalLibraryChanged={refreshDeviceSongs} onNavigate={navigate} onRefreshSecureProfile={secureAccount.refresh} onOpenGuide={() => setFirstRunOpen(true)} />}
        {route.name === 'admin' && secureAccount.enabled && secureAccount.profile?.role === 'admin' && <AdminPage cloudSync={cloudSync} online={online} onNavigate={navigate} onOpenSong={openSong} songs={allSongs} catalogVersion={catalog.version} downloadedSongs={downloadedLibrarySongs.length} availableSongs={allSongs.length} />}
        {route.name === 'offline' && <OfflineContent catalog={catalog} secureProfile={secureAccount.profile} secureMode={secureAccount.enabled} offlineGrant={secureAccount.offlineGrant} downloadedLibrarySongs={downloadedLibrarySongs} onPersonalLibraryChanged={refreshDeviceSongs} onNavigate={navigate} />}
        {route.name === 'install' && <InstallPage canPrompt={installPrompt.canPrompt} installed={installPrompt.installed} isIosLike={installPrompt.isIosLike} onInstall={installPrompt.install} onNavigate={navigate} />}
        {route.name === 'help' && <HelpPage onNavigate={navigate} />}
        {route.name === 'diagnostics' && <DiagnosticsPage onBack={() => navigate('settings')} />}
        {route.name === 'song' && selectedSong && <SongReader key={selectedSong.id} song={selectedSong} catalogVersion={catalog.version} userState={userState} secureProfile={secureAccount.profile} onUserStateChange={setUserState} onBack={() => navigate(readerSequence.length ? 'setlists' : 'songs')} previousSong={previousReaderSong} nextSong={nextReaderSong} onPreviousSong={previousReaderSong ? () => openReaderSibling(previousReaderSong) : undefined} onNextSong={nextReaderSong ? () => openReaderSibling(nextReaderSong) : undefined} />}
        {route.name === 'public-setlist' && selectedPublicSetlist && <PublicSetlistPage setlist={selectedPublicSetlist} songs={catalog.songs} onOpenSong={(id) => openSong(id, selectedPublicSetlist.songIds)} onBack={() => navigate('setlists')} />}
        {((route.name === 'song' && !selectedSong) || (route.name === 'public-setlist' && !selectedPublicSetlist) || (route.name === 'admin' && (!secureAccount.enabled || secureAccount.profile?.role !== 'admin')) || route.name === 'not-found') && <section className="info-page not-found"><p className="eyebrow">404</p><h1>Tato stránka ve zpěvníku není</h1><p>Odkaz může být starý nebo chybný.</p><button type="button" className="primary-button" onClick={() => navigate('')}>Přejít na písně</button></section>}
        </Suspense></div>
      </main>
      {route.name !== 'song' && route.name !== 'home' && <nav className="bottom-nav bottom-nav--five" aria-label="Hlavní navigace">
        <button type="button" className={navScreen === 'library' ? 'active' : ''} aria-current={navScreen === 'library' ? 'page' : undefined} onClick={() => { haptic(); navigate('songs'); }}><Icon name="search" />Písně</button>
        <button type="button" className={navScreen === 'setlists' ? 'active' : ''} aria-current={navScreen === 'setlists' ? 'page' : undefined} onPointerDown={() => void loadSetlists()} onPointerEnter={() => void loadSetlists()} onFocus={() => void loadSetlists()} onClick={() => { haptic(); navigate('setlists'); }}><Icon name="list" />Setlisty</button>
        <button type="button" className={navScreen === 'import' ? 'active' : ''} aria-current={navScreen === 'import' ? 'page' : undefined} onPointerDown={() => void loadPdfImportPage()} onPointerEnter={() => void loadPdfImportPage()} onFocus={() => void loadPdfImportPage()} onClick={() => { haptic(); navigate('import'); }}><Icon name="plus" />Přidat</button>
        <button type="button" className={navScreen === 'offline' ? 'active' : ''} aria-current={navScreen === 'offline' ? 'page' : undefined} onPointerDown={() => void loadOfflineContent()} onPointerEnter={() => void loadOfflineContent()} onFocus={() => void loadOfflineContent()} onClick={() => { haptic(); navigate('offline'); }}><Icon name="download" />Offline</button>
        <button type="button" className={navScreen === 'settings' ? 'active' : ''} aria-current={navScreen === 'settings' ? 'page' : undefined} onPointerDown={() => void loadSettings()} onPointerEnter={() => void loadSettings()} onFocus={() => void loadSettings()} onClick={() => { haptic(); navigate('settings'); }}><Icon name="settings" />Nastavení</button>
      </nav>}
      <AppStatusCenter open={statusCenterOpen} online={online} profile={secureAccount.profile} offlineAuthenticated={secureAccount.authState.status === 'authenticated-offline'} cloudSync={cloudSync} downloadedSongs={downloadedLibrarySongs.length} availableSongs={allSongs.length} catalogVersion={catalog.version} updateAvailable={updateAvailable} onUpdateAvailable={() => setUpdateAvailable(true)} onInstallUpdate={activateWaitingUpdate} onClose={() => setStatusCenterOpen(false)} onNavigate={navigate} />
      {followedLiveSetlistId && secureAccount.profile?.status === 'approved' && <LiveSetlistFollower setlistId={followedLiveSetlistId} profile={secureAccount.profile} online={online} songs={allSongs} onOpenSong={openSong} onStop={() => setFollowedLiveSetlistId('')} />}
      {firstRunOpen && <FirstRunGuide userId={userProfile.id} role={userProfile.role} onClose={() => setFirstRunOpen(false)} onNavigate={navigate} />}
    </div>
  );
}
