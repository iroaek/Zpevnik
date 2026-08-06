import { isPublishable, songSchema, type Song } from '../../src/domain/song.js';
import type { PersonalLibrarySnapshot } from './personal-library.js';

export type PrivateLibraryScope = 'admin' | 'members';

export interface PrivateLibraryBackup {
  application: 'cesky-digitalni-zpevnik';
  backupVersion: 2;
  exportedAt: string;
  libraryScope: PrivateLibraryScope;
  data: {
    schemaVersion: 2;
    favorites: never[];
    recentSongIds: never[];
    setlists: never[];
    settings: {
      theme: 'system';
      fontSize: 20;
      notation: 'czech';
      showChords: true;
      collapseRepeatedChoruses: true;
      printSize: 'A4';
      autoScrollSpeed: 25;
    };
  };
  personalSongs: Array<{ song: Song; content: string }>;
}

export function createPrivateLibraryBackup(
  snapshot: PersonalLibrarySnapshot,
  scope: PrivateLibraryScope,
  exportedAt = new Date().toISOString(),
): PrivateLibraryBackup {
  const personalSongs = snapshot.catalog.songs.flatMap((rawSong) => {
    const parsed = songSchema.parse(rawSong);
    if (scope === 'members' && !isPublishable(parsed)) return [];
    const content = snapshot.contentBySongId.get(parsed.id);
    if (content === undefined) throw new Error(`Chybí obsah písně ${parsed.id}.`);
    const song = songSchema.parse({
      ...parsed,
      personalOnly: true,
      chordProPath: `indexeddb:${parsed.id}`,
      contentBytes: Buffer.byteLength(content, 'utf8'),
    });
    return [{ song, content }];
  });

  return {
    application: 'cesky-digitalni-zpevnik',
    backupVersion: 2,
    exportedAt,
    libraryScope: scope,
    data: {
      schemaVersion: 2,
      favorites: [],
      recentSongIds: [],
      setlists: [],
      settings: {
        theme: 'system',
        fontSize: 20,
        notation: 'czech',
        showChords: true,
        collapseRepeatedChoruses: true,
        printSize: 'A4',
        autoScrollSpeed: 25,
      },
    },
    personalSongs,
  };
}
