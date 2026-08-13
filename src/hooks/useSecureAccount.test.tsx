import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredOfflineGrantRecord } from '../storage/database';
import { useSecureAccount } from './useSecureAccount';

const mocks = vi.hoisted(() => ({
  getOfflineGrant: vi.fn(),
  getOnlineSession: vi.fn(),
  issueOfflineGrant: vi.fn(),
  saveOfflineGrant: vi.fn(),
  recordDiagnostic: vi.fn().mockResolvedValue(undefined),
  requestPersistentStorage: vi.fn().mockResolvedValue(true),
}));

vi.mock('../auth/secureAccess', () => ({
  offlineGrantClientConfigured: true,
  secureAccessConfigured: true,
  secureAccessConfigurationError: null,
  secureAccessRequired: true,
  subscribeToSecureSession: vi.fn(() => () => undefined),
  touchSecurePresence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../repositories/neonAuthRepository', () => ({
  neonAuthRepository: {
    getOfflineGrant: mocks.getOfflineGrant,
    getOnlineSession: mocks.getOnlineSession,
    issueOfflineGrant: mocks.issueOfflineGrant,
    saveOfflineGrant: mocks.saveOfflineGrant,
  },
}));

vi.mock('../storage/database', () => ({
  getOrCreateDeviceId: vi.fn().mockResolvedValue('device-cold-start'),
  recordDiagnostic: mocks.recordDiagnostic,
}));

vi.mock('../pwa/storagePersistence', () => ({ requestPersistentStorage: mocks.requestPersistentStorage }));

const localGrant: StoredOfflineGrantRecord = {
  schemaVersion: 1,
  provider: 'neon-auth',
  token: 'synthetic.signed.offline-grant',
  verifiedAt: '2026-08-13T08:00:00.000Z',
  payload: {
    version: 1,
    issuer: 'https://auth.example.test',
    audience: 'cesky-zpevnik-offline',
    subject: '11111111-1111-4111-8111-111111111111',
    displayName: 'Offline člen',
    scopes: ['songs:read'],
    contentPackages: ['members'],
    contentVersion: 'synthetic-version',
    issuedAt: '2026-08-13T08:00:00.000Z',
    notBefore: '2026-08-13T08:00:00.000Z',
    offlineValidUntil: '2099-09-12T08:00:00.000Z',
    keyId: 'synthetic-key',
    deviceId: 'device-cold-start',
  },
  profile: {
    id: '11111111-1111-4111-8111-111111111111',
    auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'offline@example.test',
    display_name: 'Offline člen',
    status: 'approved',
    role: 'member',
    created_at: '2026-08-01T08:00:00.000Z',
    reviewed_at: '2026-08-02T08:00:00.000Z',
    last_seen_at: null,
  },
};

describe('useSecureAccount offline cold start', () => {
  beforeEach(() => {
    mocks.getOfflineGrant.mockReset().mockResolvedValue(localGrant);
    mocks.getOnlineSession.mockReset();
    mocks.issueOfflineGrant.mockReset();
    mocks.saveOfflineGrant.mockReset().mockResolvedValue(undefined);
    mocks.recordDiagnostic.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('zpřístupní uložený profil i při úplně nedostupné síti', async () => {
    mocks.getOnlineSession.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useSecureAccount());

    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.authState.status).toBe('authenticated-offline');
    expect(result.current.profile?.email).toBe('offline@example.test');
    expect(result.current.error).toBeNull();
  });

  it('chybějící online cookie nesmaže platné lokální oprávnění', async () => {
    mocks.getOnlineSession.mockResolvedValue({ status: 'unauthenticated' });
    const { result } = renderHook(() => useSecureAccount());

    await waitFor(() => expect(result.current.authState.status).toBe('authenticated-offline'));
    expect(result.current.profile?.status).toBe('approved');
    expect(result.current.offlineGrant?.contentVersion).toBe('synthetic-version');
  });

  it('zablokovaný IndexedDB nenechá aplikaci navždy na startovací obrazovce', async () => {
    vi.useFakeTimers();
    mocks.getOfflineGrant.mockReturnValue(new Promise<never>(() => undefined));
    mocks.getOnlineSession.mockResolvedValue({ status: 'unauthenticated' });
    const { result } = renderHook(() => useSecureAccount());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.hydrated).toBe(true);
    expect(result.current.authState.status).toBe('unauthenticated');
  });

  it('při prvním přihlášení počká se vstupem na bezpečné uložení offline grantu', async () => {
    mocks.getOfflineGrant.mockResolvedValue(null);
    mocks.getOnlineSession.mockResolvedValue({
      status: 'authenticated',
      profile: localGrant.profile,
      session: { access_token: 'synthetic-access', token_type: 'bearer', expires_in: 3600, expires_at: 4_102_444_800 },
    });
    let finishGrant!: (value: StoredOfflineGrantRecord) => void;
    mocks.issueOfflineGrant.mockReturnValue(new Promise((resolve) => { finishGrant = resolve; }));
    const { result } = renderHook(() => useSecureAccount());

    await waitFor(() => expect(mocks.issueOfflineGrant).toHaveBeenCalled());
    expect(result.current.hydrated).toBe(false);

    finishGrant(localGrant);
    await waitFor(() => expect(mocks.saveOfflineGrant).toHaveBeenCalledWith(expect.objectContaining({ token: localGrant.token })));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.authState.status).toBe('authenticated-online');
    expect(result.current.profile?.email).toBe('offline@example.test');
  });
});
