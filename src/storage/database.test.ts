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

  it('povýší databázi na verzi 4, převede stav na schéma 3 a zachová uživatelská data', async () => {
    const databaseModule = await import('./database');
    const loaded = await databaseModule.loadUserState();
    expect(databaseModule.DATABASE_VERSION).toBe(4);
    expect(loaded.schemaVersion).toBe(3);
    expect(loaded.updatedAt).toBe('2026-08-05T00:00:00.000Z');
    expect(loaded.favorites).toEqual(legacyState.favorites);
    expect(loaded.setlists).toEqual(legacyState.setlists);
    expect(loaded.settings.autoScrollSpeed).toBe(31);
    const upgraded = await openDB('cesky-zpevnik', 4);
    expect([...upgraded.objectStoreNames]).toContain('metadata');
    expect([...upgraded.objectStoreNames]).toContain('personalSongs');
    expect([...upgraded.objectStoreNames]).toContain('personalSongContent');
    expect([...upgraded.objectStoreNames]).toContain('account');
    expect([...upgraded.objectStoreNames]).toContain('songSubmissions');
    expect([...upgraded.objectStoreNames]).toContain('songSubmissionFiles');
    upgraded.close();
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

  it('uloží osobní píseň i její ChordPro obsah odděleně', async () => {
    const databaseModule = await import('./database');
    const song = personalSongFixture('personal-upload-synteticka', 'Syntetický import');
    const content = '[C]Vymyšlená věta';
    await databaseModule.savePersonalSongs([{ song, content }]);
    expect(await databaseModule.loadPersonalSongs()).toContainEqual(song);
    expect(await databaseModule.getPersonalSongContent(song.id)).toBe(content);
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
    expect(imported.state.schemaVersion).toBe(3);
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
    expect(imported.state.schemaVersion).toBe(3);
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
      schemaVersion: 3,
      updatedAt: '2026-08-05T00:00:00.000Z',
      favorites: legacyState.favorites,
    });
  });
});
