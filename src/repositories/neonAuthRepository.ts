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
import { OfflineGrantValidationError, parseNeonOfflineKeySet, verifyNeonOfflineGrant } from '../auth/offlineGrant';
import { assertAuthWork } from '../auth/authLifecycle';
import { diagnoseOffline, OfflinePreparationError } from '../auth/offlineDiagnostics';
import {
  clearOfflineGrantRecord,
  loadDownloadedLibraryMetadata,
  loadOfflineGrantRecord,
  saveOfflineGrantRecord,
  getOrCreateDeviceId,
  loadAuthIntent,
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
    const session = await abortable(getSecureSession(signal), signal);
    if (!session) return { status: 'unauthenticated' };
    const profile = await abortable(loadSecureProfile(session, signal), signal);
    if (profile && profile.auth_user_id !== session.user.id) throw new OfflinePreparationError('identity_mismatch');
    return profile ? { status: 'authenticated', session, profile } : { status: 'unauthenticated' };
  },

  async issueOfflineGrant(profile, deviceId, accessToken, signal) {
    if (profile.status !== 'approved') throw new OfflinePreparationError('grant_issue_failed', 403);
    let token = await Promise.resolve(accessToken || requestNeonSessionJwt({ signal }));
    try { await registerSecureDevice(deviceId, token, signal); }
    catch (error) {
      if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 401) throw error;
      token = await requestNeonSessionJwt({ forceRefresh: true, signal });
      await registerSecureDevice(deviceId, token, signal);
    }
    diagnoseOffline('issue', 'device_registration_valid', 200);
    const [rawKeySet, metadata] = await Promise.all([
      loadNeonPublicJwks(signal),
      loadDownloadedLibraryMetadata(),
    ]);
    let keySet = parseNeonOfflineKeySet(rawKeySet);
    if (!keySet) throw new OfflinePreparationError('verification_key_unavailable');
    const options = {
      issuer: offlineGrantIssuer,
      audience: offlineGrantAudience,
      keySet,
      profile,
      contentVersion: metadata?.version ?? 'not-downloaded',
      deviceId,
      offlineDays: offlineDays(),
    };
    // A key may rotate between /token and JWKS (or during the role refresh).
    // Retry keys once, only at our configured endpoint, never token-supplied URLs.
    let keysRefreshed = false;
    const verify = async () => {
      try { return await verifyNeonOfflineGrant(token, { ...options, keySet: keySet! }); }
      catch (error) {
        if (!(error instanceof OfflineGrantValidationError) || error.reason !== 'unknown-key' || keysRefreshed) throw error;
        keysRefreshed = true;
        keySet = parseNeonOfflineKeySet(await loadNeonPublicJwks(signal));
        if (!keySet) throw new OfflinePreparationError('verification_key_unavailable');
        return verifyNeonOfflineGrant(token, { ...options, keySet });
      }
    };
    let verified;
    try { verified = await verify(); }
    catch (error) {
      if (!(error instanceof OfflineGrantValidationError) || error.reason !== 'wrong-package') throw error;
      // ensure_my_profile can update the signed role AFTER the login JWT was
      // issued. Refresh at the fixed auth endpoint; never relax the verifier.
      diagnoseOffline('verify', 'signed_role_refresh_required');
      token = await requestNeonSessionJwt({ forceRefresh: true, signal });
      verified = await verify();
    }
    assertAuthWork(signal);
    return { ...verified, provider: 'neon-auth' as const, keySet: keySet! };
  },

  async getOfflineGrant() {
    const stored = await loadOfflineGrantRecord();
    if (!stored || stored.provider !== 'neon-auth') return null;
    if (!stored.keySet) throw new OfflinePreparationError('verification_key_unavailable');
    const intent = await loadAuthIntent();
    if (intent.signedOut) return null;
    const profile = secureProfileSchema.parse(stored.profile);
    const deviceId = await getOrCreateDeviceId();
    if (stored.payload.subject !== profile.id || stored.payload.deviceId !== deviceId || (intent.authUserId && intent.authUserId !== profile.auth_user_id)) throw new OfflinePreparationError('identity_mismatch');
    const verified = await verifyNeonOfflineGrant(stored.token, {
      issuer: offlineGrantIssuer,
      audience: offlineGrantAudience,
      keySet: stored.keySet,
      profile,
      contentVersion: stored.payload.contentVersion,
      deviceId,
      offlineDays: offlineDays(),
    });
    return { ...stored, payload: verified.payload, verifiedAt: verified.verifiedAt, profile };
  },

  async saveOfflineGrant(record, options) {
    await saveOfflineGrantRecord(record, options);
    assertAuthWork(options?.signal);
    const stored = await this.getOfflineGrant();
    if (!stored || stored.token !== record.token || stored.payload.subject !== record.payload.subject) throw new OfflinePreparationError('grant_storage_failed');
    diagnoseOffline('readback', 'offline_grant_valid');
  },
  removeOfflineGrant: clearOfflineGrantRecord,
  signOut: signOutSecureAccount,
};
