import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyAuthError, offlineAuthState, resolveAuthFailure, resolveMissingOnlineSession, type AuthState } from '../auth/authState';
import { OfflineGrantValidationError, type OfflineGrantPayload } from '../auth/offlineGrant';
import {
  offlineGrantClientConfigured,
  secureAccessConfigured,
  secureAccessConfigurationError,
  secureAccessRequired,
  subscribeToSecureSession,
  touchSecurePresence,
  type SecureProfile,
  type SecureSession,
} from '../auth/secureAccess';
import { neonAuthRepository } from '../repositories/neonAuthRepository';
import { getOrCreateDeviceId, recordDiagnostic, type StoredOfflineGrantRecord } from '../storage/database';
import { requestPersistentStorage } from '../pwa/storagePersistence';
import { withDeadline } from '../domain/asyncDeadline';

const ONLINE_CHECK_TIMEOUT_MS = 8_000;
const OFFLINE_GRANT_READ_TIMEOUT_MS = 2_000;

export interface SecureAccountState {
  enabled: boolean;
  required: boolean;
  hydrated: boolean;
  authState: AuthState;
  session: SecureSession | null;
  profile: SecureProfile | null;
  offlineGrant: OfflineGrantPayload | null;
  error: string | null;
  passwordRecovery: boolean;
  refresh: () => Promise<void>;
  finishPasswordRecovery: () => void;
}

async function readOfflineGrant(): Promise<{ grant: StoredOfflineGrantRecord | null; expiredAt?: string }> {
  if (!offlineGrantClientConfigured) return { grant: null };
  try {
    return {
      grant: await withDeadline(
        neonAuthRepository.getOfflineGrant(),
        OFFLINE_GRANT_READ_TIMEOUT_MS,
        'Místní offline oprávnění neodpovídá.',
      ),
    };
  } catch (error) {
    if (error instanceof OfflineGrantValidationError && error.reason === 'expired') {
      return { grant: null, expiredAt: error.message };
    }
    void recordDiagnostic({ category: 'auth', event: 'offline_grant_invalid', level: 'warning' }).catch(() => undefined);
    return { grant: null };
  }
}

export function useSecureAccount(): SecureAccountState {
  const enabled = secureAccessConfigured;
  const [hydrated, setHydrated] = useState(!enabled);
  const [authState, setAuthState] = useState<AuthState>(enabled ? { status: 'checking' } : { status: 'unauthenticated' });
  const [session, setSession] = useState<SecureSession | null>(null);
  const [profile, setProfile] = useState<SecureProfile | null>(null);
  const [offlineGrant, setOfflineGrant] = useState<OfflineGrantPayload | null>(null);
  const [error, setError] = useState<string | null>(secureAccessConfigurationError);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const sequence = ++refreshSequence.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), ONLINE_CHECK_TIMEOUT_MS);
    // Online kontrola běží souběžně s lokálním grantem. Ani pomalý IndexedDB,
    // ani nedostupný Neon tak nesčítají své časové limity do dlouhého blikání.
    const onlineSession = neonAuthRepository.getOnlineSession(controller.signal).then(
      (result) => ({ result, error: null as unknown }),
      (onlineError: unknown) => ({ result: null, error: onlineError }),
    );
    const local = await readOfflineGrant();
    // Platný podepsaný grant je první zdroj pro cold start. Uživatel se tak
    // dostane ke stažené knihovně okamžitě i při pomalém nebo blokovaném
    // third-party cookie spojení s Neon Auth. Serverové ověření pokračuje níže.
    if (local.grant && sequence === refreshSequence.current) {
      setSession(null);
      setProfile(local.grant.profile);
      setOfflineGrant(local.grant.payload);
      setAuthState(offlineAuthState({
        userId: local.grant.payload.subject,
        offlineValidUntil: local.grant.payload.offlineValidUntil,
        contentVersion: local.grant.payload.contentVersion,
      }));
      setError(null);
      setHydrated(true);
    }
    try {
      const onlineResult = await onlineSession;
      if (onlineResult.error) throw onlineResult.error;
      const result = onlineResult.result!;
      if (sequence !== refreshSequence.current) return;
      if (result.status === 'unauthenticated') {
        if (local.grant) {
          setSession(null);
          setProfile(local.grant.profile);
          setOfflineGrant(local.grant.payload);
          setAuthState(resolveMissingOnlineSession({
            userId: local.grant.payload.subject,
            offlineValidUntil: local.grant.payload.offlineValidUntil,
            contentVersion: local.grant.payload.contentVersion,
          }));
          setError(null);
        } else {
          setSession(null);
          setProfile(null);
          setOfflineGrant(null);
          setAuthState(local.expiredAt ? { status: 'offline-access-expired' } : { status: 'unauthenticated' });
          setError(null);
        }
        return;
      }

      setSession(result.session);
      setProfile(result.profile);
      setAuthState({ status: 'authenticated-online', userId: result.profile.id });
      setError(null);
      void recordDiagnostic({ category: 'auth', event: 'online_session_valid', level: 'info' }).catch(() => undefined);

      if (result.profile.status === 'approved' && offlineGrantClientConfigured) {
        // Vydání a lokální uložení grantu nesmí blokovat zobrazení již platné
        // online relace. Proběhne na pozadí a stav doplní až po dokončení.
        void (async () => {
          try {
            const deviceId = await withDeadline(getOrCreateDeviceId(), 3_000, 'Místní úložiště zařízení neodpovídá.');
            // JWT už vrátilo první úspěšné ověření relace. Použijeme právě tento
            // token, aby uložení trvalého offline oprávnění nezáviselo na druhém
            // cross-site cookie požadavku, který mobilní PWA může zablokovat.
            const verified = await neonAuthRepository.issueOfflineGrant(result.profile, deviceId, result.session.access_token);
            const stored: StoredOfflineGrantRecord = {
              schemaVersion: 1,
              provider: verified.provider,
              token: verified.token,
              payload: verified.payload,
              profile: result.profile,
              verifiedAt: verified.verifiedAt,
              keySet: verified.keySet,
            };
            await withDeadline(neonAuthRepository.saveOfflineGrant(stored), 3_000, 'Offline oprávnění se nepodařilo včas uložit.');
            const persistent = await requestPersistentStorage();
            if (sequence === refreshSequence.current) setOfflineGrant(verified.payload);
            void recordDiagnostic({ category: 'auth', event: 'offline_grant_valid', level: 'info', details: { persistentStorage: persistent } }).catch(() => undefined);
          } catch (grantError) {
            void recordDiagnostic({ category: 'auth', event: 'offline_grant_refresh_failed', level: 'warning' }).catch(() => undefined);
            if (!local.grant && sequence === refreshSequence.current) {
              setError(grantError instanceof Error ? `Offline oprávnění se nepodařilo obnovit: ${grantError.message}` : 'Offline oprávnění se nepodařilo obnovit.');
            }
          }
        })();
      }
    } catch (caught) {
      if (sequence !== refreshSequence.current) return;
      const failure = classifyAuthError(caught);
      const state = resolveAuthFailure(failure, local.grant ? {
        userId: local.grant.payload.subject,
        offlineValidUntil: local.grant.payload.offlineValidUntil,
        contentVersion: local.grant.payload.contentVersion,
      } : null);
      setSession(null);
      setAuthState(state);
      if (state.status === 'authenticated-offline' && local.grant) {
        setProfile(local.grant.profile);
        setOfflineGrant(local.grant.payload);
        setError(null);
      } else {
        setProfile(null);
        setOfflineGrant(null);
        setError(failure.kind === 'session-invalid'
          ? null
          : failure.kind === 'network' || failure.kind === 'timeout' || failure.kind === 'server-unavailable'
          ? 'Server je dočasně nedostupný. Stažená data nebyla odstraněna.'
          : failure.message);
      }
      void recordDiagnostic({
        category: 'auth',
        event: state.status === 'authenticated-offline' ? 'offline_fallback_activated' : `auth_${failure.kind.replaceAll('-', '_')}`,
        level: state.status === 'authenticated-offline' ? 'info' : 'warning',
        details: { status: failure.status ?? null },
      }).catch(() => undefined);
    } finally {
      window.clearTimeout(timeout);
      if (sequence === refreshSequence.current) setHydrated(true);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeToSecureSession((event) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'INITIAL_SESSION') return;
      // SIGNED_OUT může být důsledkem neúspěšného refreshu bez sítě. O stavu
      // proto vždy rozhodne koordinované online ověření + lokální grant.
      window.setTimeout(() => void refresh(), 0);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || authState.status !== 'authenticated-online') return;
    const refreshIfActive = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      void refresh();
    };
    const polling = window.setInterval(refreshIfActive, 2 * 60_000);
    window.addEventListener('focus', refreshIfActive);
    window.addEventListener('online', refreshIfActive);
    document.addEventListener('visibilitychange', refreshIfActive);
    return () => {
      window.clearInterval(polling);
      window.removeEventListener('focus', refreshIfActive);
      window.removeEventListener('online', refreshIfActive);
      document.removeEventListener('visibilitychange', refreshIfActive);
    };
  }, [authState.status, enabled, refresh]);

  useEffect(() => {
    if (!enabled || authState.status !== 'authenticated-online' || !session || !profile) return;
    const touchIfActive = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      void touchSecurePresence().catch(() => undefined);
    };
    const firstTouch = window.setTimeout(touchIfActive, 0);
    const heartbeat = window.setInterval(touchIfActive, 60_000);
    document.addEventListener('visibilitychange', touchIfActive);
    return () => {
      window.clearTimeout(firstTouch);
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', touchIfActive);
    };
  }, [authState.status, enabled, profile, session]);

  return {
    enabled,
    required: secureAccessRequired,
    hydrated,
    authState,
    session,
    profile,
    offlineGrant,
    error,
    passwordRecovery,
    refresh,
    finishPasswordRecovery: () => setPasswordRecovery(false),
  };
}
