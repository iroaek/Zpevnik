import {
  getSecureSession,
  loadSecureProfile,
  offlineGrantAudience,
  offlineGrantIssuer,
  offlineGrantPublicJwks,
  requestOfflineGrantToken,
  secureProfileSchema,
  signOutSecureAccount,
} from '../auth/secureAccess';
import { parseOfflineGrantKeySet, verifyOfflineGrant } from '../auth/offlineGrant';
import {
  clearOfflineGrantRecord,
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

function verifierConfiguration() {
  const keySet = parseOfflineGrantKeySet(offlineGrantPublicJwks);
  if (!offlineGrantIssuer || !keySet) {
    throw new Error('Podepsané offline oprávnění ještě není nakonfigurované. Přístup online zůstává funkční.');
  }
  return { issuer: offlineGrantIssuer, audience: offlineGrantAudience, keySet };
}

export const supabaseAuthRepository: AuthRepository = {
  async getOnlineSession(signal): Promise<OnlineSessionResult> {
    const session = await abortable(getSecureSession(), signal);
    if (!session) return { status: 'unauthenticated' };
    const profile = await abortable(loadSecureProfile(), signal);
    return profile ? { status: 'authenticated', session, profile } : { status: 'unauthenticated' };
  },

  async issueOfflineGrant(profile, deviceId) {
    const token = await requestOfflineGrantToken(deviceId);
    const requiredPackage = profile.role === 'admin' ? 'admin' : 'members';
    const verified = await verifyOfflineGrant(token, {
      ...verifierConfiguration(),
      deviceId,
      requiredPackage,
    });
    if (verified.payload.subject !== profile.id) throw new Error('Offline oprávnění patří jinému účtu.');
    return verified;
  },

  async getOfflineGrant() {
    const stored = await loadOfflineGrantRecord();
    if (!stored) return null;
    const profile = secureProfileSchema.parse(stored.profile);
    const requiredPackage = profile.role === 'admin' ? 'admin' : 'members';
    const verified = await verifyOfflineGrant(stored.token, {
      ...verifierConfiguration(),
      deviceId: stored.payload.deviceId,
      requiredPackage,
    });
    if (verified.payload.subject !== profile.id) throw new Error('Lokální profil a offline oprávnění patří rozdílným účtům.');
    return { ...stored, payload: verified.payload, verifiedAt: verified.verifiedAt, profile };
  },

  saveOfflineGrant: saveOfflineGrantRecord,
  removeOfflineGrant: clearOfflineGrantRecord,
  signOut: signOutSecureAccount,
};
