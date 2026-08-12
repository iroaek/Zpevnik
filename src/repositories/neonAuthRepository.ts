import {
  getSecureSession,
  loadNeonPublicJwks,
  loadSecureProfile,
  offlineGrantAudience,
  offlineGrantIssuer,
  requestNeonSessionJwt,
  registerSecureDevice,
  secureProfileSchema,
  signOutSecureAccount,
} from '../auth/secureAccess';
import { parseNeonOfflineKeySet, verifyNeonOfflineGrant } from '../auth/offlineGrant';
import {
  clearOfflineGrantRecord,
  loadDownloadedLibraryMetadata,
  loadOfflineGrantRecord,
  saveOfflineGrantRecord,
} from '../storage/database';
import type { AuthRepository, OnlineSessionResult } from './contracts';

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(new DOMException('Ověření bylo zrušeno.', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new DOMException('Ověření bylo zrušeno.', 'AbortError'));
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function offlineDays(): number {
  const configured = Number(import.meta.env.VITE_NEON_OFFLINE_DAYS ?? '30');
  return Number.isFinite(configured) ? Math.min(30, Math.max(1, Math.round(configured))) : 30;
}

export const neonAuthRepository: AuthRepository = {
  async getOnlineSession(signal): Promise<OnlineSessionResult> {
    const session = await abortable(getSecureSession(), signal);
    if (!session) return { status: 'unauthenticated' };
    const profile = await abortable(loadSecureProfile(), signal);
    return profile ? { status: 'authenticated', session, profile } : { status: 'unauthenticated' };
  },

  async issueOfflineGrant(profile, deviceId, accessToken) {
    const token = await Promise.resolve(accessToken || requestNeonSessionJwt());
    await registerSecureDevice(deviceId, token);
    const [rawKeySet, metadata] = await Promise.all([
      loadNeonPublicJwks(),
      loadDownloadedLibraryMetadata(),
    ]);
    const keySet = parseNeonOfflineKeySet(rawKeySet);
    if (!keySet) throw new Error('Neon Auth vrátil neplatnou sadu veřejných podpisových klíčů.');
    const verified = await verifyNeonOfflineGrant(token, {
      issuer: offlineGrantIssuer,
      audience: offlineGrantAudience,
      keySet,
      profile,
      contentVersion: metadata?.version ?? 'not-downloaded',
      deviceId,
      offlineDays: offlineDays(),
    });
    return { ...verified, provider: 'neon-auth' as const, keySet };
  },

  async getOfflineGrant() {
    const stored = await loadOfflineGrantRecord();
    if (!stored || stored.provider !== 'neon-auth' || !stored.keySet) return null;
    const profile = secureProfileSchema.parse(stored.profile);
    const verified = await verifyNeonOfflineGrant(stored.token, {
      issuer: offlineGrantIssuer,
      audience: offlineGrantAudience,
      keySet: stored.keySet,
      profile,
      contentVersion: stored.payload.contentVersion,
      deviceId: stored.payload.deviceId,
      offlineDays: offlineDays(),
    });
    return { ...stored, payload: verified.payload, verifiedAt: verified.verifiedAt, profile };
  },

  saveOfflineGrant: saveOfflineGrantRecord,
  removeOfflineGrant: clearOfflineGrantRecord,
  signOut: signOutSecureAccount,
};
