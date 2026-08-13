import { describe, expect, it } from 'vitest';
import type { PendingMutation, UserState } from '../storage/database';
import { classifySyncError, decideUserStateSync, newestLocalUserState, retryDelayMs, syncErrorMessage } from './userStateSync';

function state(updatedAt: string): UserState {
  return {
    schemaVersion: 7,
    updatedAt,
    favorites: [],
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
      catalogDensity: 'standard',
      motion: 'gentle',
      accessibility: { highContrast: false, largeControls: false, oneHanded: false },
      reader: {
        chordScale: 1, lineHeight: 1.3, columnWidth: 760, focusSections: false, wrapLayoutText: true,
        stageFontSize: 24, transpose: 0, capoFret: 0, autoScrollSpeed: 24,
      },
    },
    songReaderPreferences: {},
  };
}

function mutation(updatedAt: string): PendingMutation {
  return {
    schemaVersion: 1,
    id: '33333333-3333-4333-8333-333333333333',
    userId: '11111111-1111-4111-8111-111111111111',
    idempotencyKey: `test:${updatedAt}`,
    kind: 'user-state-upsert',
    payload: state(updatedAt),
    createdAt: '2026-08-11T00:00:00.000Z',
    attempts: 0,
    lastError: null,
  };
}

describe('plán synchronizace uživatelského stavu', () => {
  it('zvolí nejnovější lokální snapshot včetně outboxu', () => {
    const local = state('2026-08-11T10:00:00.000Z');
    expect(newestLocalUserState(local, [mutation('2026-08-11T11:00:00.000Z')]).updatedAt)
      .toBe('2026-08-11T11:00:00.000Z');
    expect(newestLocalUserState(local, [mutation('2026-08-11T09:00:00.000Z')])).toBe(local);
  });

  it('nahraje lokální stav, stáhne novější vzdálený a při shodě nic nemění', () => {
    expect(decideUserStateSync(null, state('2026-08-11T10:00:00.000Z')).action).toBe('upload');
    expect(decideUserStateSync(state('2026-08-11T09:00:00.000Z'), state('2026-08-11T10:00:00.000Z')).action).toBe('upload');
    expect(decideUserStateSync(state('2026-08-11T11:00:00.000Z'), state('2026-08-11T10:00:00.000Z')).action).toBe('download');
    expect(decideUserStateSync(state('2026-08-11T10:00:00.000Z'), state('2026-08-11T10:00:00.000Z')).action).toBe('noop');
  });

  it('používá exponenciální backoff s horním limitem pěti minut', () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(10_000);
    expect(retryDelayMs(5)).toBe(80_000);
    expect(retryDelayMs(20)).toBe(300_000);
  });

  it('ukládá jen bezpečné kategorie chyb a uživatelské zprávy', () => {
    expect(classifySyncError(new Error('Failed to fetch secret-token-value'), false)).toBe('offline');
    expect(classifySyncError(new DOMException('aborted', 'AbortError'), true)).toBe('timeout');
    expect(classifySyncError({ status: 403 }, true)).toBe('authorization');
    expect(classifySyncError({ status: 503 }, true)).toBe('server');
    expect(classifySyncError(new Error('secret-token-value'), true)).toBe('transient');
    expect(syncErrorMessage('transient')).not.toContain('secret-token-value');
  });
});
