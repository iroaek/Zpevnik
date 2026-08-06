import { registerSW } from 'virtual:pwa-register';

type PwaEventName = 'zpevnik:update-available' | 'zpevnik:offline-shell-ready' | 'zpevnik:update-error';
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;

function emit(name: PwaEventName, detail?: string): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function registerPwa(): void {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh: () => emit('zpevnik:update-available'),
    onOfflineReady: () => emit('zpevnik:offline-shell-ready'),
    onRegisteredSW: (_url, currentRegistration) => {
      registration = currentRegistration;
      window.addEventListener('online', () => { void registration?.update(); });
      window.setInterval(() => {
        if (navigator.onLine && document.visibilityState === 'visible') void registration?.update();
      }, 60 * 60 * 1000);
    },
    onRegisterError: (error) => emit('zpevnik:update-error', error instanceof Error ? error.message : 'Registrace offline režimu selhala.'),
  });
}

export async function activateWaitingUpdate(): Promise<void> {
  await applyUpdate?.(true);
}

export async function checkForUpdate(): Promise<void> {
  if (!navigator.onLine) throw new Error('Aktualizaci nelze zkontrolovat bez připojení.');
  await registration?.update();
}
