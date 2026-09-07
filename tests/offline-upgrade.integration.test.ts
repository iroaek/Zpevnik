// @vitest-environment node
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { neonGrantFixture, syntheticProfile } from '../src/test/neonGrantFixture.js';
import { verifyNeonOfflineGrant } from '../src/auth/offlineGrant.js';

describe('aktualizace skutečného formátu IndexedDB 9 → 10', () => {
  it('zachová grant, obnovovací relaci, identitu zařízení, obsah a uživatelské změny', async () => {
    const fixture = await neonGrantFixture();
    const verified = await verifyNeonOfflineGrant(fixture.token, fixture.options);
    const grant = { schemaVersion: 1, provider: 'neon-auth', ...verified, profile: syntheticProfile, keySet: fixture.keySet };
    const old = await openDB('cesky-zpevnik', 9, { upgrade(db) {
      for (const store of ['state', 'metadata', 'personalSongs', 'personalSongContent', 'account', 'songSubmissions', 'songSubmissionFiles', 'offlineAuth', 'contentPackages', 'pendingMutations', 'diagnostics', 'contentPackageChunks']) db.createObjectStore(store);
    } });
    const records: [string, string, unknown][] = [
      ['offlineAuth', 'current', grant], ['metadata', 'deviceId', 'synthetic-device'],
      ['personalSongContent', 'synthetic-member-song', '[C]Krátký test.'],
      ['account', 'neonSession', { schemaVersion: 1, provider: 'neon-auth', sessionToken: 'synthetic-refresh-token', user: { id: syntheticProfile.auth_user_id, email: syntheticProfile.email, emailVerified: true, displayName: syntheticProfile.display_name }, savedAt: new Date().toISOString() }],
      ['state', 'current', {
        schemaVersion: 7, updatedAt: '2026-09-01T00:00:00Z', favorites: ['synthetic-member-song'], recentSongIds: ['synthetic-member-song'],
        setlists: [{ id: 'synthetic-list', name: 'Syntetický seznam', songIds: ['synthetic-member-song'], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }],
        settings: { theme: 'dark', fontSize: 24, notation: 'czech', showChords: true, collapseRepeatedChoruses: true, printSize: 'A4', autoScrollSpeed: 25, catalogDensity: 'standard', motion: 'gentle', accessibility: { highContrast: false, largeControls: false, oneHanded: false }, reader: { chordScale: 1, lineHeight: 1.3, columnWidth: 760, focusSections: false, wrapLayoutText: true, stageFontSize: 24, transpose: 0, capoFret: 0, autoScrollSpeed: 25 } }, songReaderPreferences: {},
      }],
      ['pendingMutations', 'synthetic-mutation', { id: 'synthetic-mutation', state: 'not-uploaded' }],
    ];
    for (const [store, key, value] of records) await old.put(store, value, key);
    old.close();
    const database = await import('../src/storage/database.js');
    expect(await database.getOrCreateDeviceId()).toBe('synthetic-device');
    const upgraded = await openDB('cesky-zpevnik', 10);
    for (const [store, key, value] of records) expect(await upgraded.get(store, key)).toEqual(value);
    expect(await database.loadAuthIntent()).toMatchObject({ schemaVersion: 1, signedOut: false, authUserId: null });
    expect(await database.loadOfflineGrantRecord()).toEqual(grant);
    expect((await database.loadUserState()).favorites).toEqual(['synthetic-member-song']);
    upgraded.close();
  });
});
