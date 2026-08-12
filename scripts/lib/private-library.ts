import { z } from 'zod';
import { createHash } from 'node:crypto';
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
  libraryManifest: {
    schemaVersion: 1;
    scope: PrivateLibraryScope;
    version: string;
    generatedAt: string;
    songCount: number;
    contentBytes: number;
  };
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

interface PrivateLibraryEntry {
  song: Song;
  content: string;
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').replace(/[^a-z0-9]+/g, '');
}

function contentBody(value: string): string {
  return value
    .normalize('NFC')
    .split('\n')
    .filter((line) => !/^\s*\{(?:title|artist|chord_notation)\s*:/i.test(line))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function entryQuality(entry: PrivateLibraryEntry): number {
  const author = entry.song.authors[0]?.toLocaleLowerCase('cs') ?? '';
  const specificSource = /songs_data\/(?:zpevnik_[^123]|(?!zpevnik[123]\.pdf)[^/]+)\.pdf/i.test(entry.song.sourceIdentifier);
  const knownAuthor = Boolean(author && !/(?:neuveden|různí interpreti)/.test(author));
  const qualityFlags = (entry.song.reviewFlags ?? []).filter((flag) => flag !== 'possible_duplicate').length;
  return (entry.song.chordsVerified ? 1_000_000 : 0)
    + (qualityFlags === 0 ? 100_000 : -qualityFlags * 10_000)
    + (knownAuthor ? 5_000 : 0)
    + (specificSource ? 1_000 : 0)
    + Math.min(contentBody(entry.content).length, 10_000);
}

function deduplicateExactSongs(entries: PrivateLibraryEntry[]): PrivateLibraryEntry[] {
  const winners = new Map<string, PrivateLibraryEntry>();
  for (const entry of entries) {
    const body = contentBody(entry.content);
    // Krátké shodné nápisy jako „REF“ nejsou dostatečný důkaz duplicity.
    if (body.length < 80) {
      winners.set(`unique:${entry.song.id}`, entry);
      continue;
    }
    const fingerprint = createHash('sha256').update(body).digest('hex');
    const key = `${normalizedTitle(entry.song.title)}:${fingerprint}`;
    const current = winners.get(key);
    if (!current || entryQuality(entry) > entryQuality(current)
      || (entryQuality(entry) === entryQuality(current) && entry.song.sourceIdentifier.localeCompare(current.song.sourceIdentifier, 'cs') < 0)) {
      winners.set(key, entry);
    }
  }
  return [...winners.values()];
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
  const candidates = snapshot.catalog.songs.flatMap((rawSong): PrivateLibraryEntry[] => {
    const parsed = songSchema.parse(rawSong);
    if (scope === 'members' && !isPublishable(parsed)) return [];
    const content = snapshot.contentBySongId.get(parsed.id);
    if (content === undefined) throw new Error(`Chybí obsah písně ${parsed.id}.`);
    const qualityFlags = (parsed.reviewFlags ?? []).filter((flag) => flag !== 'possible_duplicate');
    const compatibilityTags = qualityFlags.map((flag) => `review:${flag}`);
    const song = songSchema.parse({
      ...parsed,
      tags: [...new Set([...parsed.tags, ...compatibilityTags])],
      // Starší nainstalované PWA znaly pouze `possible_duplicate`. Další důvody
      // kontroly ukládáme také do tagů, aby balík zůstal zpětně čitelný.
      reviewFlags: parsed.reviewFlags?.includes('possible_duplicate') ? ['possible_duplicate'] : [],
      personalOnly: true,
      chordProPath: `indexeddb:${parsed.id}`,
      contentBytes: Buffer.byteLength(content, 'utf8'),
    });
    return [{ song, content }];
  });
  const personalSongs = deduplicateExactSongs(candidates);
  const contentBytes = personalSongs.reduce((sum, entry) => sum + Buffer.byteLength(entry.content, 'utf8'), 0);
  const version = createHash('sha256')
    .update(JSON.stringify(personalSongs.map(({ song, content }) => [song.id, song.updatedAt, Buffer.byteLength(content, 'utf8')])))
    .digest('hex')
    .slice(0, 12);

  return {
    application: 'cesky-digitalni-zpevnik',
    backupVersion: 2,
    exportedAt,
    libraryScope: scope,
    libraryManifest: {
      schemaVersion: 1,
      scope,
      version,
      generatedAt: exportedAt,
      songCount: personalSongs.length,
      contentBytes,
    },
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
