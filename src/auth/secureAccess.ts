import { createClient, type AuthChangeEvent, type Session } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  clearSecureAccountLocalData,
  importFullBackup,
  libraryManifestSchema,
  loadDownloadedLibraryMetadata,
  migrateUserState,
  type LibraryManifest,
  type UserState,
} from '../storage/database';
import { createUuid } from '../domain/browserCompatibility';
import { readBlobBytes, readBlobText } from '../domain/readBlobBytes';
import {
  dataBackendProvider,
  neonDataApiConfigured,
  neonInsert,
  neonRpc,
  neonSelect,
  neonUpsert,
} from '../backend/neonDataApi';

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

export const offlineGrantIssuer = import.meta.env.VITE_OFFLINE_GRANT_ISSUER?.trim() ?? '';
export const offlineGrantAudience = import.meta.env.VITE_OFFLINE_GRANT_AUDIENCE?.trim() || 'cesky-zpevnik-offline';
export const offlineGrantPublicJwks = import.meta.env.VITE_OFFLINE_GRANT_PUBLIC_JWKS?.trim() ?? '';
export const offlineGrantClientConfigured = Boolean(offlineGrantIssuer && offlineGrantPublicJwks);
export const neonOfflineGrantUrl = import.meta.env.VITE_NEON_OFFLINE_GRANT_URL?.trim() ?? '';

export const secureDataBackend = dataBackendProvider;
export const secureAccessConfigured = import.meta.env.MODE !== 'e2e'
  && Boolean(supabaseUrl && publishableKey)
  && (dataBackendProvider !== 'neon' || Boolean(neonDataApiConfigured && neonOfflineGrantUrl));
export const secureAccessRequired = import.meta.env.MODE !== 'e2e' && import.meta.env.VITE_REQUIRE_SECURE_ACCESS === 'true';

export const secureAccessConfigurationError = secureAccessRequired && !secureAccessConfigured
  ? dataBackendProvider === 'neon' && !neonDataApiConfigured
    ? 'Neon Data API zatím není připojené. Správce musí doplnit jeho veřejnou HTTPS adresu.'
    : dataBackendProvider === 'neon' && !neonOfflineGrantUrl
      ? 'Neon offline oprávnění zatím není připojené. Správce musí doplnit jeho veřejnou HTTPS adresu.'
    : 'Soukromý server zatím není připojený. Správce musí doplnit adresu projektu a veřejný klientský klíč.'
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

async function requireSecureAccessToken(): Promise<string> {
  const { data, error } = await requireClient().auth.getSession();
  if (error || !data.session?.access_token) throw readableError(error, 'Pro přístup k soukromým datům je nutné přihlášení.');
  return data.session.access_token;
}

export class SecureAccessError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) {
    super(message);
    this.name = 'SecureAccessError';
  }
}

function readableError(error: { message?: string; status?: number; statusCode?: number | string; code?: string } | null, fallback: string): Error {
  const message = error?.message?.toLowerCase() ?? '';
  const rawStatus = error?.status ?? error?.statusCode;
  const status = typeof rawStatus === 'number' ? rawStatus : typeof rawStatus === 'string' && /^\d+$/.test(rawStatus) ? Number(rawStatus) : undefined;
  const code = error?.code;
  if (message.includes('invalid login credentials')) return new SecureAccessError('E-mail nebo heslo není správné.', status, code);
  if (message.includes('email not confirmed')) return new SecureAccessError('Nejprve potvrďte e-mail pomocí odkazu, který vám přišel.', status, code);
  if (message.includes('user already registered')) return new SecureAccessError('Účet s tímto e-mailem už existuje.', status, code);
  if (message.includes('password')) return new SecureAccessError('Heslo nesplňuje bezpečnostní požadavky.', status, code);
  return new SecureAccessError(error?.message || fallback, status, code);
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
  const { data } = await requireClient().auth.getSession();
  const userId = data.session?.user.id;
  const { error } = await requireClient().auth.signOut({ scope: 'local' });
  await clearSecureAccountLocalData(userId);
  if (error) throw readableError(error, 'Serverové odhlášení se nepodařilo, místní oprávnění však bylo odstraněno.');
}

export async function loadSecureProfile(): Promise<SecureProfile | null> {
  const supabase = requireClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw readableError(userError, 'Online relaci se nepodařilo ověřit.');
  if (!userData.user) return null;
  if (dataBackendProvider === 'neon') {
    const token = await requireSecureAccessToken();
    const query = { select: 'id,email,display_name,status,role,created_at,reviewed_at,last_seen_at', id: `eq.${userData.user.id}`, limit: '1' };
    let rows = await neonSelect<unknown>('profiles', token, query);
    if (!rows.length) {
      await neonRpc('ensure_my_profile', token, {
        requested_email: userData.user.email ?? '',
        requested_display_name: String(userData.user.user_metadata?.display_name ?? userData.user.email?.split('@')[0] ?? 'Nový člen'),
      });
      rows = await neonSelect<unknown>('profiles', token, query);
    }
    return rows[0] ? secureProfileSchema.parse(rows[0]) : null;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,display_name,status,role,created_at,reviewed_at,last_seen_at')
    .eq('id', userData.user.id)
    .single();
  if (error) throw readableError(error, 'Profil se nepodařilo načíst.');
  return secureProfileSchema.parse(data);
}

export async function loadPendingProfiles(): Promise<SecureProfile[]> {
  if (dataBackendProvider === 'neon') {
    const rows = await neonSelect<unknown>('profiles', await requireSecureAccessToken(), {
      select: 'id,email,display_name,status,role,created_at,reviewed_at,last_seen_at',
      status: 'eq.pending',
      order: 'created_at.asc',
    });
    return z.array(secureProfileSchema).parse(rows);
  }
  const { data, error } = await requireClient()
    .from('profiles')
    .select('id,email,display_name,status,role,created_at,reviewed_at,last_seen_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw readableError(error, 'Čekající uživatele se nepodařilo načíst.');
  return z.array(secureProfileSchema).parse(data ?? []);
}

export async function loadAllProfiles(): Promise<SecureProfile[]> {
  if (dataBackendProvider === 'neon') {
    const rows = await neonSelect<unknown>('profiles', await requireSecureAccessToken(), {
      select: 'id,email,display_name,status,role,created_at,reviewed_at,last_seen_at',
      order: 'display_name.asc',
    });
    return z.array(secureProfileSchema).parse(rows);
  }
  const { data, error } = await requireClient()
    .from('profiles')
    .select('id,email,display_name,status,role,created_at,reviewed_at,last_seen_at')
    .order('display_name', { ascending: true });
  if (error) throw readableError(error, 'Seznam uživatelů se nepodařilo načíst.');
  return z.array(secureProfileSchema).parse(data ?? []);
}

export async function touchSecurePresence(): Promise<void> {
  if (dataBackendProvider === 'neon') {
    await neonRpc('touch_my_presence', await requireSecureAccessToken());
    return;
  }
  const { error } = await requireClient().rpc('touch_my_presence');
  if (error) throw readableError(error, 'Online aktivitu se nepodařilo zaznamenat.');
}

export async function reviewSecureProfile(userId: string, decision: 'approved' | 'rejected'): Promise<void> {
  if (dataBackendProvider === 'neon') {
    await neonRpc('review_account', await requireSecureAccessToken(), { target_user_id: userId, decision });
    return;
  }
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
  const neonToken = dataBackendProvider === 'neon' ? await requireSecureAccessToken() : null;
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
  if (neonToken) {
    try {
      const data = await neonInsert<unknown>('song_submissions', neonToken, row);
      return remoteSubmissionSchema.parse(data[0]);
    } catch (error) {
      if (filePath) await supabase.storage.from('song-submissions').remove([filePath]);
      throw readableError(error instanceof Error ? error : null, 'Návrh se nepodařilo odeslat.');
    }
  }
  const { data, error } = await supabase.from('song_submissions').insert(row).select('*').single();
  if (error) {
    if (filePath) await supabase.storage.from('song-submissions').remove([filePath]);
    throw readableError(error, 'Návrh se nepodařilo odeslat.');
  }
  return remoteSubmissionSchema.parse(data);
}

export async function loadRemoteSongSubmissions(): Promise<RemoteSongSubmission[]> {
  if (dataBackendProvider === 'neon') {
    const rows = await neonSelect<unknown>('song_submissions', await requireSecureAccessToken(), { select: '*', order: 'created_at.desc' });
    return z.array(remoteSubmissionSchema).parse(rows);
  }
  const { data, error } = await requireClient()
    .from('song_submissions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw readableError(error, 'Frontu návrhů se nepodařilo načíst.');
  return z.array(remoteSubmissionSchema).parse(data ?? []);
}

export async function reviewRemoteSongSubmission(submissionId: string, decision: 'accepted_for_review' | 'rejected', adminNote = ''): Promise<void> {
  if (dataBackendProvider === 'neon') {
    await neonRpc('review_song_submission', await requireSecureAccessToken(), {
      target_submission_id: submissionId,
      decision,
      note: adminNote.trim(),
    });
    return;
  }
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
    ownerUserId: profile.id,
    verifiedManifest: manifest ?? undefined,
  });
  return { count: imported.personalSongCount, changed: true, manifest };
}

export async function requestOfflineGrantToken(deviceId: string): Promise<string> {
  if (dataBackendProvider === 'neon') {
    const response = await fetch(neonOfflineGrantUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${await requireSecureAccessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceId }),
    });
    let data: unknown = null;
    try { data = await response.json(); } catch { /* Neplatné odpovědi se zpracují níže. */ }
    if (!response.ok) {
      const responseCode = data && typeof data === 'object' && (data as { code?: unknown }).code === 'account_revoked'
        ? 'account_revoked'
        : 'offline_grant_failed';
      const fallback = response.status === 401 || response.status === 403
        ? 'Server odmítl vydat offline oprávnění. Obnovte přihlášení nebo schválení účtu.'
        : 'Server nevydal offline oprávnění.';
      throw new SecureAccessError(fallback, response.status, responseCode);
    }
    if (!data || typeof data !== 'object' || typeof (data as { token?: unknown }).token !== 'string') {
      throw new SecureAccessError('Server vrátil neplatný formát offline oprávnění.');
    }
    return (data as { token: string }).token;
  }
  const { data, error } = await requireClient().functions.invoke('offline-grant', {
    body: { deviceId },
  });
  if (error) throw readableError(error, 'Server nevydal offline oprávnění.');
  if (!data || typeof data !== 'object' || typeof (data as { token?: unknown }).token !== 'string') {
    throw new SecureAccessError('Server vrátil neplatný formát offline oprávnění.');
  }
  return (data as { token: string }).token;
}

export async function loadCloudUserState(): Promise<UserState | null> {
  if (dataBackendProvider === 'neon') {
    const rows = await neonSelect<{ state: unknown }>('user_app_state', await requireSecureAccessToken(), { select: 'state', limit: '1' });
    if (!rows[0]) return null;
    const parsed = migrateUserState(rows[0].state);
    if (!parsed) throw new Error('Synchronizovaná uživatelská data mají neplatný formát.');
    return parsed;
  }
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
  if (dataBackendProvider === 'neon') {
    await neonUpsert('user_app_state', await requireSecureAccessToken(), {
      user_id: userData.user.id,
      state,
      updated_at: new Date().toISOString(),
    }, 'user_id');
    return;
  }
  const { error } = await requireClient().from('user_app_state').upsert({
    user_id: userData.user.id,
    state,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw readableError(error, 'Změny se nepodařilo synchronizovat mezi zařízeními.');
}
