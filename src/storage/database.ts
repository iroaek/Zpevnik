import { openDB } from 'idb';
import { z } from 'zod';
import type { ChordNotation } from '../domain/chords';
import { sanitizeImportedText } from '../domain/chordpro';
import { createUuid } from '../domain/browserCompatibility';
import { readBlobText } from '../domain/readBlobBytes';
import { songSchema, type Song } from '../domain/song';

export interface Setlist {
  id: string;
  name: string;
  songIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  notation: ChordNotation;
  showChords: boolean;
  collapseRepeatedChoruses: boolean;
  printSize: 'A4' | 'A5';
  autoScrollSpeed: number;
}

export interface UserState {
  schemaVersion: 3;
  updatedAt: string;
  favorites: string[];
  recentSongIds: string[];
  setlists: Setlist[];
  settings: UserSettings;
}

export interface LibraryManifest {
  schemaVersion: 1;
  scope: 'admin' | 'members';
  version: string;
  generatedAt: string;
  songCount: number;
  contentBytes: number;
  packageBytes?: number;
  sha256?: string;
}

export interface DownloadedLibraryMetadata extends LibraryManifest {
  downloadedAt: string;
}

export interface UserProfile {
  schemaVersion: 1;
  id: string;
  displayName: string;
  role: 'member' | 'admin';
  monochromeMode: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SongSubmission {
  schemaVersion: 1;
  id: string;
  kind: 'request' | 'upload';
  submitterId: string;
  submitterName: string;
  title: string;
  artist: string;
  notes: string;
  fileName: string | null;
  fileType: string | null;
  fileSize: number;
  rightsStatus: 'requires_review';
  license: string;
  attribution: string;
  status: 'queued_local';
  createdAt: string;
}

const songSubmissionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  kind: z.enum(['request', 'upload']),
  submitterId: z.string().uuid(),
  submitterName: z.string().trim().min(2).max(40),
  title: z.string().trim().min(1).max(160),
  artist: z.string().trim().max(160),
  notes: z.string().trim().max(2_000),
  fileName: z.string().max(255).nullable(),
  fileType: z.string().max(120).nullable(),
  fileSize: z.number().int().min(0).max(25 * 1024 * 1024),
  rightsStatus: z.literal('requires_review'),
  license: z.string().min(1),
  attribution: z.string().min(1),
  status: z.literal('queued_local'),
  createdAt: z.string().datetime(),
});

const userProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  displayName: z.string().trim().min(2).max(40),
  role: z.enum(['member', 'admin']),
  monochromeMode: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  fontSize: z.number().min(14).max(34),
  notation: z.enum(['czech', 'international']),
  showChords: z.boolean(),
  collapseRepeatedChoruses: z.boolean(),
  printSize: z.enum(['A4', 'A5']),
  autoScrollSpeed: z.number().min(0).max(100),
});

const userStateFields = {
  favorites: z.array(z.string()),
  recentSongIds: z.array(z.string()).max(30),
  setlists: z.array(z.object({
    id: z.string(),
    name: z.string().min(1).max(100),
    songIds: z.array(z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })),
  settings: settingsSchema,
};

const legacyUserStateSchema = z.object({ schemaVersion: z.literal(1), ...userStateFields });
const userStateV2Schema = z.object({ schemaVersion: z.literal(2), ...userStateFields });
export const userStateSchema = z.object({ schemaVersion: z.literal(3), updatedAt: z.string().datetime(), ...userStateFields });

export const libraryManifestSchema = z.object({
  schemaVersion: z.literal(1),
  scope: z.enum(['admin', 'members']),
  version: z.string().regex(/^[a-f0-9]{12,64}$/),
  generatedAt: z.string().datetime(),
  songCount: z.number().int().nonnegative().max(5_000),
  contentBytes: z.number().int().nonnegative(),
  packageBytes: z.number().int().positive().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

const downloadedLibraryMetadataSchema = libraryManifestSchema.extend({ downloadedAt: z.string().datetime() });

const INITIAL_STATE_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export const defaultUserState: UserState = {
  schemaVersion: 3,
  updatedAt: INITIAL_STATE_UPDATED_AT,
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
};

export interface PersonalSongEntry {
  song: Song;
  content: string;
}

export interface BackupImportResult {
  state: UserState;
  personalSongCount: number;
}

export interface BackupImportOptions {
  replaceDownloadedLibrary?: boolean;
  expectedLibraryScope?: 'admin' | 'members';
}

const personalSongEntrySchema = z.object({
  song: songSchema,
  content: z.string().max(2_000_000),
});

const personalSongBackupSchema = z.array(personalSongEntrySchema).max(5_000);

export const DATABASE_VERSION = 4;

const databasePromise = openDB('cesky-zpevnik', DATABASE_VERSION, {
  upgrade(database, oldVersion) {
    if (oldVersion < 1) database.createObjectStore('state');
    if (oldVersion < 2) database.createObjectStore('metadata');
    if (oldVersion < 3) {
      database.createObjectStore('personalSongs');
      database.createObjectStore('personalSongContent');
    }
    if (oldVersion < 4) {
      database.createObjectStore('account');
      database.createObjectStore('songSubmissions');
      database.createObjectStore('songSubmissionFiles');
    }
  },
});

export function createUserProfile(displayName: string, identity?: { id: string; role: UserProfile['role'] }): UserProfile {
  const now = new Date().toISOString();
  return userProfileSchema.parse({
    schemaVersion: 1,
    id: identity?.id ?? createUuid(),
    displayName: displayName.trim(),
    role: identity?.role ?? 'member',
    monochromeMode: identity?.role === 'admin',
    createdAt: now,
    updatedAt: now,
  });
}

export async function loadUserProfile(): Promise<UserProfile | null> {
  const database = await databasePromise;
  const parsed = userProfileSchema.safeParse(await database.get('account', 'profile'));
  return parsed.success ? parsed.data : null;
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const validated = userProfileSchema.parse({ ...profile, updatedAt: new Date().toISOString() });
  const database = await databasePromise;
  await database.put('account', validated, 'profile');
}

export async function saveSongSubmission(input: {
  profile: UserProfile;
  kind: 'request' | 'upload';
  title: string;
  artist?: string;
  notes?: string;
  file?: File;
}): Promise<SongSubmission> {
  if (input.kind === 'upload' && !input.file) throw new Error('Vyberte soubor s písní.');
  if (input.file && input.file.size > 25 * 1024 * 1024) throw new Error('Soubor je větší než povolených 25 MB.');
  const submission = songSubmissionSchema.parse({
    schemaVersion: 1,
    id: createUuid(),
    kind: input.kind,
    submitterId: input.profile.id,
    submitterName: input.profile.displayName,
    title: input.title,
    artist: input.artist ?? '',
    notes: input.notes ?? '',
    fileName: input.file?.name ?? null,
    fileType: input.file?.type || null,
    fileSize: input.file?.size ?? 0,
    rightsStatus: 'requires_review',
    license: 'UNVERIFIED - requires admin review',
    attribution: input.profile.displayName,
    status: 'queued_local',
    createdAt: new Date().toISOString(),
  });
  const database = await databasePromise;
  const transaction = database.transaction(['songSubmissions', 'songSubmissionFiles'], 'readwrite');
  await transaction.objectStore('songSubmissions').put(submission, submission.id);
  if (input.file) await transaction.objectStore('songSubmissionFiles').put(input.file, submission.id);
  await transaction.done;
  return submission;
}

export async function loadSongSubmissions(): Promise<SongSubmission[]> {
  const database = await databasePromise;
  const stored = await database.getAll('songSubmissions') as unknown[];
  return stored.flatMap((value) => {
    const parsed = songSubmissionSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function migrateUserState(stored: unknown): UserState | null {
  const current = userStateSchema.safeParse(stored);
  if (current.success) return current.data;
  const versionTwo = userStateV2Schema.safeParse(stored);
  if (versionTwo.success) return { ...versionTwo.data, schemaVersion: 3, updatedAt: versionTwo.data.setlists.reduce((latest, setlist) => setlist.updatedAt > latest ? setlist.updatedAt : latest, INITIAL_STATE_UPDATED_AT) };
  const legacy = legacyUserStateSchema.safeParse(stored);
  return legacy.success ? { ...legacy.data, schemaVersion: 3, updatedAt: legacy.data.setlists.reduce((latest, setlist) => setlist.updatedAt > latest ? setlist.updatedAt : latest, INITIAL_STATE_UPDATED_AT) } : null;
}

export async function loadUserState(): Promise<UserState> {
  const database = await databasePromise;
  const stored = await database.get('state', 'current') as unknown;
  return migrateUserState(stored) ?? {
    ...defaultUserState,
    favorites: [],
    recentSongIds: [],
    setlists: [],
    settings: { ...defaultUserState.settings },
  };
}

export async function saveUserState(state: UserState): Promise<void> {
  const validated = userStateSchema.parse(state);
  const database = await databasePromise;
  await database.put('state', validated, 'current');
}

export async function loadDownloadedLibraryMetadata(): Promise<DownloadedLibraryMetadata | null> {
  const database = await databasePromise;
  const parsed = downloadedLibraryMetadataSchema.safeParse(await database.get('metadata', 'downloadedLibrary'));
  return parsed.success ? parsed.data : null;
}

export async function saveDownloadedLibraryMetadata(manifest: LibraryManifest): Promise<DownloadedLibraryMetadata> {
  const metadata = downloadedLibraryMetadataSchema.parse({ ...manifest, downloadedAt: new Date().toISOString() });
  const database = await databasePromise;
  await database.put('metadata', metadata, 'downloadedLibrary');
  return metadata;
}

export async function clearDownloadedLibraryMetadata(): Promise<void> {
  const database = await databasePromise;
  await database.delete('metadata', 'downloadedLibrary');
}

export function addRecent(state: UserState, songId: string): UserState {
  return { ...state, recentSongIds: [songId, ...state.recentSongIds.filter((id) => id !== songId)].slice(0, 30) };
}

export function toggleFavorite(state: UserState, songId: string): UserState {
  const exists = state.favorites.includes(songId);
  return { ...state, favorites: exists ? state.favorites.filter((id) => id !== songId) : [...state.favorites, songId] };
}

export function createSetlist(state: UserState, name: string, id = createUuid()): UserState {
  const now = new Date().toISOString();
  return {
    ...state,
    setlists: [...state.setlists, { id, name: name.trim(), songIds: [], createdAt: now, updatedAt: now }],
  };
}

export function renameSetlist(state: UserState, setlistId: string, name: string): UserState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    setlists: state.setlists.map((setlist) => setlist.id === setlistId
      ? { ...setlist, name: trimmed, updatedAt: new Date().toISOString() }
      : setlist),
  };
}

export function removeSetlist(state: UserState, setlistId: string): UserState {
  return { ...state, setlists: state.setlists.filter((setlist) => setlist.id !== setlistId) };
}

export function duplicateSetlist(state: UserState, setlistId: string, id = createUuid()): UserState {
  const source = state.setlists.find((setlist) => setlist.id === setlistId);
  if (!source) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    setlists: [...state.setlists, {
      ...source,
      id,
      name: `${source.name} – kopie`,
      songIds: [...source.songIds],
      createdAt: now,
      updatedAt: now,
    }],
  };
}

export function updateSetlistSongs(state: UserState, setlistId: string, songIds: string[]): UserState {
  return {
    ...state,
    setlists: state.setlists.map((setlist) => setlist.id === setlistId
      ? { ...setlist, songIds, updatedAt: new Date().toISOString() }
      : setlist),
  };
}

async function readPersonalSongContent(song: Song): Promise<string> {
  if (song.chordProPath.startsWith('indexeddb:')) {
    const content = await getPersonalSongContent(song.id);
    if (content === null) throw new Error(`Chybí obsah osobní písně „${song.title}“.`);
    return content;
  }
  if (!song.personalOnly) throw new Error(`Píseň „${song.title}“ není osobní.`);
  const response = await fetch(song.chordProPath, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Obsah osobní písně „${song.title}“ se nepodařilo načíst.`);
  return response.text();
}

function downloadBackup(payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `zpevnik-zaloha-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function exportFullBackup(state: UserState, personalSongs: Song[]): Promise<number> {
  const validatedState = userStateSchema.parse(state);
  const uniqueSongs = [...new Map(personalSongs.filter((song) => song.personalOnly).map((song) => [song.id, song])).values()];
  const entries = await Promise.all(uniqueSongs.map(async (song) => {
    const content = sanitizeImportedText(await readPersonalSongContent(song));
    return personalSongEntrySchema.parse({
      song: {
        ...song,
        personalOnly: true,
        chordProPath: `indexeddb:${song.id}`,
        contentBytes: new TextEncoder().encode(content).byteLength,
      },
      content,
    });
  }));
  downloadBackup({
    application: 'cesky-digitalni-zpevnik',
    backupVersion: 2,
    exportedAt: new Date().toISOString(),
    data: validatedState,
    personalSongs: entries,
  });
  return entries.length;
}

export function isDownloadedLibrarySong(song: Song): boolean {
  return song.personalOnly === true
    && song.sourceIdentifier.replace(/\\/g, '/').startsWith('songs_data/');
}

export async function importFullBackup(file: Blob, options: BackupImportOptions = {}): Promise<BackupImportResult> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Záloha je větší než povolených 50 MB.');
  const parsed = JSON.parse(await readBlobText(file)) as { application?: string; data?: unknown; personalSongs?: unknown; libraryScope?: unknown; libraryManifest?: unknown };
  if (parsed.application !== 'cesky-digitalni-zpevnik') throw new Error('Soubor není záloha této aplikace.');
  if (options.expectedLibraryScope && parsed.libraryScope !== options.expectedLibraryScope) {
    throw new Error('Stažený balíček neodpovídá oprávnění tohoto účtu.');
  }
  const state = migrateUserState(parsed.data);
  if (!state) throw new Error('Záloha má nepodporovaný nebo poškozený formát.');
  const parsedEntries = personalSongBackupSchema.safeParse(parsed.personalSongs ?? []);
  if (!parsedEntries.success) throw new Error('Záloha obsahuje neplatné osobní písně.');
  const entries = parsedEntries.data.map(({ song, content }) => {
    const sanitized = sanitizeImportedText(content);
    return {
      song: songSchema.parse({
        ...song,
        personalOnly: true,
        chordProPath: `indexeddb:${song.id}`,
        contentBytes: new TextEncoder().encode(sanitized).byteLength,
      }),
      content: sanitized,
    };
  });
  if (options.replaceDownloadedLibrary) {
    if (entries.some(({ song }) => !isDownloadedLibrarySong(song))) {
      throw new Error('Stažený balíček obsahuje píseň s neplatným původem.');
    }
    const database = await databasePromise;
    const stored = await database.getAll('personalSongs') as unknown[];
    const oldIds = stored.flatMap((value) => {
      const parsedSong = songSchema.safeParse(value);
      return parsedSong.success && isDownloadedLibrarySong(parsedSong.data) ? [parsedSong.data.id] : [];
    });
    const transaction = database.transaction(['personalSongs', 'personalSongContent'], 'readwrite');
    for (const songId of oldIds) {
      await transaction.objectStore('personalSongs').delete(songId);
      await transaction.objectStore('personalSongContent').delete(songId);
    }
    for (const entry of entries) {
      await transaction.objectStore('personalSongs').put(entry.song, entry.song.id);
      await transaction.objectStore('personalSongContent').put(entry.content, entry.song.id);
    }
    await transaction.done;
    const manifest = libraryManifestSchema.safeParse(parsed.libraryManifest);
    if (manifest.success) await saveDownloadedLibraryMetadata(manifest.data);
  } else {
    await savePersonalSongs(entries);
  }
  return { state, personalSongCount: entries.length };
}

export async function loadPersonalSongs(): Promise<Song[]> {
  const database = await databasePromise;
  const stored = await database.getAll('personalSongs') as unknown[];
  return stored.flatMap((value) => {
    const parsed = songSchema.safeParse(value);
    return parsed.success && parsed.data.personalOnly ? [parsed.data] : [];
  });
}

export async function savePersonalSongs(entries: PersonalSongEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const validated = entries.map(({ song, content }) => ({ song: songSchema.parse(song), content }));
  const database = await databasePromise;
  const transaction = database.transaction(['personalSongs', 'personalSongContent'], 'readwrite');
  for (const entry of validated) {
    await transaction.objectStore('personalSongs').put(entry.song, entry.song.id);
    await transaction.objectStore('personalSongContent').put(entry.content, entry.song.id);
  }
  await transaction.done;
}

export async function getPersonalSongContent(songId: string): Promise<string | null> {
  const database = await databasePromise;
  const content = await database.get('personalSongContent', songId) as unknown;
  return typeof content === 'string' ? content : null;
}

export async function removePersonalSong(songId: string): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(['personalSongs', 'personalSongContent'], 'readwrite');
  await transaction.objectStore('personalSongs').delete(songId);
  await transaction.objectStore('personalSongContent').delete(songId);
  await transaction.done;
}

export async function removeDownloadedLibrarySongs(): Promise<number> {
  const database = await databasePromise;
  const stored = await database.getAll('personalSongs') as unknown[];
  const songIds = stored.flatMap((value) => {
    const parsed = songSchema.safeParse(value);
    return parsed.success && isDownloadedLibrarySong(parsed.data) ? [parsed.data.id] : [];
  });
  if (songIds.length === 0) {
    await clearDownloadedLibraryMetadata();
    return 0;
  }
  const transaction = database.transaction(['personalSongs', 'personalSongContent'], 'readwrite');
  for (const songId of songIds) {
    await transaction.objectStore('personalSongs').delete(songId);
    await transaction.objectStore('personalSongContent').delete(songId);
  }
  await transaction.done;
  await clearDownloadedLibraryMetadata();
  return songIds.length;
}
