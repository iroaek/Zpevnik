import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCloudUserState, saveCloudUserState, type SecureProfile } from '../auth/secureAccess';
import { createUuid } from '../domain/browserCompatibility';
import {
  classifySyncError,
  decideUserStateSync,
  newestLocalUserState,
  retryDelayMs,
  syncErrorMessage,
  type SyncErrorCode,
} from '../sync/userStateSync';
import {
  enqueuePendingMutation,
  loadPendingMutations,
  markPendingMutationFailed,
  recordDiagnostic,
  removePendingMutation,
  type PendingMutation,
  type UserState,
} from '../storage/database';

export type CloudSyncStatus = 'disabled' | 'loading' | 'syncing' | 'synced' | 'offline' | 'error';

export interface CloudSyncState {
  status: CloudSyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
  pendingCount: number;
  nextRetryAt: string | null;
  refresh: () => Promise<void>;
}

export function useCloudUserState(
  enabled: boolean,
  profile: SecureProfile | null,
  hydrated: boolean,
  state: UserState,
  setState: React.Dispatch<React.SetStateAction<UserState>>,
): CloudSyncState {
  const accountId = enabled && profile?.status === 'approved' ? profile.id : null;
  const syncEnabled = Boolean(accountId && hydrated);
  const stateRef = useRef(state);
  const activeAccountRef = useRef(accountId);
  const initializedAccount = useRef<string | null>(null);
  const lastUploadedVersion = useRef<string | null>(null);
  const syncPromise = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState<CloudSyncStatus>(accountId ? 'loading' : 'disabled');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [nextRetryAt, setNextRetryAt] = useState<string | null>(null);

  useEffect(() => {
    activeAccountRef.current = accountId;
  }, [accountId]);

  const queueSnapshot = useCallback(async (snapshot: UserState, reason: SyncErrorCode | null = null): Promise<PendingMutation[]> => {
    if (!accountId) return [];
    await enqueuePendingMutation({
      schemaVersion: 1,
      id: createUuid(),
      userId: accountId,
      idempotencyKey: `${accountId}:${snapshot.updatedAt}`,
      kind: 'user-state-upsert',
      payload: snapshot,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: reason,
    });
    const queued = await loadPendingMutations(accountId);
    setPendingCount(queued.length);
    return queued;
  }, [accountId]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const performSync = useCallback(async () => {
    if (!accountId || !hydrated) return;
    const syncingAccount = accountId;
    if (!navigator.onLine) {
      try {
        await queueSnapshot(stateRef.current, 'offline');
        if (activeAccountRef.current !== syncingAccount) return;
        setError(syncErrorMessage('offline'));
      } catch {
        if (activeAccountRef.current !== syncingAccount) return;
        setError('Změny se nepodařilo uložit do místní fronty. Zkontrolujte volné místo zařízení.');
      }
      setNextRetryAt(null);
      setStatus('offline');
      return;
    }

    setStatus(initializedAccount.current === accountId ? 'syncing' : 'loading');
    try {
      const pendingBefore = await loadPendingMutations(accountId);
      if (activeAccountRef.current !== syncingAccount) return;
      setPendingCount(pendingBefore.length);
      const local = newestLocalUserState(stateRef.current, pendingBefore);
      const remote = await loadCloudUserState();
      if (activeAccountRef.current !== syncingAccount) return;
      const decision = decideUserStateSync(remote, local);

      if (decision.action === 'upload') await saveCloudUserState(decision.state);
      if (activeAccountRef.current !== syncingAccount) return;
      if (decision.action === 'download') setState(decision.state);
      lastUploadedVersion.current = decision.state.updatedAt;
      initializedAccount.current = accountId;

      const confirmedVersion = decision.state.updatedAt;
      const confirmed = pendingBefore.filter((mutation) => mutation.payload.updatedAt <= confirmedVersion);
      for (const mutation of confirmed) await removePendingMutation(mutation.id);
      const remaining = await loadPendingMutations(accountId);
      if (activeAccountRef.current !== syncingAccount) return;
      setPendingCount(remaining.length);
      setNextRetryAt(remaining.length ? new Date(Date.now() + 250).toISOString() : null);
      const completedAt = new Date().toISOString();
      setLastSyncedAt(completedAt);
      setError(null);
      setStatus('synced');
      if (pendingBefore.length || decision.action !== 'noop') {
        void recordDiagnostic({
          category: 'sync',
          event: 'user-state-sync-succeeded',
          level: 'info',
          details: { action: decision.action, confirmed: confirmed.length, remaining: remaining.length },
        }).catch(() => undefined);
      }
    } catch (caught) {
      if (activeAccountRef.current !== syncingAccount) return;
      const code = classifySyncError(caught, navigator.onLine);
      let attempts = 1;
      let queued: PendingMutation[] = [];
      try {
        queued = await queueSnapshot(stateRef.current, code);
        const marked = await Promise.all(queued.map((mutation) => markPendingMutationFailed(mutation.id, code)));
        attempts = Math.max(1, ...marked.flatMap((mutation) => mutation ? [mutation.attempts] : []));
        queued = await loadPendingMutations(accountId);
        setPendingCount(queued.length);
      } catch {
        // Stav UI stále oznámí původní chybu; selhání IndexedDB nesmí vytvořit neobslouženou promise.
      }
      const delay = retryDelayMs(attempts);
      const retryAt = code === 'offline' ? null : new Date(Date.now() + delay).toISOString();
      setNextRetryAt(retryAt);
      setError(syncErrorMessage(code));
      setStatus(code === 'offline' ? 'offline' : 'error');
      void recordDiagnostic({
        category: 'sync',
        event: 'user-state-sync-deferred',
        level: code === 'offline' ? 'warning' : 'error',
        details: { code, attempts, pending: queued.length, retrySeconds: retryAt ? Math.round(delay / 1_000) : 0 },
      }).catch(() => undefined);
    }
  }, [accountId, hydrated, queueSnapshot, setState]);

  const refresh = useCallback((): Promise<void> => {
    if (syncPromise.current) return syncPromise.current;
    const running = performSync();
    syncPromise.current = running;
    return running.finally(() => {
      if (syncPromise.current === running) syncPromise.current = null;
    });
  }, [performSync]);

  useEffect(() => {
    if (!accountId || !hydrated) {
      initializedAccount.current = null;
      lastUploadedVersion.current = null;
      syncPromise.current = null;
      return;
    }
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [accountId, hydrated, refresh]);

  useEffect(() => {
    if (!accountId || initializedAccount.current !== accountId || state.updatedAt === lastUploadedVersion.current) return;
    const timer = window.setTimeout(() => {
      void queueSnapshot(state).then(() => {
        if (!navigator.onLine) {
          setStatus('offline');
          setError(syncErrorMessage('offline'));
          return;
        }
        return refresh();
      }).catch(() => {
        setStatus('error');
        setError('Změny se nepodařilo uložit do místní fronty. Zkontrolujte volné místo zařízení.');
      });
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [accountId, queueSnapshot, refresh, state]);

  useEffect(() => {
    if (!accountId || !nextRetryAt || !navigator.onLine) return;
    const delay = Math.max(0, new Date(nextRetryAt).getTime() - Date.now());
    const timer = window.setTimeout(() => {
      setNextRetryAt(null);
      void refresh();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [accountId, nextRetryAt, refresh]);

  useEffect(() => {
    if (!accountId) return;
    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        setNextRetryAt(null);
        void refresh();
      }
    };
    window.addEventListener('online', refreshWhenActive);
    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);
    return () => {
      window.removeEventListener('online', refreshWhenActive);
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [accountId, refresh]);

  return {
    status: syncEnabled ? status : 'disabled',
    lastSyncedAt: syncEnabled ? lastSyncedAt : null,
    error: syncEnabled ? error : null,
    pendingCount: syncEnabled ? pendingCount : 0,
    nextRetryAt: syncEnabled ? nextRetryAt : null,
    refresh,
  };
}
