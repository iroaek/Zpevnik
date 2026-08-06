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

  it('povýší databázi na verzi 3, převede stav na schéma 2 a zachová uživatelská data', async () => {
    const databaseModule = await import('./database');
    const loaded = await databaseModule.loadUserState();
    expect(databaseModule.DATABASE_VERSION).toBe(3);
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.favorites).toEqual(legacyState.favorites);
    expect(loaded.setlists).toEqual(legacyState.setlists);
    expect(loaded.settings.autoScrollSpeed).toBe(31);
    const upgraded = await openDB('cesky-zpevnik', 3);
    expect([...upgraded.objectStoreNames]).toContain('metadata');
    expect([...upgraded.objectStoreNames]).toContain('personalSongs');
    expect([...upgraded.objectStoreNames]).toContain('personalSongContent');
    upgraded.close();
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
    expect(imported.state.schemaVersion).toBe(2);
    expect(imported.personalSongCount).toBe(1);
    expect(await databaseModule.loadPersonalSongs()).toContainEqual(expect.objectContaining({
      id: song.id,
      chordProPath: `indexeddb:${song.id}`,
    }));
    expect(await databaseModule.getPersonalSongContent(song.id)).toBe('[G]Novýsyntetický text');
  });

  it('načte i starou zálohu bez osobních písní', async () => {
    const databaseModule = await import('./database');
    const file = new File([JSON.stringify({ application: 'cesky-digitalni-zpevnik', data: legacyState })], 'stara-zaloha.json', { type: 'application/json' });
    const imported = await databaseModule.importFullBackup(file);
    expect(imported.state.schemaVersion).toBe(2);
    expect(imported.personalSongCount).toBe(0);
  });
});
