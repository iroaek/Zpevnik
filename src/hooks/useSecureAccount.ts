import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyAuthError, offlineAuthState, resolveAuthFailure, resolveMissingOnlineSession, type AuthState } from '../auth/authState';
import { OfflineGrantValidationError, type OfflineGrantPayload } from '../auth/offlineGrant';
import { assertAuthWork, authWorkSignal } from '../auth/authLifecycle';
import { diagnoseOffline, offlineError, OfflinePreparationError } from '../auth/offlineDiagnostics';
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
import { getOrCreateDeviceId, loadAuthIntent, recordDiagnostic, type StoredOfflineGrantRecord } from '../storage/database';
import { requestPersistentStorage } from '../pwa/storagePersistence';
import { withDeadline } from '../domain/asyncDeadline';

const ONLINE_CHECK_TIMEOUT_MS = 8_000;
const OFFLINE_GRANT_READ_TIMEOUT_MS = 5_000;

export interface SecureAccountState {
  enabled: boolean;
  required: boolean;
  hydrated: boolean;
  authState: AuthState;
  session: SecureSession | null;
  profile: SecureProfile | null;
  offlineGrant: OfflineGrantPayload | null;
  error: string | null;
  offlineProblem: OfflinePreparationError | null;
  passwordRecovery: boolean;
  refresh: () => Promise<void>;
  prepareAuthorization: () => Promise<StoredOfflineGrantRecord>;
  finishPasswordRecovery: () => void;
}

async function readOfflineGrant(): Promise<{ grant: StoredOfflineGrantRecord | null; expiredAt?: string; problem?: OfflinePreparationError }> {
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
      return { grant: null, expiredAt: error.message, problem: offlineError(error, 'grant_expired') };
    }
    void recordDiagnostic({ category: 'auth', event: 'offline_grant_invalid', level: 'warning' }).catch(() => undefined);
    const problem = offlineError(error, 'local_store_unavailable');
    diagnoseOffline('local_read', problem.code, problem.status);
    return { grant: null, problem };
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
  const [offlineProblem, setOfflineProblem] = useState<OfflinePreparationError | null>(null);
  const refreshSequence = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const running = useRef<AbortController | null>(null);

  const persistOfflineGrant = useCallback(async (
    onlineProfile: SecureProfile,
    accessToken: string,
    sequence: number,
    controller: AbortController,
    intentRevision: string,
  ) => {
    const current = () => { assertAuthWork(controller.signal); if (sequence !== refreshSequence.current) throw new DOMException('Účet se změnil.', 'AbortError'); };
    current();
    const deviceId = await withDeadline(getOrCreateDeviceId(), 5_000, 'Místní úložiště zařízení neodpovídá.');
    let verified;
    try { verified = await withDeadline(neonAuthRepository.issueOfflineGrant(onlineProfile, deviceId, accessToken, controller.signal), 8_000, 'Vydání offline oprávnění neodpovídá.'); }
    catch (error) { controller.abort(); throw error; }
    current();
    const stored: StoredOfflineGrantRecord = {
      schemaVersion: 1,
      provider: verified.provider,
      token: verified.token,
      payload: verified.payload,
      profile: onlineProfile,
      verifiedAt: verified.verifiedAt,
      keySet: verified.keySet,
    };
    try { await withDeadline(neonAuthRepository.saveOfflineGrant(stored, { signal: controller.signal, intentRevision }), 5_000, 'Offline oprávnění se nepodařilo včas uložit.'); }
    catch (error) { controller.abort(); throw offlineError(error, 'grant_storage_failed'); }
    current();
    setOfflineGrant(verified.payload);
    setOfflineProblem(null);
    void requestPersistentStorage().catch(() => undefined);
  }, []);

  const refreshOnce = useCallback(async () => {
    if (!enabled) return;
    const sequence = ++refreshSequence.current;
    const controller = new AbortController();
    running.current = controller;
    const lifecycle = authWorkSignal();
    const cancel = () => controller.abort();
    lifecycle.addEventListener('abort', cancel, { once: true });
    const timeout = window.setTimeout(() => controller.abort(), ONLINE_CHECK_TIMEOUT_MS);
    // Online kontrola běží souběžně s lokálním grantem. Ani pomalý IndexedDB,
    // ani nedostupný Neon tak nesčítají své časové limity do dlouhého blikání.
    const onlineSession = neonAuthRepository.getOnlineSession(controller.signal).then(
      (result) => ({ result, error: null as unknown }),
      (onlineError: unknown) => ({ result: null, error: onlineError }),
    );
    const local = await readOfflineGrant();
    if (sequence !== refreshSequence.current || lifecycle.aborted) {
      window.clearTimeout(timeout); lifecycle.removeEventListener('abort', cancel); return;
    }
    setOfflineProblem(local.problem ?? (local.grant ? null : new OfflinePreparationError('grant_missing')));
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
      assertAuthWork(lifecycle);
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

      if (local.grant && local.grant.profile.id !== result.profile.id) {
        setOfflineGrant(null);
        await neonAuthRepository.removeOfflineGrant();
      }
      if (result.profile.status !== 'approved') {
        await neonAuthRepository.removeOfflineGrant();
        setOfflineGrant(null);
        setOfflineProblem(new OfflinePreparationError('grant_issue_failed', 403));
      } else if (offlineGrantClientConfigured) {
          // Při prvním přihlášení nesmíme uživatele pustit domů dříve, než je
          // podepsané offline oprávnění opravdu v IndexedDB. Jinak rychlé zavření
          // PWA vytvoří zdánlivě úspěšnou, ale jen paměťovou relaci.
          try {
            const intent = await withDeadline(loadAuthIntent(), 5_000, 'Místní úložiště neodpovídá.');
            await persistOfflineGrant(result.profile, result.session.access_token, sequence, controller, intent.revision);
          } catch (grantError) {
            if (classifyAuthError(grantError).kind === 'access-revoked') throw grantError;
            void recordDiagnostic({ category: 'auth', event: 'offline_grant_refresh_failed', level: 'warning' }).catch(() => undefined);
            if (sequence === refreshSequence.current) {
              const problem = offlineError(grantError, 'grant_issue_failed');
              setOfflineProblem(problem);
              diagnoseOffline('prepare', problem.code, problem.status);
            }
          }
      }

      if (sequence !== refreshSequence.current || lifecycle.aborted) return;
      setSession(result.session);
      setProfile(result.profile);
      setAuthState({ status: 'authenticated-online', userId: result.profile.id });
      setError(null);
      void recordDiagnostic({ category: 'auth', event: 'online_session_valid', level: 'info' }).catch(() => undefined);
    } catch (caught) {
      if (sequence !== refreshSequence.current || lifecycle.aborted) return;
      const failure = classifyAuthError(caught);
      if (failure.kind === 'access-revoked') await neonAuthRepository.removeOfflineGrant();
      const state: AuthState = local.expiredAt && failure.kind !== 'access-revoked' ? { status: 'offline-access-expired' } : resolveAuthFailure(failure, local.grant ? {
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
      lifecycle.removeEventListener('abort', cancel);
      if (sequence === refreshSequence.current) setHydrated(true);
    }
  }, [enabled, persistOfflineGrant]);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const task = refreshOnce();
    inFlight.current = task;
    void task.finally(() => { if (inFlight.current === task) inFlight.current = null; }).catch(() => undefined);
    return task;
  }, [refreshOnce]);

  const prepareAuthorization = useCallback(async () => {
    await refresh();
    const result = await readOfflineGrant();
    if (!result.grant) throw result.problem ?? new OfflinePreparationError('grant_issue_failed');
    return result.grant;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const sequenceRef = refreshSequence;
    const timer = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeToSecureSession((event) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'INITIAL_SESSION') return;
      ++sequenceRef.current;
      running.current?.abort(); inFlight.current = null;
      if (event === 'SIGNED_OUT') {
        setSession(null); setProfile(null); setOfflineGrant(null); setError(null);
        setAuthState({ status: 'unauthenticated' }); setHydrated(true);
        return;
      }
      if (event === 'SIGNED_IN') {
        setSession(null); setProfile(null); setOfflineGrant(null);
        setAuthState({ status: 'checking' }); setHydrated(false);
      }
      window.setTimeout(() => void refresh(), 0);
    });
    return () => {
      window.clearTimeout(timer);
      ++sequenceRef.current;
      running.current?.abort(); inFlight.current = null;
      unsubscribe();
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
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
    if (!offlineGrant) return;
    let timer: number;
    const expire = () => {
      const remaining = Date.parse(offlineGrant.offlineValidUntil) - Date.now();
      window.clearTimeout(timer);
      if (remaining > 0) { timer = window.setTimeout(expire, Math.min(60_000, remaining)); return; }
      setOfflineGrant(null);
      setOfflineProblem(new OfflinePreparationError('grant_expired'));
      setAuthState(current => current.status === 'authenticated-offline' ? { status: 'offline-access-expired' } : current);
    };
    timer = window.setTimeout(expire, Math.min(60_000, Math.max(0, Date.parse(offlineGrant.offlineValidUntil) - Date.now())));
    document.addEventListener('visibilitychange', expire);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', expire); };
  }, [offlineGrant]);

  useEffect(() => {
    if (!enabled || authState.status !== 'authenticated-online' || !session) return;
    // A page already open online must not retain that state indefinitely when
    // the connection drops or the access JWT expires. Re-enter the same local
    // verification path used by a cold start, including when no grant was saved.
    const recheck = () => {
      setSession(null);
      if (!offlineGrant || Date.parse(offlineGrant.offlineValidUntil) <= Date.now()) {
        setAuthState({ status: 'checking' }); setHydrated(false);
      }
      void refresh();
    };
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.parse(session.expires_at) <= Date.now()) recheck(); };
    const expiresAt = Date.parse(session.expires_at);
    const timer = Number.isFinite(expiresAt) ? window.setTimeout(recheck, Math.min(2_147_483_647, Math.max(0, expiresAt - Date.now()))) : null;
    window.addEventListener('offline', recheck);
    document.addEventListener('visibilitychange', onVisible);
    return () => { if (timer !== null) window.clearTimeout(timer); window.removeEventListener('offline', recheck); document.removeEventListener('visibilitychange', onVisible); };
  }, [authState.status, enabled, offlineGrant, refresh, session]);

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
    offlineProblem,
    passwordRecovery,
    refresh,
    prepareAuthorization,
    finishPasswordRecovery: () => setPasswordRecovery(false),
  };
}
