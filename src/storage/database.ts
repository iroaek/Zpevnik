import { openDB } from 'idb';
import { z } from 'zod';
import type { ChordNotation } from '../domain/chords';
import { sanitizeImportedText } from '../domain/chordpro';
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
  schemaVersion: 2;
  favorites: string[];
  recentSongIds: string[];
  setlists: Setlist[];
  settings: UserSettings;
}

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
export const userStateSchema = z.object({ schemaVersion: z.literal(2), ...userStateFields });

export const defaultUserState: UserState = {
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
};

export interface PersonalSongEntry {
  song: Song;
  content: string;
}

export interface BackupImportResult {
  state: UserState;
  personalSongCount: number;
}

const personalSongEntrySchema = z.object({
  song: songSchema,
  content: z.string().max(2_000_000),
});

const personalSongBackupSchema = z.array(personalSongEntrySchema).max(5_000);

export const DATABASE_VERSION = 3;

const databasePromise = openDB('cesky-zpevnik', DATABASE_VERSION, {
  upgrade(database, oldVersion) {
    if (oldVersion < 1) database.createObjectStore('state');
    if (oldVersion < 2) database.createObjectStore('metadata');
    if (oldVersion < 3) {
      database.createObjectStore('personalSongs');
      database.createObjectStore('personalSongContent');
    }
  },
});

function parseUserState(stored: unknown): UserState | null {
  const current = userStateSchema.safeParse(stored);
  if (current.success) return current.data;
  const legacy = legacyUserStateSchema.safeParse(stored);
  return legacy.success ? { ...legacy.data, schemaVersion: 2 } : null;
}

export async function loadUserState(): Promise<UserState> {
  const database = await databasePromise;
  const stored = await database.get('state', 'current') as unknown;
  return parseUserState(stored) ?? structuredClone(defaultUserState);
}

export async function saveUserState(state: UserState): Promise<void> {
  const validated = userStateSchema.parse(state);
  const database = await databasePromise;
  await database.put('state', validated, 'current');
}

export function addRecent(state: UserState, songId: string): UserState {
  return { ...state, recentSongIds: [songId, ...state.recentSongIds.filter((id) => id !== songId)].slice(0, 30) };
}

export function toggleFavorite(state: UserState, songId: string): UserState {
  const exists = state.favorites.includes(songId);
  return { ...state, favorites: exists ? state.favorites.filter((id) => id !== songId) : [...state.favorites, songId] };
}

export function createSetlist(state: UserState, name: string): UserState {
  const now = new Date().toISOString();
  return {
    ...state,
    setlists: [...state.setlists, { id: crypto.randomUUID(), name: name.trim(), songIds: [], createdAt: now, updatedAt: now }],
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

export async function importFullBackup(file: File): Promise<BackupImportResult> {
  if (file.size > 50 * 1024 * 1024) throw new Error('Záloha je větší než povolených 50 MB.');
  const parsed = JSON.parse(await file.text()) as { application?: string; data?: unknown; personalSongs?: unknown };
  if (parsed.application !== 'cesky-digitalni-zpevnik') throw new Error('Soubor není záloha této aplikace.');
  const state = parseUserState(parsed.data);
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
  await savePersonalSongs(entries);
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
