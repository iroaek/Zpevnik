import { openDB } from 'idb';
import { z } from 'zod';
import { normalizeSharpSpelling, type ChordNotation } from '../domain/chords';
import { sanitizeImportedText } from '../domain/chordpro';
import { createUuid } from '../domain/browserCompatibility';
import { readBlobText } from '../domain/readBlobBytes';
import { songSchema, type Song } from '../domain/song';
import type { NeonOfflineKeySet, OfflineGrantPayload } from '../auth/offlineGrant';
import type { SecureProfile } from '../auth/secureAccess';

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
  catalogDensity: CatalogDensity;
  motion: 'full' | 'gentle' | 'off';
  accessibility: AccessibilityPreferences;
  reader: ReaderPreferences;
}

export type CatalogDensity = 'stage' | 'standard' | 'compact';

export interface AccessibilityPreferences {
  highContrast: boolean;
  largeControls: boolean;
  oneHanded: boolean;
}

export interface ReaderPreferences {
  chordScale: number;
  lineHeight: number;
  columnWidth: number;
  focusSections: boolean;
  wrapLayoutText: boolean;
  stageFontSize: number;
  transpose: number;
  capoFret: number;
  autoScrollSpeed: number;
}

export interface UserState {
  schemaVersion: 7;
  updatedAt: string;
  favorites: string[];
  recentSongIds: string[];
  setlists: Setlist[];
  settings: UserSettings;
  songReaderPreferences: Record<string, ReaderPreferences>;
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

export interface StoredOfflineGrantRecord {
  schemaVersion: 1;
  provider?: 'legacy' | 'neon-auth';
  token: string;
  payload: OfflineGrantPayload;
  profile: SecureProfile;
  verifiedAt: string;
  keySet?: NeonOfflineKeySet;
}

export interface StoredNeonSessionCredential {
  schemaVersion: 1;
  provider: 'neon-auth';
  sessionToken: string;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    displayName: string;
  };
  savedAt: string;
}

const storedNeonSessionCredentialSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.literal('neon-auth'),
  sessionToken: z.string().min(16).max(16_384),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    emailVerified: z.boolean(),
    displayName: z.string().trim().min(1).max(120),
  }),
  savedAt: z.string().datetime({ offset: true }),
});

export interface ContentPackageRecord {
  schemaVersion: 1;
  packageId: string;
  ownerUserId: string;
  manifest: LibraryManifest;
  songIds: string[];
  /** UTF-8 délky po normalizaci; starší balíčky je doplní při příští obnově. */
  contentLengths?: Record<string, number>;
  activatedAt: string;
  integrity: 'verified';
}

export interface ContentPackageIntegrity {
  expectedSongs: number;
  indexedSongs: number;
  completeSongs: number;
  missingSongs: number;
  invalidSongs: number;
  missingContent: number;
  alteredContent: number;
  availableBytes: number;
  expectedBytes: number;
  healthy: boolean;
}

interface CachedContentPackageChunk {
  schemaVersion: 1;
  sha256: string;
  bytes: ArrayBuffer;
  storedAt: string;
}

export interface PendingMutation {
  schemaVersion: 1;
  id: string;
  userId: string;
  idempotencyKey: string;
  kind: 'user-state-upsert';
  payload: UserState;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

export interface DiagnosticEvent {
  schemaVersion: 1;
  id: string;
  category: 'auth' | 'sync' | 'storage' | 'pwa';
  event: string;
  level: 'info' | 'warning' | 'error';
  occurredAt: string;
  details?: Record<string, string | number | boolean | null>;
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

const legacySettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  fontSize: z.number().min(14).max(34),
  notation: z.enum(['czech', 'international']),
  showChords: z.boolean(),
  collapseRepeatedChoruses: z.boolean(),
  printSize: z.enum(['A4', 'A5']),
  autoScrollSpeed: z.number().min(0).max(100),
});

const readerPreferencesV6Schema = z.object({
  chordScale: z.number().min(0.75).max(1.4),
  lineHeight: z.number().min(1.15).max(1.8),
  columnWidth: z.number().int().min(320).max(980),
  focusSections: z.boolean(),
  wrapLayoutText: z.boolean(),
  stageFontSize: z.number().int().min(14).max(40),
});

const readerPreferencesSchema = readerPreferencesV6Schema.extend({
  transpose: z.number().int().min(-12).max(12),
  capoFret: z.number().int().min(0).max(11),
  autoScrollSpeed: z.number().min(5).max(100),
});

const settingsV4Schema = legacySettingsSchema.extend({
  catalogDensity: z.enum(['stage', 'standard', 'compact']),
  reader: readerPreferencesV6Schema,
});

const settingsV5Schema = settingsV4Schema.extend({
  motion: z.enum(['full', 'gentle', 'off']),
});

const accessibilityPreferencesSchema = z.object({
  highContrast: z.boolean(),
  largeControls: z.boolean(),
  oneHanded: z.boolean(),
});

const settingsV6Schema = settingsV5Schema.extend({
  accessibility: accessibilityPreferencesSchema,
});

const settingsSchema = settingsV6Schema.extend({ reader: readerPreferencesSchema });

const legacyUserStateFields = {
  favorites: z.array(z.string()),
  recentSongIds: z.array(z.string()).max(30),
  setlists: z.array(z.object({
    id: z.string(),
    name: z.string().min(1).max(100),
    songIds: z.array(z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })),
  settings: legacySettingsSchema,
};

const legacyUserStateSchema = z.object({ schemaVersion: z.literal(1), ...legacyUserStateFields });
const userStateV2Schema = z.object({ schemaVersion: z.literal(2), ...legacyUserStateFields });
const userStateV3Schema = z.object({ schemaVersion: z.literal(3), updatedAt: z.string().datetime(), ...legacyUserStateFields });
const userStateV4Schema = z.object({
  schemaVersion: z.literal(4),
  updatedAt: z.string().datetime(),
  favorites: legacyUserStateFields.favorites,
  recentSongIds: legacyUserStateFields.recentSongIds,
  setlists: legacyUserStateFields.setlists,
  settings: settingsV4Schema,
  songReaderPreferences: z.record(z.string().min(1).max(200), readerPreferencesV6Schema).refine((value) => Object.keys(value).length <= 250, 'Příliš mnoho nastavení jednotlivých písní.'),
});
const userStateV5Schema = z.object({
  schemaVersion: z.literal(5),
  updatedAt: z.string().datetime(),
  favorites: legacyUserStateFields.favorites,
  recentSongIds: legacyUserStateFields.recentSongIds,
  setlists: legacyUserStateFields.setlists,
  settings: settingsV5Schema,
  songReaderPreferences: z.record(z.string().min(1).max(200), readerPreferencesV6Schema).refine((value) => Object.keys(value).length <= 250, 'Příliš mnoho nastavení jednotlivých písní.'),
});
const userStateV6Schema = z.object({
  schemaVersion: z.literal(6),
  updatedAt: z.string().datetime(),
  favorites: legacyUserStateFields.favorites,
  recentSongIds: legacyUserStateFields.recentSongIds,
  setlists: legacyUserStateFields.setlists,
  settings: settingsV6Schema,
  songReaderPreferences: z.record(z.string().min(1).max(200), readerPreferencesV6Schema).refine((value) => Object.keys(value).length <= 250, 'Příliš mnoho nastavení jednotlivých písní.'),
});
export const userStateSchema = z.object({
  schemaVersion: z.literal(7),
  updatedAt: z.string().datetime(),
  favorites: legacyUserStateFields.favorites,
  recentSongIds: legacyUserStateFields.recentSongIds,
  setlists: legacyUserStateFields.setlists,
  settings: settingsSchema,
  songReaderPreferences: z.record(z.string().min(1).max(200), readerPreferencesSchema).refine((value) => Object.keys(value).length <= 250, 'Příliš mnoho nastavení jednotlivých písní.'),
});

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

const pendingMutationSchema: z.ZodType<PendingMutation> = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  userId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
  kind: z.literal('user-state-upsert'),
  payload: userStateSchema,
  createdAt: z.string().datetime(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().max(500).nullable(),
});

const diagnosticEventSchema: z.ZodType<DiagnosticEvent> = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  category: z.enum(['auth', 'sync', 'storage', 'pwa']),
  event: z.string().min(1).max(120),
  level: z.enum(['info', 'warning', 'error']),
  occurredAt: z.string().datetime(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const INITIAL_STATE_UPDATED_AT = '1970-01-01T00:00:00.000Z';

export const defaultUserState: UserState = {
  schemaVersion: 7,
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
    catalogDensity: 'standard',
    motion: 'gentle',
    accessibility: {
      highContrast: false,
      largeControls: false,
      oneHanded: false,
    },
    reader: {
      chordScale: 1,
      lineHeight: 1.3,
      columnWidth: 760,
      focusSections: false,
      wrapLayoutText: true,
      stageFontSize: 24,
      transpose: 0,
      capoFret: 0,
      autoScrollSpeed: 25,
    },
  },
  songReaderPreferences: {},
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
  ownerUserId?: string;
  verifiedManifest?: LibraryManifest;
}

const personalSongEntrySchema = z.object({
  song: songSchema,
  content: z.string().max(2_000_000),
});

const personalSongBackupSchema = z.array(personalSongEntrySchema).max(5_000);

export const DATABASE_VERSION = 9;

const databasePromise = openDB('cesky-zpevnik', DATABASE_VERSION, {
  async upgrade(database, oldVersion, _newVersion, transaction) {
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
    if (oldVersion < 5) {
      database.createObjectStore('offlineAuth');
      database.createObjectStore('contentPackages');
      database.createObjectStore('pendingMutations');
      database.createObjectStore('diagnostics');
    }
    // Verze 6 rozšiřuje synchronizovaný stav o nastavení čtečky. Samotná data
    // se převádějí přes migrateUserState při prvním načtení a poté se uloží
    // jako schéma 4; žádný nový objektový store není potřeba.
    if (oldVersion < 7) {
      // Verze 7 doplňuje volbu intenzity pohybu. Stav se převádí přímo
      // v transakci upgradu, aby už první vykreslení používalo platné schéma 5.
      const stateStore = transaction.objectStore('state');
      const stored = await stateStore.get('current') as unknown;
      const migrated = migrateUserState(stored);
      if (migrated) await stateStore.put(migrated, 'current');
    }
    if (oldVersion < 8) {
      // Obsahově adresované části členské knihovny umožní při další verzi
      // stáhnout jen změněné bloky. Aktivní knihovna zůstává v původních
      // storech a je přepnuta až po ověření celého výsledku.
      database.createObjectStore('contentPackageChunks');
    }
    if (oldVersion < 9) {
      // Verze 9 ukládá osobní aranž písně (tóninu, kapodastr a rychlost)
      // do synchronizovaného stavu. Převod je čistě datový a zachovává store.
      const stateStore = transaction.objectStore('state');
      const stored = await stateStore.get('current') as unknown;
      const migrated = migrateUserState(stored);
      if (migrated) await stateStore.put(migrated, 'current');
    }
  },
  blocked() {
    window.dispatchEvent(new CustomEvent('zpevnik:database-blocked'));
  },
  blocking(_currentVersion, _blockedVersion, event) {
    // Novější verze aplikace může provést bezpečnou migraci až po uzavření
    // starého spojení v tomto okně. Samotná data se tím nemažou.
    (event.target as IDBDatabase | null)?.close();
    window.dispatchEvent(new CustomEvent('zpevnik:database-upgrade-requested'));
  },
  terminated() {
    window.dispatchEvent(new CustomEvent('zpevnik:database-terminated'));
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

function migrateReaderPreferences(preferences: z.infer<typeof readerPreferencesV6Schema>): ReaderPreferences {
  return {
    ...preferences,
    transpose: 0,
    capoFret: 0,
    autoScrollSpeed: defaultUserState.settings.autoScrollSpeed,
  };
}

function migrateSongReaderPreferences(preferences: Record<string, z.infer<typeof readerPreferencesV6Schema>>): Record<string, ReaderPreferences> {
  return Object.fromEntries(Object.entries(preferences).map(([songId, value]) => [songId, migrateReaderPreferences(value)]));
}

export function migrateUserState(stored: unknown): UserState | null {
  const current = userStateSchema.safeParse(stored);
  if (current.success) return current.data;
  const versionSix = userStateV6Schema.safeParse(stored);
  if (versionSix.success) return {
    ...versionSix.data,
    schemaVersion: 7,
    settings: { ...versionSix.data.settings, reader: migrateReaderPreferences(versionSix.data.settings.reader) },
    songReaderPreferences: migrateSongReaderPreferences(versionSix.data.songReaderPreferences),
  };
  const versionFive = userStateV5Schema.safeParse(stored);
  if (versionFive.success) return {
    ...versionFive.data,
    schemaVersion: 7,
    settings: { ...versionFive.data.settings, accessibility: { ...defaultUserState.settings.accessibility }, reader: migrateReaderPreferences(versionFive.data.settings.reader) },
    songReaderPreferences: migrateSongReaderPreferences(versionFive.data.songReaderPreferences),
  };
  const versionFour = userStateV4Schema.safeParse(stored);
  if (versionFour.success) return {
    ...versionFour.data,
    schemaVersion: 7,
    settings: { ...versionFour.data.settings, motion: defaultUserState.settings.motion, accessibility: { ...defaultUserState.settings.accessibility }, reader: migrateReaderPreferences(versionFour.data.settings.reader) },
    songReaderPreferences: migrateSongReaderPreferences(versionFour.data.songReaderPreferences),
  };
  const versionThree = userStateV3Schema.safeParse(stored);
  if (versionThree.success) return {
    ...versionThree.data,
    schemaVersion: 7,
    settings: {
      ...versionThree.data.settings,
      catalogDensity: defaultUserState.settings.catalogDensity,
      motion: defaultUserState.settings.motion,
      accessibility: { ...defaultUserState.settings.accessibility },
      reader: { ...defaultUserState.settings.reader, stageFontSize: versionThree.data.settings.fontSize },
    },
    songReaderPreferences: {},
  };
  const versionTwo = userStateV2Schema.safeParse(stored);
  if (versionTwo.success) return {
    ...versionTwo.data,
    schemaVersion: 7,
    updatedAt: versionTwo.data.setlists.reduce((latest, setlist) => setlist.updatedAt > latest ? setlist.updatedAt : latest, INITIAL_STATE_UPDATED_AT),
    settings: {
      ...versionTwo.data.settings,
      catalogDensity: defaultUserState.settings.catalogDensity,
      motion: defaultUserState.settings.motion,
      accessibility: { ...defaultUserState.settings.accessibility },
      reader: { ...defaultUserState.settings.reader, stageFontSize: versionTwo.data.settings.fontSize },
    },
    songReaderPreferences: {},
  };
  const legacy = legacyUserStateSchema.safeParse(stored);
  return legacy.success ? {
    ...legacy.data,
    schemaVersion: 7,
    updatedAt: legacy.data.setlists.reduce((latest, setlist) => setlist.updatedAt > latest ? setlist.updatedAt : latest, INITIAL_STATE_UPDATED_AT),
    settings: {
      ...legacy.data.settings,
      catalogDensity: defaultUserState.settings.catalogDensity,
      motion: defaultUserState.settings.motion,
      accessibility: { ...defaultUserState.settings.accessibility },
      reader: { ...defaultUserState.settings.reader, stageFontSize: legacy.data.settings.fontSize },
    },
    songReaderPreferences: {},
  } : null;
}

export async function loadUserState(): Promise<UserState> {
  const database = await databasePromise;
  const stored = await database.get('state', 'current') as unknown;
  return migrateUserState(stored) ?? {
    ...defaultUserState,
    favorites: [],
    recentSongIds: [],
    setlists: [],
    settings: { ...defaultUserState.settings, reader: { ...defaultUserState.settings.reader } },
    songReaderPreferences: {},
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

export async function getOrCreateDeviceId(): Promise<string> {
  const database = await databasePromise;
  const stored = await database.get('metadata', 'deviceId');
  if (typeof stored === 'string' && stored.length >= 8) return stored;
  const deviceId = createUuid();
  await database.put('metadata', deviceId, 'deviceId');
  return deviceId;
}

export async function loadOfflineGrantRecord(): Promise<StoredOfflineGrantRecord | null> {
  const database = await databasePromise;
  const stored = await database.get('offlineAuth', 'current') as Partial<StoredOfflineGrantRecord> | undefined;
  if (!stored || stored.schemaVersion !== 1 || typeof stored.token !== 'string' || typeof stored.verifiedAt !== 'string') return null;
  return stored as StoredOfflineGrantRecord;
}

export async function saveOfflineGrantRecord(record: StoredOfflineGrantRecord): Promise<void> {
  if (record.schemaVersion !== 1 || !record.token || !record.payload?.subject || !record.profile?.id) {
    throw new Error('Offline oprávnění má neplatný lokální formát.');
  }
  const database = await databasePromise;
  await database.put('offlineAuth', record, 'current');
}

export async function clearOfflineGrantRecord(): Promise<void> {
  const database = await databasePromise;
  await database.delete('offlineAuth', 'current');
}

export async function loadNeonSessionCredential(): Promise<StoredNeonSessionCredential | null> {
  const database = await databasePromise;
  const parsed = storedNeonSessionCredentialSchema.safeParse(await database.get('account', 'neonSession'));
  return parsed.success ? parsed.data : null;
}

export async function saveNeonSessionCredential(record: StoredNeonSessionCredential): Promise<void> {
  const validated = storedNeonSessionCredentialSchema.parse(record);
  const database = await databasePromise;
  await database.put('account', validated, 'neonSession');
}

export async function clearNeonSessionCredential(): Promise<void> {
  const database = await databasePromise;
  await database.delete('account', 'neonSession');
}

export async function loadCachedContentPackageChunk(sha256: string): Promise<Uint8Array | null> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) return null;
  const database = await databasePromise;
  const stored = await database.get('contentPackageChunks', sha256) as Partial<CachedContentPackageChunk> | undefined;
  if (!stored || stored.schemaVersion !== 1 || stored.sha256 !== sha256 || !(stored.bytes instanceof ArrayBuffer)) return null;
  return new Uint8Array(stored.bytes.slice(0));
}

export async function saveCachedContentPackageChunk(sha256: string, bytes: Uint8Array): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(sha256) || bytes.byteLength === 0) throw new Error('Část knihovny má neplatný lokální formát.');
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const record: CachedContentPackageChunk = {
    schemaVersion: 1,
    sha256,
    bytes: copy.buffer,
    storedAt: new Date().toISOString(),
  };
  const database = await databasePromise;
  await database.put('contentPackageChunks', record, sha256);
}

export async function pruneCachedContentPackageChunks(keepSha256: string[]): Promise<void> {
  const keep = new Set(keepSha256);
  const database = await databasePromise;
  const transaction = database.transaction('contentPackageChunks', 'readwrite');
  for (const key of await transaction.store.getAllKeys()) {
    if (typeof key === 'string' && !keep.has(key)) await transaction.store.delete(key);
  }
  await transaction.done;
}

export async function loadContentPackage(userId: string): Promise<ContentPackageRecord | null> {
  const database = await databasePromise;
  const stored = await database.get('contentPackages', userId) as Partial<ContentPackageRecord> | undefined;
  const manifest = libraryManifestSchema.safeParse(stored?.manifest);
  if (!stored || stored.schemaVersion !== 1 || stored.ownerUserId !== userId || stored.integrity !== 'verified' || !manifest.success || !Array.isArray(stored.songIds)) return null;
  return { ...stored, manifest: manifest.data } as ContentPackageRecord;
}

export async function saveContentPackage(record: ContentPackageRecord): Promise<void> {
  libraryManifestSchema.parse(record.manifest);
  if (record.schemaVersion !== 1 || record.integrity !== 'verified' || record.ownerUserId.length < 8) throw new Error('Neplatný záznam obsahového balíčku.');
  const database = await databasePromise;
  await database.put('contentPackages', record, record.ownerUserId);
}

export async function enqueuePendingMutation(mutation: PendingMutation): Promise<void> {
  const validated = pendingMutationSchema.parse(mutation);
  const database = await databasePromise;
  // Uživatelův stav je snapshot. Novější snapshot se stejným druhem nahrazuje
  // starší, takže opakované offline ukládání nevytváří nekonečnou frontu.
  const transaction = database.transaction('pendingMutations', 'readwrite');
  const stored = await transaction.store.getAll() as unknown[];
  const matching: PendingMutation[] = [];
  for (const value of stored) {
    const parsed = pendingMutationSchema.safeParse(value);
    if (parsed.success && parsed.data.userId === validated.userId && parsed.data.kind === validated.kind) {
      matching.push(parsed.data);
    }
  }
  const newest = [...matching, validated].reduce((current, candidate) => (
    candidate.payload.updatedAt >= current.payload.updatedAt ? candidate : current
  ));
  const merged = pendingMutationSchema.parse({
    ...newest,
    attempts: Math.max(validated.attempts, ...matching.map((candidate) => candidate.attempts)),
    lastError: validated.lastError ?? newest.lastError,
  });
  for (const existing of matching) await transaction.store.delete(existing.id);
  await transaction.store.put(merged, merged.id);
  await transaction.done;
}

export async function loadPendingMutations(userId: string): Promise<PendingMutation[]> {
  const database = await databasePromise;
  const stored = await database.getAll('pendingMutations') as unknown[];
  return stored.flatMap((value) => {
    const parsed = pendingMutationSchema.safeParse(value);
    return parsed.success && parsed.data.userId === userId ? [parsed.data] : [];
  }).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function removePendingMutation(id: string): Promise<void> {
  const database = await databasePromise;
  await database.delete('pendingMutations', id);
}

export async function markPendingMutationFailed(id: string, errorCode: string): Promise<PendingMutation | null> {
  const database = await databasePromise;
  const transaction = database.transaction('pendingMutations', 'readwrite');
  const stored = await transaction.store.get(id) as unknown;
  const parsed = pendingMutationSchema.safeParse(stored);
  if (!parsed.success) {
    await transaction.done;
    return null;
  }
  const updated = pendingMutationSchema.parse({
    ...parsed.data,
    attempts: parsed.data.attempts + 1,
    lastError: errorCode.slice(0, 80),
  });
  await transaction.store.put(updated, updated.id);
  await transaction.done;
  return updated;
}

export async function recordDiagnostic(input: Omit<DiagnosticEvent, 'schemaVersion' | 'id' | 'occurredAt'>): Promise<void> {
  const event = diagnosticEventSchema.parse({
    ...input,
    schemaVersion: 1,
    id: createUuid(),
    occurredAt: new Date().toISOString(),
  });
  const database = await databasePromise;
  await database.put('diagnostics', event, event.id);
  const events = await database.getAll('diagnostics') as unknown[];
  const valid = events.flatMap((value) => {
    const parsed = diagnosticEventSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  if (valid.length > 200) {
    const transaction = database.transaction('diagnostics', 'readwrite');
    for (const old of valid.slice(0, valid.length - 200)) await transaction.store.delete(old.id);
    await transaction.done;
  }
}

export async function loadDiagnostics(): Promise<DiagnosticEvent[]> {
  const database = await databasePromise;
  const stored = await database.getAll('diagnostics') as unknown[];
  return stored.flatMap((value) => {
    const parsed = diagnosticEventSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export async function clearDiagnostics(): Promise<void> {
  const database = await databasePromise;
  await database.clear('diagnostics');
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

export interface FullBackupPayload {
  application: 'cesky-digitalni-zpevnik';
  backupVersion: 2;
  exportedAt: string;
  data: UserState;
  personalSongs: PersonalSongEntry[];
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

export async function createFullBackupPayload(state: UserState, personalSongs: Song[]): Promise<{ payload: FullBackupPayload; personalSongCount: number }> {
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
  const payload: FullBackupPayload = {
    application: 'cesky-digitalni-zpevnik',
    backupVersion: 2,
    exportedAt: new Date().toISOString(),
    data: validatedState,
    personalSongs: entries,
  };
  return { payload, personalSongCount: entries.length };
}

export async function exportFullBackup(state: UserState, personalSongs: Song[]): Promise<number> {
  const backup = await createFullBackupPayload(state, personalSongs);
  downloadBackup(backup.payload);
  return backup.personalSongCount;
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
    const existingPackage = options.ownerUserId ? await loadContentPackage(options.ownerUserId) : null;
    const stored = await database.getAll('personalSongs') as unknown[];
    const legacyIds = stored.flatMap((value) => {
      const parsedSong = songSchema.safeParse(value);
      return parsedSong.success && isDownloadedLibrarySong(parsedSong.data) ? [parsedSong.data.id] : [];
    });
    const oldIds = existingPackage?.songIds ?? legacyIds;
    const transaction = database.transaction(['personalSongs', 'personalSongContent', 'contentPackages', 'metadata'], 'readwrite');
    for (const songId of oldIds) {
      await transaction.objectStore('personalSongs').delete(songId);
      await transaction.objectStore('personalSongContent').delete(songId);
    }
    for (const entry of entries) {
      await transaction.objectStore('personalSongs').put(entry.song, entry.song.id);
      await transaction.objectStore('personalSongContent').put(entry.content, entry.song.id);
    }
    const parsedManifest = libraryManifestSchema.safeParse(parsed.libraryManifest);
    const manifest = options.verifiedManifest ?? (parsedManifest.success ? parsedManifest.data : undefined);
    if (manifest) {
      const metadata = downloadedLibraryMetadataSchema.parse({ ...manifest, downloadedAt: new Date().toISOString() });
      await transaction.objectStore('metadata').put(metadata, 'downloadedLibrary');
      if (options.ownerUserId) {
        const contentPackage: ContentPackageRecord = {
          schemaVersion: 1,
          packageId: manifest.scope,
          ownerUserId: options.ownerUserId,
          manifest,
          songIds: entries.map(({ song }) => song.id),
          contentLengths: Object.fromEntries(entries.map(({ song, content }) => [song.id, new TextEncoder().encode(content).byteLength])),
          activatedAt: metadata.downloadedAt,
          integrity: 'verified',
        };
        await transaction.objectStore('contentPackages').put(contentPackage, options.ownerUserId);
      }
    }
    await transaction.done;
  } else {
    await savePersonalSongs(entries);
  }
  return { state, personalSongCount: entries.length };
}

export async function loadPersonalSongs(userId?: string): Promise<Song[]> {
  const database = await databasePromise;
  const stored = await database.getAll('personalSongs') as unknown[];
  const packages = await database.getAll('contentPackages') as ContentPackageRecord[];
  const protectedOwners = new Map<string, string>();
  for (const contentPackage of packages) {
    if (contentPackage?.schemaVersion !== 1 || !Array.isArray(contentPackage.songIds)) continue;
    for (const songId of contentPackage.songIds) protectedOwners.set(songId, contentPackage.ownerUserId);
  }
  return stored.flatMap((value) => {
    const parsed = songSchema.safeParse(value);
    if (!parsed.success || !parsed.data.personalOnly) return [];
    const normalizedKey = parsed.data.originalKey ? normalizeSharpSpelling(parsed.data.originalKey, 'czech') : null;
    const normalizedSong = normalizedKey !== parsed.data.originalKey
      ? { ...parsed.data, originalKey: normalizedKey }
      : parsed.data;
    if (!isDownloadedLibrarySong(normalizedSong)) return [normalizedSong];
    const owner = protectedOwners.get(normalizedSong.id);
    // Starší balíčky před schématem 5 neměly vlastníka. Zůstanou čitelné do
    // první online obnovy; nový import je už vždy uživatelsky oddělený.
    return !owner || owner === userId ? [normalizedSong] : [];
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

export async function inspectContentPackageIntegrity(userId: string): Promise<ContentPackageIntegrity | null> {
  const contentPackage = await loadContentPackage(userId);
  if (!contentPackage) return null;
  const database = await databasePromise;
  const transaction = database.transaction(['personalSongs', 'personalSongContent'], 'readonly');
  let completeSongs = 0;
  let invalidSongs = 0;
  let missingContent = 0;
  let alteredContent = 0;
  let availableBytes = 0;
  for (const songId of contentPackage.songIds) {
    const parsedSong = songSchema.safeParse(await transaction.objectStore('personalSongs').get(songId));
    if (!parsedSong.success || !isDownloadedLibrarySong(parsedSong.data)) {
      invalidSongs += 1;
      continue;
    }
    const content = await transaction.objectStore('personalSongContent').get(songId) as unknown;
    if (typeof content !== 'string' || content.length === 0) {
      missingContent += 1;
      continue;
    }
    const bytes = new TextEncoder().encode(content).byteLength;
    availableBytes += bytes;
    const expectedLength = contentPackage.contentLengths?.[songId] ?? parsedSong.data.contentBytes;
    if (expectedLength > 0 && bytes !== expectedLength) alteredContent += 1;
    else completeSongs += 1;
  }
  await transaction.done;
  const missingSongs = Math.max(0, contentPackage.manifest.songCount - contentPackage.songIds.length);
  const healthy = missingSongs === 0
    && invalidSongs === 0
    && missingContent === 0
    && alteredContent === 0
    && completeSongs === contentPackage.manifest.songCount
    && availableBytes === contentPackage.manifest.contentBytes;
  return {
    expectedSongs: contentPackage.manifest.songCount,
    indexedSongs: contentPackage.songIds.length,
    completeSongs,
    missingSongs,
    invalidSongs,
    missingContent,
    alteredContent,
    availableBytes,
    expectedBytes: contentPackage.manifest.contentBytes,
    healthy,
  };
}

const LOCAL_SONG_OVERRIDE_PREFIX = 'local-override:';

export async function getLocalSongOverride(songId: string): Promise<string | null> {
  const database = await databasePromise;
  const content = await database.get('personalSongContent', `${LOCAL_SONG_OVERRIDE_PREFIX}${songId}`) as unknown;
  return typeof content === 'string' ? sanitizeImportedText(content) : null;
}

export async function saveLocalSongOverride(songId: string, content: string): Promise<void> {
  const database = await databasePromise;
  await database.put('personalSongContent', sanitizeImportedText(content), `${LOCAL_SONG_OVERRIDE_PREFIX}${songId}`);
}

export async function removeLocalSongOverride(songId: string): Promise<void> {
  const database = await databasePromise;
  await database.delete('personalSongContent', `${LOCAL_SONG_OVERRIDE_PREFIX}${songId}`);
}

export async function removePersonalSong(songId: string): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(['personalSongs', 'personalSongContent'], 'readwrite');
  await transaction.objectStore('personalSongs').delete(songId);
  await transaction.objectStore('personalSongContent').delete(songId);
  await transaction.objectStore('personalSongContent').delete(`${LOCAL_SONG_OVERRIDE_PREFIX}${songId}`);
  await transaction.done;
}

export async function removeProtectedSong(userId: string, songId: string): Promise<void> {
  const contentPackage = await loadContentPackage(userId);
  if (!contentPackage || !contentPackage.songIds.includes(songId)) throw new Error('Píseň nepatří do aktivního balíčku tohoto účtu.');
  const database = await databasePromise;
  const transaction = database.transaction(['personalSongs', 'personalSongContent', 'contentPackages'], 'readwrite');
  await transaction.objectStore('personalSongs').delete(songId);
  await transaction.objectStore('personalSongContent').delete(songId);
  await transaction.objectStore('personalSongContent').delete(`${LOCAL_SONG_OVERRIDE_PREFIX}${songId}`);
  await transaction.objectStore('contentPackages').put({
    ...contentPackage,
    songIds: contentPackage.songIds.filter((id) => id !== songId),
  }, userId);
  await transaction.done;
}

export async function removeDownloadedLibrarySongs(userId?: string): Promise<number> {
  const database = await databasePromise;
  const stored = await database.getAll('personalSongs') as unknown[];
  const contentPackage = userId ? await loadContentPackage(userId) : null;
  const legacySongIds = stored.flatMap((value) => {
    const parsed = songSchema.safeParse(value);
    return parsed.success && isDownloadedLibrarySong(parsed.data) ? [parsed.data.id] : [];
  });
  const songIds = contentPackage?.songIds ?? legacySongIds;
  if (songIds.length === 0) {
    await clearDownloadedLibraryMetadata();
    return 0;
  }
  const transaction = database.transaction(['personalSongs', 'personalSongContent', 'contentPackages', 'metadata'], 'readwrite');
  for (const songId of songIds) {
    await transaction.objectStore('personalSongs').delete(songId);
    await transaction.objectStore('personalSongContent').delete(songId);
    await transaction.objectStore('personalSongContent').delete(`${LOCAL_SONG_OVERRIDE_PREFIX}${songId}`);
  }
  if (userId) await transaction.objectStore('contentPackages').delete(userId);
  await transaction.objectStore('metadata').delete('downloadedLibrary');
  await transaction.done;
  return songIds.length;
}

export async function clearSecureAccountLocalData(userId?: string): Promise<void> {
  if (userId) await removeDownloadedLibrarySongs(userId);
  else await removeDownloadedLibrarySongs();
  await clearSecureAuthorizationData(userId);
}

export async function clearSecureAuthorizationData(userId?: string): Promise<void> {
  const database = await databasePromise;
  const transaction = database.transaction(['offlineAuth', 'account', 'pendingMutations'], 'readwrite');
  await transaction.objectStore('offlineAuth').delete('current');
  await transaction.objectStore('account').delete('profile');
  await transaction.objectStore('account').delete('neonSession');
  const pending = await transaction.objectStore('pendingMutations').getAll() as unknown[];
  for (const value of pending) {
    const parsed = pendingMutationSchema.safeParse(value);
    if (parsed.success && (!userId || parsed.data.userId === userId)) await transaction.objectStore('pendingMutations').delete(parsed.data.id);
  }
  await transaction.done;
}
