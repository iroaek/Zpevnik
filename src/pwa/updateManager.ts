import { registerSW } from 'virtual:pwa-register';

type PwaEventName = 'zpevnik:update-available' | 'zpevnik:offline-shell-ready' | 'zpevnik:update-error';
export type UpdateCheckResult = 'update-available' | 'up-to-date' | 'service-worker-unavailable';

let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;
let updatePending = false;
let activatingUpdate = false;
const observedRegistrations = new WeakSet<ServiceWorkerRegistration>();
const UPDATE_ACTIVATION_KEY = 'zpevnik-update-activation-v1';

function emit(name: PwaEventName, detail?: string): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function announceWaitingUpdate(): void {
  updatePending = true;
  emit('zpevnik:update-available');
}

function observeRegistration(current: ServiceWorkerRegistration): void {
  if (observedRegistrations.has(current)) return;
  observedRegistrations.add(current);
  current.addEventListener('updatefound', () => {
    const worker = current.installing;
    if (!worker) return;
    const stateChanged = () => {
      if (worker.state === 'installed' && current.waiting && navigator.serviceWorker.controller) announceWaitingUpdate();
    };
    worker.addEventListener('statechange', stateChanged);
  });
}

async function locateRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (registration) return registration;
  if (!('serviceWorker' in navigator)) return undefined;
  try {
    registration = await navigator.serviceWorker.getRegistration();
    if (registration) observeRegistration(registration);
    return registration;
  } catch {
    return undefined;
  }
}

async function waitForInstallingWorker(worker: ServiceWorker | null): Promise<void> {
  if (!worker || worker.state === 'installed' || worker.state === 'redundant') return;
  await new Promise<void>((resolve) => {
    let timeout = 0;
    const finish = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener('statechange', stateChanged);
      resolve();
    };
    const stateChanged = () => {
      if (worker.state === 'installed' || worker.state === 'redundant') finish();
    };
    timeout = window.setTimeout(finish, 8_000);
    worker.addEventListener('statechange', stateChanged);
  });
}

async function requestRegistrationUpdate(current: ServiceWorkerRegistration): Promise<void> {
  let resolveUpdateFound: (worker: ServiceWorker | null) => void = () => undefined;
  let settled = false;
  const updateFound = new Promise<ServiceWorker | null>((resolve) => { resolveUpdateFound = resolve; });
  const finish = (worker: ServiceWorker | null) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    current.removeEventListener('updatefound', found);
    resolveUpdateFound(worker);
  };
  const found = () => finish(current.installing);
  const timeout = window.setTimeout(() => finish(current.installing), 2_500);
  current.addEventListener('updatefound', found);
  try {
    await current.update();
    const worker = current.installing ?? await updateFound;
    finish(worker);
    await waitForInstallingWorker(worker);
  } finally {
    finish(null);
  }
}

export function hasWaitingUpdate(): boolean {
  return updatePending || Boolean(registration?.waiting);
}

export function registerPwa(): void {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh: announceWaitingUpdate,
    onOfflineReady: () => emit('zpevnik:offline-shell-ready'),
    onRegisteredSW: (_url, currentRegistration) => {
      registration = currentRegistration;
      if (registration) observeRegistration(registration);
      if (registration?.waiting) announceWaitingUpdate();
      const requestUpdate = () => {
        if (navigator.onLine && document.visibilityState === 'visible') void locateRegistration().then((current) => current?.update()).catch(() => undefined);
      };
      window.addEventListener('online', requestUpdate);
      document.addEventListener('visibilitychange', requestUpdate);
      // iOS může ponechat starý shell PWA otevřený i po novém nasazení. Kontrolu
      // proto zahájíme hned při registraci, ne až po návratu z pozadí nebo za 15 minut.
      requestUpdate();
      window.setInterval(() => {
        requestUpdate();
      }, 15 * 60 * 1000);
    },
    onRegisterError: (error) => emit('zpevnik:update-error', error instanceof Error ? error.message : 'Registrace offline režimu selhala.'),
  });
}

export async function activateWaitingUpdate(): Promise<void> {
  if (activatingUpdate) return;
  if (!hasWaitingUpdate()) throw new Error('Nová verze zatím není připravená k instalaci.');
  if (!applyUpdate) throw new Error('Aktualizační služba není připravená. Zavřete aplikaci a znovu ji otevřete.');
  activatingUpdate = true;
  document.documentElement.dataset.appUpdating = 'true';
  try {
    localStorage.setItem(UPDATE_ACTIVATION_KEY, JSON.stringify({ build: __BUILD_ID__, startedAt: new Date().toISOString() }));
  } catch { /* Aktualizace funguje i v soukromém režimu bez localStorage. */ }
  try {
    if (!('serviceWorker' in navigator) || typeof navigator.serviceWorker.addEventListener !== 'function') {
      await applyUpdate(true);
    } else {
      const controllerChanged = new Promise<void>((resolve) => {
        let timeout = 0;
        const finish = () => {
          window.clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('controllerchange', finish);
          resolve();
        };
        timeout = window.setTimeout(finish, 12_000);
        navigator.serviceWorker.addEventListener('controllerchange', finish);
      });
      await applyUpdate(false);
      await controllerChanged;
      try { localStorage.removeItem(UPDATE_ACTIVATION_KEY); } catch { /* bez úložiště */ }
      window.location.reload();
    }
    updatePending = false;
  } finally {
    activatingUpdate = false;
    delete document.documentElement.dataset.appUpdating;
  }
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!navigator.onLine) throw new Error('Aktualizaci nelze zkontrolovat bez připojení.');
  if (hasWaitingUpdate()) return 'update-available';
  const current = await locateRegistration();
  if (!current) return 'service-worker-unavailable';
  await requestRegistrationUpdate(current);
  if (current.waiting || updatePending) {
    announceWaitingUpdate();
    return 'update-available';
  }
  return 'up-to-date';
}
