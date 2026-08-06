import { z } from 'zod';
import { isPublishable, songSchema, type Song } from '../../src/domain/song.js';
import type { PersonalLibrarySnapshot } from './personal-library.js';

export type PrivateLibraryScope = 'admin' | 'members';

export const memberLibraryGrantSchema = z.object({
  schemaVersion: z.literal(1),
  importDirectory: z.string().min(1),
  grantedAt: z.string().datetime(),
  grantedBy: z.string().min(1),
  authorization: z.string().min(1),
  allowedAudience: z.literal('approved_members'),
  allowOfflineDownload: z.literal(true),
  rightsStatus: z.literal('licensed'),
  license: z.string().min(1),
  inputSha256: z.record(z.string().min(1), z.string().regex(/^[a-f0-9]{64}$/)),
});

export type MemberLibraryGrant = z.infer<typeof memberLibraryGrantSchema>;

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

function sameHashes(actual: Record<string, string>, granted: Record<string, string>): boolean {
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const grantedEntries = Object.entries(granted).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(actualEntries) === JSON.stringify(grantedEntries);
}

export function applyMemberLibraryGrant(
  snapshot: PersonalLibrarySnapshot,
  rawGrant: unknown,
): PersonalLibrarySnapshot {
  const grant = memberLibraryGrantSchema.parse(rawGrant);
  if (grant.importDirectory !== snapshot.summary.sourceDirectory) {
    throw new Error(`Členské oprávnění nepatří k importu ${snapshot.summary.sourceDirectory}.`);
  }
  if (!sameHashes(snapshot.summary.inputSha256, grant.inputSha256)) {
    throw new Error('Otisky vstupních dokumentů neodpovídají členskému oprávnění.');
  }

  return {
    ...snapshot,
    catalog: {
      ...snapshot.catalog,
      songs: snapshot.catalog.songs.filter((song) => song.chordsVerified === true).map((song) => ({
        ...song,
        rightsStatus: grant.rightsStatus,
        license: grant.license,
        notes: `${String(song.notes ?? '').trim()} Členské zpřístupnění autorizováno ${grant.grantedAt}; okruh: pouze schválení uživatelé; další šíření není povoleno.`.trim(),
      })),
    },
  };
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
