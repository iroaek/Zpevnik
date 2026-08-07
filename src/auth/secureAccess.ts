import { createClient, type AuthChangeEvent, type Session } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  importFullBackup,
  libraryManifestSchema,
  loadDownloadedLibraryMetadata,
  migrateUserState,
  saveDownloadedLibraryMetadata,
  type LibraryManifest,
  type UserState,
} from '../storage/database';
import { createUuid } from '../domain/browserCompatibility';
import { readBlobBytes, readBlobText } from '../domain/readBlobBytes';

export const ACCOUNT_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
export const ACCOUNT_ROLES = ['member', 'admin'] as const;

// PostgreSQL `timestamptz` values returned by Supabase include an explicit
// offset (usually `+00:00`). Keep the value as a string, but accept that valid
// ISO 8601 representation in addition to the `Z` form used by local data.
export const databaseTimestampSchema = z.string().datetime({ offset: true });

export const secureProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  display_name: z.string().trim().min(2).max(60),
  status: z.enum(ACCOUNT_STATUSES),
  role: z.enum(ACCOUNT_ROLES),
  created_at: databaseTimestampSchema,
  reviewed_at: databaseTimestampSchema.nullable(),
  last_seen_at: databaseTimestampSchema.nullable(),
});

const remoteSubmissionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  kind: z.enum(['request', 'upload']),
  title: z.string(),
  artist: z.string(),
  notes: z.string(),
  file_path: z.string().nullable(),
  file_name: z.string().nullable(),
  file_type: z.string().nullable(),
  file_size: z.number().int().nonnegative(),
  rights_status: z.literal('requires_review'),
  license: z.string(),
  attribution: z.string(),
  status: z.enum(['pending_review', 'accepted_for_review', 'rejected', 'published']),
  admin_note: z.string(),
  created_at: databaseTimestampSchema,
});

export type SecureProfile = z.infer<typeof secureProfileSchema>;
export type RemoteSongSubmission = z.infer<typeof remoteSubmissionSchema>;
export type SecureSession = Session;

export interface ApprovedLibraryDownloadResult {
  count: number;
  changed: boolean;
  manifest: LibraryManifest | null;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

export const secureAccessConfigured = import.meta.env.MODE !== 'e2e' && Boolean(supabaseUrl && publishableKey);
export const secureAccessRequired = import.meta.env.MODE !== 'e2e' && import.meta.env.VITE_REQUIRE_SECURE_ACCESS === 'true';

export const secureAccessConfigurationError = secureAccessRequired && !secureAccessConfigured
  ? 'Soukromý server zatím není připojený. Správce musí doplnit adresu projektu a veřejný klientský klíč.'
  : null;

const client = secureAccessConfigured
  ? createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'cesky-zpevnik-auth',
      },
    })
  : null;

function requireClient() {
  if (!client) throw new Error(secureAccessConfigurationError ?? 'Soukromý server není nakonfigurovaný.');
  return client;
}

function appRedirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

function readableError(error: { message?: string } | null, fallback: string): Error {
  const message = error?.message?.toLowerCase() ?? '';
  if (message.includes('invalid login credentials')) return new Error('E-mail nebo heslo není správné.');
  if (message.includes('email not confirmed')) return new Error('Nejprve potvrďte e-mail pomocí odkazu, který vám přišel.');
  if (message.includes('user already registered')) return new Error('Účet s tímto e-mailem už existuje.');
  if (message.includes('password')) return new Error('Heslo nesplňuje bezpečnostní požadavky.');
  return new Error(error?.message || fallback);
}

export function subscribeToSecureSession(callback: (event: AuthChangeEvent, session: SecureSession | null) => void): () => void {
  const supabase = requireClient();
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}

export async function getSecureSession(): Promise<SecureSession | null> {
  const { data, error } = await requireClient().auth.getSession();
  if (error) throw readableError(error, 'Přihlášení se nepodařilo načíst.');
  return data.session;
}

export async function registerSecureAccount(input: { displayName: string; email: string; password: string }): Promise<{ needsEmailConfirmation: boolean }> {
  const { data, error } = await requireClient().auth.signUp({
    email: input.email.trim().toLocaleLowerCase('cs'),
    password: input.password,
    options: {
      emailRedirectTo: appRedirectUrl(),
      data: { display_name: input.displayName.trim() },
    },
  });
  if (error) throw readableError(error, 'Registraci se nepodařilo dokončit.');
  return { needsEmailConfirmation: !data.session };
}

export async function signInSecureAccount(email: string, password: string): Promise<void> {
  const { error } = await requireClient().auth.signInWithPassword({
    email: email.trim().toLocaleLowerCase('cs'),
    password,
  });
  if (error) throw readableError(error, 'Přihlášení se nepodařilo.');
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await requireClient().auth.resetPasswordForEmail(email.trim().toLocaleLowerCase('cs'), {
    redirectTo: appRedirectUrl(),
  });
  if (error) throw readableError(error, 'Odkaz pro obnovu hesla se nepodařilo odeslat.');
}

export async function updateSecurePassword(password: string): Promise<void> {
  if (password.length < 10) throw new Error('Heslo musí mít alespoň 10 znaků.');
  const { error } = await requireClient().auth.updateUser({ password });
  if (error) throw readableError(error, 'Nové heslo se nepodařilo uložit.');
}

export async function signOutSecureAccount(): Promise<void> {
  const { error } = await requireClient().auth.signOut();
  if (error) throw readableError(error, 'Odhlášení se nepodařilo.');
}

export async function loadSecureProfile(): Promise<SecureProfile | null> {
  const supabase = requireClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,display_name,status,role,created_at,reviewed_at,last_seen_at')
    .eq('id', userData.user.id)
    .single();
  if (error) throw readableError(error, 'Profil se nepodařilo načíst.');
  return secureProfileSchema.parse(data);
}

export async function loadPendingProfiles(): Promise<SecureProfile[]> {
  const { data, error } = await requireClient()
    .from('profiles')
    .select('id,email,display_name,status,role,created_at,reviewed_at,last_seen_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw readableError(error, 'Čekající uživatele se nepodařilo načíst.');
  return z.array(secureProfileSchema).parse(data ?? []);
}

export async function loadAllProfiles(): Promise<SecureProfile[]> {
  const { data, error } = await requireClient()
    .from('profiles')
    .select('id,email,display_name,status,role,created_at,reviewed_at,last_seen_at')
    .order('display_name', { ascending: true });
  if (error) throw readableError(error, 'Seznam uživatelů se nepodařilo načíst.');
  return z.array(secureProfileSchema).parse(data ?? []);
}

export async function touchSecurePresence(): Promise<void> {
  const { error } = await requireClient().rpc('touch_my_presence');
  if (error) throw readableError(error, 'Online aktivitu se nepodařilo zaznamenat.');
}

export async function reviewSecureProfile(userId: string, decision: 'approved' | 'rejected'): Promise<void> {
  const { error } = await requireClient().rpc('review_account', {
    target_user_id: userId,
    decision,
  });
  if (error) throw readableError(error, 'Rozhodnutí se nepodařilo uložit.');
}

function safeFileName(value: string): string {
  const cleaned = value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 120) || 'podklad';
}

export async function submitSecureSong(input: {
  profile: SecureProfile;
  kind: 'request' | 'upload';
  title: string;
  artist?: string;
  notes?: string;
  file?: File;
}): Promise<RemoteSongSubmission> {
  if (input.profile.status !== 'approved') throw new Error('Písně mohou navrhovat pouze schválení uživatelé.');
  if (input.kind === 'upload' && !input.file) throw new Error('Vyberte soubor s písní.');
  if (input.file && input.file.size > 25 * 1024 * 1024) throw new Error('Soubor je větší než povolených 25 MB.');

  const supabase = requireClient();
  const id = createUuid();
  let filePath: string | null = null;
  if (input.file) {
    filePath = `${input.profile.id}/${id}/${safeFileName(input.file.name)}`;
    const { error } = await supabase.storage.from('song-submissions').upload(filePath, input.file, {
      cacheControl: '0',
      contentType: input.file.type || 'application/octet-stream',
      upsert: false,
    });
    if (error) throw readableError(error, 'Soubor se nepodařilo bezpečně nahrát.');
  }

  const row = {
    id,
    user_id: input.profile.id,
    kind: input.kind,
    title: input.title.trim(),
    artist: input.artist?.trim() ?? '',
    notes: input.notes?.trim() ?? '',
    file_path: filePath,
    file_name: input.file?.name ?? null,
    file_type: input.file?.type || null,
    file_size: input.file?.size ?? 0,
    rights_status: 'requires_review' as const,
    license: 'UNVERIFIED - requires admin review',
    attribution: input.profile.display_name,
    status: 'pending_review' as const,
    admin_note: '',
  };
  const { data, error } = await supabase.from('song_submissions').insert(row).select('*').single();
  if (error) {
    if (filePath) await supabase.storage.from('song-submissions').remove([filePath]);
    throw readableError(error, 'Návrh se nepodařilo odeslat.');
  }
  return remoteSubmissionSchema.parse(data);
}

export async function loadRemoteSongSubmissions(): Promise<RemoteSongSubmission[]> {
  const { data, error } = await requireClient()
    .from('song_submissions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw readableError(error, 'Frontu návrhů se nepodařilo načíst.');
  return z.array(remoteSubmissionSchema).parse(data ?? []);
}

export async function reviewRemoteSongSubmission(submissionId: string, decision: 'accepted_for_review' | 'rejected', adminNote = ''): Promise<void> {
  const { error } = await requireClient().rpc('review_song_submission', {
    target_submission_id: submissionId,
    decision,
    note: adminNote.trim(),
  });
  if (error) throw readableError(error, 'Kontrolu návrhu se nepodařilo uložit.');
}

function libraryPaths(profile: SecureProfile): { bundle: string; manifest: string; scope: 'admin' | 'members' } {
  const scope = profile.role === 'admin' ? 'admin' : 'members';
  return {
    scope,
    bundle: scope === 'admin' ? 'admin/admin-library.json' : 'members/member-library.json',
    manifest: scope === 'admin' ? 'admin/admin-library.manifest.json' : 'members/member-library.manifest.json',
  };
}

export async function loadApprovedLibraryManifest(profile: SecureProfile): Promise<LibraryManifest | null> {
  const { data, error } = await requireClient().storage.from('song-library').download(libraryPaths(profile).manifest);
  if (error) {
    if (error.message.toLowerCase().includes('not found') || error.message.includes('404')) return null;
    throw readableError(error, 'Informace o verzi knihovny se nepodařilo načíst.');
  }
  try {
    return libraryManifestSchema.parse(JSON.parse(await readBlobText(data)));
  } catch {
    throw new Error('Manifest soukromé knihovny je poškozený nebo neplatný.');
  }
}

async function sha256Hex(blob: Blob): Promise<string> {
  const source = await readBlobBytes(blob);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function downloadApprovedLibrary(
  profile: SecureProfile,
  options: { force?: boolean; localSongCount?: number } = {},
): Promise<ApprovedLibraryDownloadResult> {
  const paths = libraryPaths(profile);
  const [manifest, localMetadata] = await Promise.all([loadApprovedLibraryManifest(profile), loadDownloadedLibraryMetadata()]);
  if (!options.force && manifest && localMetadata?.version === manifest.version && options.localSongCount === manifest.songCount) {
    return { count: manifest.songCount, changed: false, manifest };
  }
  const { data, error } = await requireClient().storage.from('song-library').download(paths.bundle);
  if (error) throw readableError(error, profile.role === 'admin' ? 'Soukromá správcovská knihovna zatím není připravená.' : 'Soukromá členská knihovna zatím není připravená.');
  if (manifest?.packageBytes && data.size !== manifest.packageBytes) throw new Error('Stažený balíček nemá očekávanou velikost. Původní knihovna zůstala zachovaná.');
  if (manifest?.sha256 && await sha256Hex(data) !== manifest.sha256) throw new Error('Kontrolní součet knihovny nesouhlasí. Původní knihovna zůstala zachovaná.');
  const imported = await importFullBackup(data, {
    replaceDownloadedLibrary: true,
    expectedLibraryScope: paths.scope,
  });
  if (manifest) await saveDownloadedLibraryMetadata(manifest);
  return { count: imported.personalSongCount, changed: true, manifest };
}

export async function loadCloudUserState(): Promise<UserState | null> {
  const { data, error } = await requireClient()
    .from('user_app_state')
    .select('state')
    .maybeSingle();
  if (error) throw readableError(error, 'Synchronizovaná nastavení se nepodařilo načíst.');
  if (!data) return null;
  const parsed = migrateUserState(data.state);
  if (!parsed) throw new Error('Synchronizovaná uživatelská data mají neplatný formát.');
  return parsed;
}

export async function saveCloudUserState(state: UserState): Promise<void> {
  const { data: userData, error: userError } = await requireClient().auth.getUser();
  if (userError || !userData.user) throw readableError(userError, 'Pro synchronizaci je nutné přihlášení.');
  const { error } = await requireClient().from('user_app_state').upsert({
    user_id: userData.user.id,
    state,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw readableError(error, 'Změny se nepodařilo synchronizovat mezi zařízeními.');
}
