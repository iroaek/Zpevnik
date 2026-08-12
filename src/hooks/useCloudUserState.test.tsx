import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecureProfile } from '../auth/secureAccess';
import type { PendingMutation, UserState } from '../storage/database';

const mocks = vi.hoisted(() => ({
  pending: [] as PendingMutation[],
  loadCloudUserState: vi.fn<() => Promise<UserState | null>>(),
  saveCloudUserState: vi.fn<(state: UserState) => Promise<void>>(),
  recordDiagnostic: vi.fn(async () => undefined),
}));

vi.mock('../auth/secureAccess', () => ({
  loadCloudUserState: mocks.loadCloudUserState,
  saveCloudUserState: mocks.saveCloudUserState,
}));

vi.mock('../storage/database', () => ({
  enqueuePendingMutation: vi.fn(async (mutation: PendingMutation) => {
    mocks.pending.splice(0, mocks.pending.length, mutation);
  }),
  loadPendingMutations: vi.fn(async () => [...mocks.pending]),
  markPendingMutationFailed: vi.fn(async (id: string, lastError: PendingMutation['lastError']) => {
    const mutation = mocks.pending.find((candidate) => candidate.id === id);
    if (!mutation) return null;
    const failed = { ...mutation, attempts: mutation.attempts + 1, lastError };
    mocks.pending.splice(0, mocks.pending.length, failed);
    return failed;
  }),
  removePendingMutation: vi.fn(async (id: string) => {
    const index = mocks.pending.findIndex((candidate) => candidate.id === id);
    if (index >= 0) mocks.pending.splice(index, 1);
  }),
  recordDiagnostic: mocks.recordDiagnostic,
}));

import { useCloudUserState } from './useCloudUserState';

const profile: SecureProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'clen@example.test',
  display_name: 'Člen',
  status: 'approved',
  role: 'member',
  created_at: '2026-08-11T00:00:00.000Z',
  reviewed_at: '2026-08-11T00:10:00.000Z',
  last_seen_at: null,
};

const state: UserState = {
  schemaVersion: 3,
  updatedAt: '2026-08-11T12:00:00.000Z',
  favorites: ['synthetic-song'],
  recentSongIds: [],
  setlists: [],
  settings: {
    theme: 'system',
    fontSize: 18,
    notation: 'czech',
    showChords: true,
    collapseRepeatedChoruses: false,
    printSize: 'A4',
    autoScrollSpeed: 24,
  },
};

describe('cloud outbox replay', () => {
  let online = false;

  beforeEach(() => {
    online = false;
    mocks.pending.splice(0);
    mocks.loadCloudUserState.mockReset().mockResolvedValue(null);
    mocks.saveCloudUserState.mockReset().mockResolvedValue(undefined);
    mocks.recordDiagnostic.mockClear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  });

  it('uchová offline změnu a po návratu sítě ji právě jednou odešle', async () => {
    const setState = vi.fn();
    const { result } = renderHook(() => useCloudUserState(true, profile, true, state, setState));

    await waitFor(() => expect(result.current.status).toBe('offline'));
    expect(result.current.pendingCount).toBe(1);
    expect(mocks.saveCloudUserState).not.toHaveBeenCalled();

    online = true;
    await act(async () => window.dispatchEvent(new Event('online')));

    await waitFor(() => expect(result.current.status).toBe('synced'));
    expect(mocks.saveCloudUserState).toHaveBeenCalledTimes(1);
    expect(mocks.saveCloudUserState).toHaveBeenCalledWith(state);
    expect(result.current.pendingCount).toBe(0);
    expect(setState).not.toHaveBeenCalled();
  });
});
