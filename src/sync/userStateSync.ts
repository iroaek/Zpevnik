import type { PendingMutation, UserState } from '../storage/database';

export type UserStateSyncDecision =
  | { action: 'upload'; state: UserState }
  | { action: 'download'; state: UserState }
  | { action: 'noop'; state: UserState };

export type SyncErrorCode = 'offline' | 'timeout' | 'authorization' | 'server' | 'transient';

export function newestLocalUserState(local: UserState, pending: PendingMutation[]): UserState {
  return pending.reduce(
    (newest, mutation) => mutation.payload.updatedAt > newest.updatedAt ? mutation.payload : newest,
    local,
  );
}

export function decideUserStateSync(remote: UserState | null, local: UserState): UserStateSyncDecision {
  if (!remote || local.updatedAt > remote.updatedAt) return { action: 'upload', state: local };
  if (remote.updatedAt > local.updatedAt) return { action: 'download', state: remote };
  return { action: 'noop', state: local };
}

export function retryDelayMs(attempts: number): number {
  const normalizedAttempts = Math.max(1, Math.min(16, Math.floor(attempts)));
  return Math.min(5 * 60_000, 5_000 * 2 ** (normalizedAttempts - 1));
}

export function classifySyncError(error: unknown, online: boolean): SyncErrorCode {
  if (!online) return 'offline';
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  if (status === 401 || status === 403) return 'authorization';
  if (status >= 500) return 'server';
  const message = typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message.toLocaleLowerCase('en-US')
    : '';
  const name = typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name.toLocaleLowerCase('en-US')
    : '';
  if (name === 'aborterror' || message.includes('timeout') || message.includes('timed out') || message.includes('abort')) return 'timeout';
  return 'transient';
}

export function syncErrorMessage(code: SyncErrorCode): string {
  if (code === 'offline') return 'Změny čekají na připojení.';
  if (code === 'timeout') return 'Server neodpověděl včas. Synchronizaci zopakujeme.';
  if (code === 'authorization') return 'Server odmítl synchronizaci. Obnovte oprávnění účtu.';
  if (code === 'server') return 'Server je dočasně nedostupný. Synchronizaci zopakujeme.';
  return 'Synchronizace se nezdařila. Změny zůstaly bezpečně uložené v zařízení.';
}
