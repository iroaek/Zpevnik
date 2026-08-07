import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCloudUserState, saveCloudUserState, type SecureProfile } from '../auth/secureAccess';
import type { UserState } from '../storage/database';

export type CloudSyncStatus = 'disabled' | 'loading' | 'syncing' | 'synced' | 'offline' | 'error';

export interface CloudSyncState {
  status: CloudSyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
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
  const stateRef = useRef(state);
  const initializedAccount = useRef<string | null>(null);
  const lastUploadedVersion = useRef<string | null>(null);
  const [status, setStatus] = useState<CloudSyncStatus>(accountId ? 'loading' : 'disabled');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async () => {
    if (!accountId || !hydrated) return;
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    setStatus(initializedAccount.current === accountId ? 'syncing' : 'loading');
    try {
      const remote = await loadCloudUserState();
      const local = stateRef.current;
      if (remote && remote.updatedAt > local.updatedAt) {
        lastUploadedVersion.current = remote.updatedAt;
        setState(remote);
      } else if (!remote || local.updatedAt > remote.updatedAt) {
        await saveCloudUserState(local);
        lastUploadedVersion.current = local.updatedAt;
      } else {
        lastUploadedVersion.current = local.updatedAt;
      }
      initializedAccount.current = accountId;
      const completedAt = new Date().toISOString();
      setLastSyncedAt(completedAt);
      setError(null);
      setStatus('synced');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Synchronizace se nezdařila.');
      setStatus('error');
    }
  }, [accountId, hydrated, setState]);

  useEffect(() => {
    if (!accountId || !hydrated) {
      initializedAccount.current = null;
      lastUploadedVersion.current = null;
      return;
    }
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [accountId, hydrated, refresh]);

  useEffect(() => {
    if (!accountId || initializedAccount.current !== accountId || state.updatedAt === lastUploadedVersion.current) return;
    const version = state.updatedAt;
    const timer = window.setTimeout(() => {
      if (!navigator.onLine) {
        setStatus('offline');
        return;
      }
      setStatus('syncing');
      void saveCloudUserState(state)
        .then(() => {
          lastUploadedVersion.current = version;
          setLastSyncedAt(new Date().toISOString());
          setError(null);
          setStatus('synced');
        })
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught.message : 'Synchronizace se nezdařila.');
          setStatus('error');
        });
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [accountId, state]);

  useEffect(() => {
    if (!accountId) return;
    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh();
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

  return { status: accountId ? status : 'disabled', lastSyncedAt, error, refresh };
}
