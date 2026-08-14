// @vitest-environment node
import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { beforeAll, describe, expect, it } from 'vitest';

const legacyState = {
  schemaVersion: 1 as const,
  favorites: ['synteticka-jiskra'],
  recentSongIds: ['synteticka-jiskra'],
  setlists: [{ id: 'soukromy-test', name: 'Soukromý test', songIds: ['synteticka-jiskra'], createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z' }],
  settings: { theme: 'dark' as const, fontSize: 24, notation: 'czech' as const, showChords: true, collapseRepeatedChoruses: true, printSize: 'A4' as const, autoScrollSpeed: 31 },
};

function personalSongFixture(id: string, title: string) {
  const now = '2026-08-06T00:00:00.000Z';
  return {
    id, title, sortTitle: title, alternativeTitles: [],
    authors: ['Test'], lyricists: [], composers: [], language: 'cs', originalKey: 'C', timeSignature: null, tempo: null, capo: null,
    tags: ['syntetická'], categories: ['Osobní import'], difficulty: 'unknown' as const, firstLine: 'Vymyšlená věta',
    chordProPath: `indexeddb:${id}`, contentBytes: 18, contentFormat: 'chordpro' as const, personalOnly: true,
    chordsVerified: true, reviewFlags: [], scoreAssets: [], source: 'syntetický test', sourceIdentifier: 'fixture.pdf#page=1',
    rightsStatus: 'requires_review' as const, license: 'PERSONAL-USE', attribution: 'Test', notes: '', createdAt: now, updatedAt: now,
  };
}

describe('migrace IndexedDB', () => {
  beforeAll(async () => {
    await deleteDB('cesky-zpevnik');
    const legacy = await openDB('cesky-zpevnik', 1, { upgrade(database) { database.createObjectStore('state'); } });
    await legacy.put('state', legacyState, 'current');
    legacy.close();
  });

  it('povýší databázi na verzi 9, převede stav na schéma 7 a zachová uživatelská data', async () => {
    const databaseModule = await import('./database');
    const loaded = await databaseModule.loadUserState();
    expect(databaseModule.DATABASE_VERSION).toBe(9);
    expect(loaded.schemaVersion).toBe(7);
    expect(loaded.settings.motion).toBe('gentle');
    expect(loaded.updatedAt).toBe('2026-08-05T00:00:00.000Z');
    expect(loaded.favorites).toEqual(legacyState.favorites);
    expect(loaded.setlists).toEqual(legacyState.setlists);
    expect(loaded.settings.autoScrollSpeed).toBe(31);
    const upgraded = await openDB('cesky-zpevnik', 9);
    expect([...upgraded.objectStoreNames]).toContain('metadata');
    expect([...upgraded.objectStoreNames]).toContain('personalSongs');
    expect([...upgraded.objectStoreNames]).toContain('personalSongContent');
    expect([...upgraded.objectStoreNames]).toContain('account');
    expect([...upgraded.objectStoreNames]).toContain('songSubmissions');
    expect([...upgraded.objectStoreNames]).toContain('songSubmissionFiles');
    expect([...upgraded.objectStoreNames]).toContain('offlineAuth');
    expect([...upgraded.objectStoreNames]).toContain('contentPackages');
    expect([...upgraded.objectStoreNames]).toContain('pendingMutations');
    expect([...upgraded.objectStoreNames]).toContain('diagnostics');
    expect([...upgraded.objectStoreNames]).toContain('contentPackageChunks');
    upgraded.close();
  });

  it('uchová ověřenou část knihovny podle hashe a umí odstranit staré části', async () => {
    const databaseModule = await import('./database');
    const keep = 'a'.repeat(64);
    const remove = 'b'.repeat(64);
    await databaseModule.saveCachedContentPackageChunk(keep, new Uint8Array([1, 2, 3]));
    await databaseModule.saveCachedContentPackageChunk(remove, new Uint8Array([4, 5]));
    expect([...await databaseModule.loadCachedContentPackageChunk(keep) ?? []]).toEqual([1, 2, 3]);
    await databaseModule.pruneCachedContentPackageChunks([keep]);
    expect(await databaseModule.loadCachedContentPackageChunk(keep)).not.toBeNull();
    expect(await databaseModule.loadCachedContentPackageChunk(remove)).toBeNull();
  });

  it('uloží místní profil a návrh písně vždy označí ke kontrole', async () => {
    const databaseModule = await import('./database');
    const profile = databaseModule.createUserProfile('Testovací hráč');
    await databaseModule.saveUserProfile(profile);
    expect(await databaseModule.loadUserProfile()).toMatchObject({ displayName: 'Testovací hráč', role: 'member' });

    const submission = await databaseModule.saveSongSubmission({
      profile,
      kind: 'request',
      title: 'Vymyšlená žádost',
      notes: 'Pouze syntetický test',
    });
    expect(submission).toMatchObject({ rightsStatus: 'requires_review', status: 'queued_local' });
    expect(await databaseModule.loadSongSubmissions()).toContainEqual(submission);
  });

  it('uchová offline přihlášení pro další otevření aplikace', async () => {
    const databaseModule = await import('./database');
    const userId = '11111111-1111-4111-8111-111111111111';
    const record = {
      schemaVersion: 1 as const,
      provider: 'neon-auth' as const,
      token: 'synthetic.signed.grant',
      payload: {
        version: 1 as const,
        issuer: 'https://auth.example.test',
        audience: 'https://auth.example.test',
        subject: userId,
        displayName: 'Testovací člen',
        scopes: ['songs:read'],
        contentPackages: ['members'],
        contentVersion: 'abcdef123456',
        issuedAt: '2026-08-11T00:00:00.000Z',
        notBefore: '2026-08-11T00:00:00.000Z',
        offlineValidUntil: '2026-09-10T00:00:00.000Z',
        keyId: 'synthetic-key',
        deviceId: 'synthetic-device',
      },
      profile: {
        id: userId,
        auth_user_id: userId,
        email: 'clen@example.test',
        display_name: 'Testovací člen',
        status: 'approved' as const,
        role: 'member' as const,
        created_at: '2026-08-11T00:00:00.000Z',
        reviewed_at: '2026-08-11T00:00:00.000Z',
        last_seen_at: '2026-08-11T00:00:00.000Z',
      },
      verifiedAt: '2026-08-11T00:00:00.000Z',
    };

    await databaseModule.saveOfflineGrantRecord(record);
    expect(await databaseModule.loadOfflineGrantRecord()).toEqual(record);
  });

  it('uchová obnovovací relaci Neonu bez ukládání hesla', async () => {
    const databaseModule = await import('./database');
    const record = {
      schemaVersion: 1 as const,
      provider: 'neon-auth' as const,
      sessionToken: 'synthetic-opaque-session-token',
      user: {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'obnova@example.test',
        emailVerified: true,
        displayName: 'Obnovený člen',
      },
      savedAt: '2026-08-14T08:00:00.000Z',
    };

    await databaseModule.saveNeonSessionCredential(record);
    expect(await databaseModule.loadNeonSessionCredential()).toEqual(record);
    await databaseModule.clearNeonSessionCredential();
    expect(await databaseModule.loadNeonSessionCredential()).toBeNull();
  });

  it('uloží osobní píseň i její ChordPro obsah odděleně', async () => {
    const databaseModule = await import('./database');
    const song = personalSongFixture('personal-upload-synteticka', 'Syntetický import');
    const content = '[C]Vymyšlená věta';
    await databaseModule.savePersonalSongs([{ song, content }]);
    expect(await databaseModule.loadPersonalSongs()).toContainEqual(song);
    expect(await databaseModule.getPersonalSongContent(song.id)).toBe(content);
  });

  it('uloží a odstraní lokální opravu písně bez změny katalogu', async () => {
    const databaseModule = await import('./database');
    const songId = 'synteticka-lokalni-oprava';
    await databaseModule.saveLocalSongOverride(songId, '[C]Bezpečná syntetická oprava\u0000');
    expect(await databaseModule.getLocalSongOverride(songId)).toBe('[C]Bezpečná syntetická oprava');
    await databaseModule.removeLocalSongOverride(songId);
    expect(await databaseModule.getLocalSongOverride(songId)).toBeNull();
  });

  it('obnoví celou zálohu včetně osobních písní a přepíše jejich cestu na IndexedDB', async () => {
    const databaseModule = await import('./database');
    const song = { ...personalSongFixture('personal-backup-synteticka', 'Píseň ze zálohy'), chordProPath: '/__personal_library/content/personal-backup-synteticka.txt' };
    const file = new File([JSON.stringify({
      application: 'cesky-digitalni-zpevnik',
      backupVersion: 2,
      exportedAt: '2026-08-06T00:00:00.000Z',
      data: legacyState,
      personalSongs: [{ song, content: '[G]Nový\u0000syntetický text' }],
    })], 'zpevnik-zaloha.json', { type: 'application/json' });

    const imported = await databaseModule.importFullBackup(file);
    expect(imported.state.schemaVersion).toBe(7);
    expect(imported.personalSongCount).toBe(1);
    expect(await databaseModule.loadPersonalSongs()).toContainEqual(expect.objectContaining({
      id: song.id,
      chordProPath: `indexeddb:${song.id}`,
    }));
    expect(await databaseModule.getPersonalSongContent(song.id)).toBe('[G]Novýsyntetický text');
  });

  it('atomicky nahradí staženou členskou knihovnu a zachová vlastní PDF importy', async () => {
    const databaseModule = await import('./database');
    const oldDownloaded = {
      ...personalSongFixture('personal-stara-clenska', 'Stará členská píseň'),
      sourceIdentifier: 'songs_data/stary-zpevnik.pdf#page=1',
    };
    const localImport = {
      ...personalSongFixture('personal-vlastni-pdf', 'Vlastní PDF píseň'),
      source: 'Uživatelem nahrané PDF vlastni.pdf',
      sourceIdentifier: 'local-pdf:vlastni.pdf#page=1',
    };
    await databaseModule.savePersonalSongs([
      { song: oldDownloaded, content: '[C]Stará členská věta' },
      { song: localImport, content: '[D]Vlastní věta' },
    ]);

    const newDownloaded = {
      ...personalSongFixture('personal-nova-clenska', 'Nová členská píseň'),
      sourceIdentifier: 'songs_data/novy-zpevnik.pdf#page=1',
    };
    const file = new File([JSON.stringify({
      application: 'cesky-digitalni-zpevnik',
      backupVersion: 2,
      exportedAt: '2026-08-06T00:00:00.000Z',
      libraryScope: 'members',
      data: legacyState,
      personalSongs: [{ song: newDownloaded, content: '[G]Nová členská věta' }],
    })], 'member-library.json', { type: 'application/json' });

    const imported = await databaseModule.importFullBackup(file, {
      replaceDownloadedLibrary: true,
      expectedLibraryScope: 'members',
    });
    const songs = await databaseModule.loadPersonalSongs();
    expect(imported.personalSongCount).toBe(1);
    expect(songs).not.toContainEqual(expect.objectContaining({ id: oldDownloaded.id }));
    expect(songs).toContainEqual(expect.objectContaining({ id: newDownloaded.id }));
    expect(songs).toContainEqual(expect.objectContaining({ id: localImport.id }));
    expect(await databaseModule.getPersonalSongContent(oldDownloaded.id)).toBeNull();
    expect(await databaseModule.getPersonalSongContent(localImport.id)).toBe('[D]Vlastní věta');
  });

  it('odstraní celou staženou členskou knihovnu, ale ponechá vlastní PDF importy', async () => {
    const databaseModule = await import('./database');
    const before = await databaseModule.loadPersonalSongs();
    expect(before).toContainEqual(expect.objectContaining({ id: 'personal-nova-clenska' }));
    expect(before).toContainEqual(expect.objectContaining({ id: 'personal-vlastni-pdf' }));

    expect(await databaseModule.removeDownloadedLibrarySongs()).toBeGreaterThanOrEqual(1);

    const after = await databaseModule.loadPersonalSongs();
    expect(after).not.toContainEqual(expect.objectContaining({ id: 'personal-nova-clenska' }));
    expect(after).toContainEqual(expect.objectContaining({ id: 'personal-vlastni-pdf' }));
  });

  it('načte i starou zálohu bez osobních písní', async () => {
    const databaseModule = await import('./database');
    const file = new File([JSON.stringify({ application: 'cesky-digitalni-zpevnik', data: legacyState })], 'stara-zaloha.json', { type: 'application/json' });
    const imported = await databaseModule.importFullBackup(file);
    expect(imported.state.schemaVersion).toBe(7);
    expect(imported.personalSongCount).toBe(0);
  });

  it('vytvoří, přejmenuje a odstraní soukromý setlist', async () => {
    const databaseModule = await import('./database');
    const created = databaseModule.createSetlist(databaseModule.defaultUserState, '  Večer u ohně  ', 'setlist-test');
    expect(created.setlists).toEqual([expect.objectContaining({ id: 'setlist-test', name: 'Večer u ohně' })]);

    const renamed = databaseModule.renameSetlist(created, 'setlist-test', '  Neděle  ');
    expect(renamed.setlists[0].name).toBe('Neděle');

    const duplicated = databaseModule.duplicateSetlist(renamed, 'setlist-test', 'setlist-kopie');
    expect(duplicated.setlists[1]).toMatchObject({ id: 'setlist-kopie', name: 'Neděle – kopie' });
    expect(duplicated.setlists[1].songIds).not.toBe(duplicated.setlists[0].songIds);

    const removed = databaseModule.removeSetlist(duplicated, 'setlist-test');
    expect(removed.setlists).toHaveLength(1);
  });

  it('explicitně migruje stav schématu 2 pro cloudovou synchronizaci', async () => {
    const databaseModule = await import('./database');
    const versionTwo = { ...legacyState, schemaVersion: 2 as const };
    expect(databaseModule.migrateUserState(versionTwo)).toMatchObject({
      schemaVersion: 7,
      updatedAt: '2026-08-05T00:00:00.000Z',
      favorites: legacyState.favorites,
    });
  });

  it('explicitně migruje stav schématu 3 a doplní trvalé preference čtečky', async () => {
    const databaseModule = await import('./database');
    const versionThree = { ...legacyState, schemaVersion: 3 as const, updatedAt: '2026-08-11T13:00:00.000Z' };
    expect(databaseModule.migrateUserState(versionThree)).toMatchObject({
      schemaVersion: 7,
      updatedAt: versionThree.updatedAt,
      settings: {
        catalogDensity: 'standard',
        reader: { chordScale: 1, lineHeight: 1.3, columnWidth: 760, stageFontSize: legacyState.settings.fontSize },
      },
      songReaderPreferences: {},
    });
  });

  it('explicitně migruje stav schématu 4 a doplní jemný pohyb', async () => {
    const databaseModule = await import('./database');
    const versionFour = {
      ...databaseModule.defaultUserState,
      schemaVersion: 4 as const,
      settings: Object.fromEntries(Object.entries(databaseModule.defaultUserState.settings).filter(([key]) => key !== 'motion')),
    };
    expect(databaseModule.migrateUserState(versionFour)).toMatchObject({
      schemaVersion: 7,
      settings: { motion: 'gentle', accessibility: { highContrast: false, largeControls: false, oneHanded: false } },
    });
  });

  it('explicitně migruje stav schématu 5 a doplní preference přístupnosti', async () => {
    const databaseModule = await import('./database');
    const versionFive = {
      ...databaseModule.defaultUserState,
      schemaVersion: 5 as const,
      settings: Object.fromEntries(Object.entries(databaseModule.defaultUserState.settings).filter(([key]) => key !== 'accessibility')),
    };
    expect(databaseModule.migrateUserState(versionFive)).toMatchObject({
      schemaVersion: 7,
      settings: { accessibility: { highContrast: false, largeControls: false, oneHanded: false } },
    });
  });

  it('explicitně migruje stav schématu 6 a doplní aranžmá pro každou píseň', async () => {
    const databaseModule = await import('./database');
    const currentReader = databaseModule.defaultUserState.settings.reader;
    const readerV6 = {
      chordScale: currentReader.chordScale,
      lineHeight: currentReader.lineHeight,
      columnWidth: currentReader.columnWidth,
      focusSections: currentReader.focusSections,
      wrapLayoutText: currentReader.wrapLayoutText,
      stageFontSize: currentReader.stageFontSize,
    };
    const versionSix = {
      ...databaseModule.defaultUserState,
      schemaVersion: 6 as const,
      settings: { ...databaseModule.defaultUserState.settings, reader: readerV6 },
      songReaderPreferences: {
        'synthetic-song': { chordScale: 1.1, lineHeight: 1.4, columnWidth: 720, focusSections: true, wrapLayoutText: true, stageFontSize: 28 },
      },
    };

    expect(databaseModule.migrateUserState(versionSix)).toMatchObject({
      schemaVersion: 7,
      settings: { reader: { transpose: 0, capoFret: 0, autoScrollSpeed: 25 } },
      songReaderPreferences: {
        'synthetic-song': { transpose: 0, capoFret: 0, autoScrollSpeed: 25 },
      },
    });
  });

  it('oddělí nový chráněný balíček podle uživatele a aktivuje jej až po importu', async () => {
    const databaseModule = await import('./database');
    const ownerId = '11111111-1111-4111-8111-111111111111';
    const otherId = '22222222-2222-4222-8222-222222222222';
    const song = { ...personalSongFixture('personal-oddeleny-balik', 'Oddělený balíček'), sourceIdentifier: 'songs_data/oddeleny.pdf#page=1' };
    const memberContent = '[C]Oddělená syntetická věta';
    const manifest = {
      schemaVersion: 1 as const,
      scope: 'members' as const,
      version: 'abcdef123456',
      generatedAt: '2026-08-11T00:00:00.000Z',
      songCount: 1,
      contentBytes: new TextEncoder().encode(memberContent).byteLength,
    };
    const file = new File([JSON.stringify({
      application: 'cesky-digitalni-zpevnik',
      libraryScope: 'members',
      data: legacyState,
      personalSongs: [{ song, content: memberContent }],
      libraryManifest: manifest,
    })], 'oddeleny-balik.json', { type: 'application/json' });

    await databaseModule.importFullBackup(file, { replaceDownloadedLibrary: true, expectedLibraryScope: 'members', ownerUserId: ownerId, verifiedManifest: manifest });
    expect(await databaseModule.loadPersonalSongs(ownerId)).toContainEqual(expect.objectContaining({ id: song.id }));
    expect(await databaseModule.loadPersonalSongs(otherId)).not.toContainEqual(expect.objectContaining({ id: song.id }));
    expect(await databaseModule.loadContentPackage(ownerId)).toMatchObject({ ownerUserId: ownerId, integrity: 'verified', songIds: [song.id] });
    expect(await databaseModule.inspectContentPackageIntegrity(ownerId)).toMatchObject({
      expectedSongs: 1,
      completeSongs: 1,
      missingSongs: 0,
      missingContent: 0,
      alteredContent: 0,
      healthy: true,
    });
  });

  it('při poškozeném novém balíčku zachová poslední aktivní obsah', async () => {
    const databaseModule = await import('./database');
    const ownerId = '11111111-1111-4111-8111-111111111111';
    const before = await databaseModule.loadContentPackage(ownerId);
    const corrupt = new File([JSON.stringify({
      application: 'cesky-digitalni-zpevnik',
      libraryScope: 'members',
      data: legacyState,
      personalSongs: [{ song: { id: '../neplatna-cesta' }, content: 'poškozeno' }],
    })], 'poskozeny-balik.json', { type: 'application/json' });
    await expect(databaseModule.importFullBackup(corrupt, { replaceDownloadedLibrary: true, expectedLibraryScope: 'members', ownerUserId: ownerId })).rejects.toThrow();
    expect(await databaseModule.loadContentPackage(ownerId)).toEqual(before);
    expect(await databaseModule.loadPersonalSongs(ownerId)).toContainEqual(expect.objectContaining({ id: 'personal-oddeleny-balik' }));
  });

  it('udržuje idempotentní offline outbox uživatelského stavu', async () => {
    const databaseModule = await import('./database');
    const userId = '11111111-1111-4111-8111-111111111111';
    const first = { schemaVersion: 1 as const, id: '33333333-3333-4333-8333-333333333333', userId, idempotencyKey: `${userId}:first`, kind: 'user-state-upsert' as const, payload: databaseModule.defaultUserState, createdAt: '2026-08-11T00:00:00.000Z', attempts: 0, lastError: null };
    const second = { ...first, id: '44444444-4444-4444-8444-444444444444', idempotencyKey: `${userId}:second`, payload: { ...first.payload, updatedAt: '2026-08-11T00:01:00.000Z' }, createdAt: '2026-08-11T00:01:00.000Z' };
    await databaseModule.enqueuePendingMutation(first);
    await databaseModule.enqueuePendingMutation(second);
    expect(await databaseModule.loadPendingMutations(userId)).toEqual([second]);
    const olderRetry = { ...first, id: '55555555-5555-4555-8555-555555555555', attempts: 1, lastError: 'offline' };
    await databaseModule.enqueuePendingMutation(olderRetry);
    expect(await databaseModule.loadPendingMutations(userId)).toEqual([{ ...second, attempts: 1, lastError: 'offline' }]);
    const failed = await databaseModule.markPendingMutationFailed(second.id, 'server');
    expect(failed).toEqual({ ...second, attempts: 2, lastError: 'server' });
    await databaseModule.removePendingMutation(second.id);
    expect(await databaseModule.loadPendingMutations(userId)).toEqual([]);
  });
});
