import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateWaitingUpdate, checkForUpdate, hasWaitingUpdate, registerPwa } from './updateManager';

interface RegistrationCallbacks {
  onNeedRefresh?: () => void;
  onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration | undefined) => void;
}

function registrationMock(): ServiceWorkerRegistration {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    update: vi.fn(async () => undefined),
    waiting: null,
    installing: { state: 'installed' },
  } as unknown as ServiceWorkerRegistration;
}

const pwaMock = vi.hoisted(() => ({
  callbacks: undefined as RegistrationCallbacks | undefined,
  applyUpdate: vi.fn(async () => undefined),
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (callbacks: RegistrationCallbacks) => {
    pwaMock.callbacks = callbacks;
    return pwaMock.applyUpdate;
  },
}));

describe('správa aktualizace PWA', () => {
  afterEach(() => {
    vi.useRealTimers();
    pwaMock.applyUpdate.mockClear();
  });

  it('uchová informaci o čekající aktualizaci, i když událost přijde před připojením UI', async () => {
    vi.useFakeTimers();
    registerPwa();

    pwaMock.callbacks?.onNeedRefresh?.();
    expect(hasWaitingUpdate()).toBe(true);

    await activateWaitingUpdate();
    expect(pwaMock.applyUpdate).toHaveBeenCalledWith(true);
    expect(hasWaitingUpdate()).toBe(false);
  });

  it('vrátí jasný výsledek, když je nainstalovaná verze aktuální', async () => {
    vi.useFakeTimers();
    const current = registrationMock();
    registerPwa();
    pwaMock.callbacks?.onRegisteredSW?.('/sw.js', current);

    await expect(checkForUpdate()).resolves.toBe('up-to-date');
    expect(current.update).toHaveBeenCalledOnce();
  });
});
