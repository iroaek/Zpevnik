import { z } from 'zod';
import {
  clearSecureAccountLocalData,
  clearSecureAuthorizationData,
  importFullBackup,
  libraryManifestSchema,
  loadDownloadedLibraryMetadata,
  migrateUserState,
  type LibraryManifest,
  type UserState,
} from '../storage/database';
import { createUuid } from '../domain/browserCompatibility';
import { readBlobBytes } from '../domain/readBlobBytes';
import { neonInsert, neonRpc, neonSelect, neonUpsert } from '../backend/neonDataApi';
import {
  clearPendingNeonAuthJwt,
  consumePendingNeonAuthJwt,
  neonAuthIssuer,
  neonAuthJwksUrl,
  neonAuthUrl,
  neonClientConfigured,
  requireNeonClient,
} from '../backend/neonClient';

export const ACCOUNT_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
export const ACCOUNT_ROLES = ['member', 'admin'] as const;

export const databaseTimestampSchema = z.string().datetime({ offset: true });

export const secureProfileSchema = z.object({
  id: z.string().uuid(),
  auth_user_id: z.string().uuid().nullable().default(null),
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

const sharedSetlistSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  owner_name: z.string().trim().min(2).max(60),
  source_setlist_id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(100),
  song_ids: z.array(z.string().min(1).max(200)).min(1).max(500),
  created_at: databaseTimestampSchema,
  updated_at: databaseTimestampSchema,
});

const songCorrectionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  song_id: z.string().min(1).max(200),
  song_title: z.string().min(1).max(160),
  original_value: z.string().max(160),
  proposed_value: z.string().max(160),
  note: z.string().min(1).max(2000),
  status: z.enum(['pending', 'accepted', 'rejected', 'rolled_back']),
  admin_note: z.string().max(2000),
  history: z.array(z.object({
    at: databaseTimestampSchema,
    by: z.string().uuid(),
    from: z.string(),
    to: z.string(),
    note: z.string().default(''),
  }).passthrough()),
  created_at: databaseTimestampSchema,
  updated_at: databaseTimestampSchema,
  reviewed_at: databaseTimestampSchema.nullable(),
  reviewed_by: z.string().uuid().nullable(),
});

const secureDeviceSchema = z.object({
  user_id: z.string().uuid(),
  device_id: z.string().uuid(),
  label: z.string().min(1).max(80),
  platform: z.string().max(120),
  created_at: databaseTimestampSchema,
  last_seen_at: databaseTimestampSchema,
  revoked_at: databaseTimestampSchema.nullable(),
  revoked_by: z.string().uuid().nullable(),
});

const contentPackageRowSchema = z.object({
  scope: z.enum(['admin', 'members']),
  version: z.string().min(1),
  manifest: libraryManifestSchema,
  package_bytes: z.number().int().positive(),
  chunk_count: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const contentPackageChunkSchema = z.object({
  chunk_index: z.number().int().nonnegative(),
  byte_size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  data_base64: z.string().min(1),
});

export type SecureProfile = z.infer<typeof secureProfileSchema>;
export type RemoteSongSubmission = z.infer<typeof remoteSubmissionSchema>;
export type SharedSetlist = z.infer<typeof sharedSetlistSchema>;
export type SongCorrection = z.infer<typeof songCorrectionSchema>;
export type SecureDevice = z.infer<typeof secureDeviceSchema>;

export interface SecureSession {
  access_token: string;
  expires_at: string;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    user_metadata: { display_name: string };
  };
}

export type SecureAuthChangeEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'PASSWORD_RECOVERY';

export interface ApprovedLibraryDownloadResult {
  count: number;
  changed: boolean;
  manifest: LibraryManifest | null;
}

export const offlineGrantIssuer = neonAuthIssuer;
export const offlineGrantAudience = neonAuthIssuer;
export const offlineGrantJwksUrl = neonAuthJwksUrl;
export const offlineGrantClientConfigured = Boolean(neonAuthIssuer && neonAuthJwksUrl);
export const secureAccessConfigured = import.meta.env.MODE !== 'e2e' && neonClientConfigured;
export const secureAccessRequired = import.meta.env.MODE !== 'e2e' && import.meta.env.VITE_REQUIRE_SECURE_ACCESS === 'true';
export const secureAccessConfigurationError = secureAccessRequired && !secureAccessConfigured
  ? 'Neon Auth nebo Neon Data API zatím nejsou připojené. Správce musí doplnit obě veřejné HTTPS adresy.'
  : null;

const sessionListeners = new Set<(event: SecureAuthChangeEvent, session: SecureSession | null) => void>();
let bootstrapSession: SecureSession | null = null;

function emitSession(event: SecureAuthChangeEvent, session: SecureSession | null): void {
  for (const listener of sessionListeners) listener(event, session);
}

function appRedirectUrl(extraQuery = ''): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  if (extraQuery) url.search = extraQuery;
  return url.toString();
}

export class SecureAccessError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) {
    super(message);
    this.name = 'SecureAccessError';
  }
}

function readableError(error: { message?: string; status?: number; statusCode?: number | string; code?: string } | null, fallback: string): Error {
  const message = error?.message?.toLowerCase() ?? '';
  const normalizedCode = error?.code?.toLowerCase() ?? '';
  const rawStatus = error?.status ?? error?.statusCode;
  const status = typeof rawStatus === 'number' ? rawStatus : typeof rawStatus === 'string' && /^\d+$/.test(rawStatus) ? Number(rawStatus) : undefined;
  const code = error?.code;
  if (message.includes('otp expired') || normalizedCode.includes('otp_expired')) return new SecureAccessError('Platnost kódu vypršela. Pošlete si nový kód a použijte pouze ten nejnovější.', status, code);
  if (message.includes('invalid otp') || normalizedCode.includes('invalid_otp')) return new SecureAccessError('Kód není platný. Pošlete si nový kód a opište pouze nejnovější zprávu.', status, code);
  if (message.includes('too many attempts') || normalizedCode.includes('too_many_attempts')) return new SecureAccessError('Proběhlo příliš mnoho pokusů. Pošlete si nový kód a použijte jej do pěti minut.', status, code);
  if (message.includes('invalid') && (message.includes('password') || message.includes('credential'))) return new SecureAccessError('E-mail nebo heslo není správné. Pokud jste dosud používali starý účet, jednorázově si v Neonu nastavte nové heslo přes „Zapomenuté heslo“.', status, code);
  if (message.includes('email not verified') || message.includes('email_not_verified')) return new SecureAccessError('Nejprve ověřte e-mail pomocí kódu, který vám přišel.', status, code);
  if (message.includes('already') && (message.includes('user') || message.includes('email'))) return new SecureAccessError('Účet s tímto e-mailem už v Neonu existuje. Použijte přihlášení nebo obnovu hesla.', status, code);
  if (message.includes('password')) return new SecureAccessError('Heslo nesplňuje bezpečnostní požadavky.', status, code);
  if (message.includes('origin')) return new SecureAccessError('Tato adresa aplikace není v Neon Auth povolená. Obraťte se na správce.', status, code);
  return new SecureAccessError(error?.message || fallback, status, code);
}

function normalizeSession(data: Awaited<ReturnType<ReturnType<typeof requireNeonClient>['auth']['getSession']>>['data']): SecureSession | null {
  if (!data?.session || !data.user) return null;
  return {
    access_token: data.session.token,
    expires_at: new Date(data.session.expiresAt).toISOString(),
    user: {
      id: data.user.id,
      email: data.user.email,
      emailVerified: data.user.emailVerified,
      user_metadata: { display_name: data.user.name || data.user.email.split('@')[0] || 'Člen' },
    },
  };
}

function jwtExpiry(token: string): string | null {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)))) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? new Date(payload.exp * 1_000).toISOString()
      : null;
  } catch {
    return null;
  }
}

function sessionIsUsable(session: SecureSession | null): session is SecureSession {
  return Boolean(session && Date.parse(session.expires_at) > Date.now() + 5_000);
}

async function jwtFromSessionToken(sessionToken: string): Promise<string | null> {
  if (!neonAuthUrl || !sessionToken) return null;
  const response = await fetch(`${neonAuthUrl}/token`, {
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as { token?: unknown } | null;
  return typeof data?.token === 'string' ? data.token : null;
}

async function sessionFromSignInResponse(
  data: { token: string; user: { id: string; email: string; emailVerified: boolean; name: string } } | null,
): Promise<SecureSession | null> {
  if (!data?.user) return null;
  // Safari v PWA může odmítnout third-party cookie Neon Auth. OTP endpoint však
  // vrací krátký session token a Neonův bearer plugin jej umí bezpečně vyměnit
  // za podepsaný JWT bez závislosti na cookie.
  const token = consumePendingNeonAuthJwt(data.user.id) ?? await jwtFromSessionToken(data.token);
  const expiresAt = token ? jwtExpiry(token) : null;
  if (!token || !expiresAt) return null;
  return {
    access_token: token,
    expires_at: expiresAt,
    user: {
      id: data.user.id,
      email: data.user.email,
      emailVerified: data.user.emailVerified,
      user_metadata: { display_name: data.user.name || data.user.email.split('@')[0] || 'Člen' },
    },
  };
}

export function subscribeToSecureSession(callback: (event: SecureAuthChangeEvent, session: SecureSession | null) => void): () => void {
  sessionListeners.add(callback);
  // Úvodní relaci načítá jediný koordinovaný refresh v useSecureAccount.
  // Tady sledujeme pouze skutečné změny a případný recovery odkaz, abychom
  // při každém otevření neposílali druhý souběžný požadavek na Neon Auth.
  const recoveryTimer = window.setTimeout(() => {
    if (new URL(window.location.href).searchParams.has('token')) callback('PASSWORD_RECOVERY', null);
  }, 0);
  return () => {
    window.clearTimeout(recoveryTimer);
    sessionListeners.delete(callback);
  };
}

export async function getSecureSession(): Promise<SecureSession | null> {
  if (sessionIsUsable(bootstrapSession)) return bootstrapSession;
  bootstrapSession = null;
  const { data, error } = await requireNeonClient().auth.getSession({
    fetchOptions: { headers: { 'X-Force-Fetch': 'true' } },
  });
  if (error) throw readableError(error, 'Přihlášení se nepodařilo načíst z Neon Auth.');
  const session = normalizeSession(data);
  if (sessionIsUsable(session)) bootstrapSession = session;
  return session;
}

export async function registerSecureAccount(input: { displayName: string; email: string; password: string }): Promise<{ needsEmailConfirmation: boolean }> {
  const { data, error } = await requireNeonClient().auth.signUp.email({
    name: input.displayName.trim(),
    email: input.email.trim().toLocaleLowerCase('cs'),
    password: input.password,
    callbackURL: appRedirectUrl(),
  });
  if (error) throw readableError(error, 'Registraci v Neon Auth se nepodařilo dokončit.');
  const needsEmailConfirmation = data?.user?.emailVerified !== true;
  // Neon může po registraci vydat relaci ještě před ověřením e-mailu. Takovou
  // relaci nesmíme pustit k profilu ani použít pro převzetí migrovaného účtu.
  if (needsEmailConfirmation) {
    await requireNeonClient().auth.signOut().catch(() => undefined);
  } else {
    const session = await getSecureSession().catch(() => null);
    if (session) emitSession('SIGNED_IN', session);
  }
  return { needsEmailConfirmation };
}

export async function sendEmailVerificationCode(email: string): Promise<void> {
  const { error } = await requireNeonClient().auth.emailOtp.sendVerificationOtp({
    email: email.trim().toLocaleLowerCase('cs'),
    type: 'email-verification',
  });
  if (error) throw readableError(error, 'Ověřovací kód se nepodařilo odeslat.');
}

export async function sendEmailSignInCode(email: string): Promise<void> {
  const { error } = await requireNeonClient().auth.emailOtp.sendVerificationOtp({
    email: email.trim().toLocaleLowerCase('cs'),
    type: 'sign-in',
  });
  if (error) throw readableError(error, 'Přihlašovací kód se nepodařilo odeslat.');
}

export async function signInSecureAccountWithCode(email: string, otp: string): Promise<void> {
  clearPendingNeonAuthJwt();
  const { data, error } = await requireNeonClient().auth.signIn.emailOtp({
    email: email.trim().toLocaleLowerCase('cs'),
    otp: otp.trim(),
  });
  if (error) throw readableError(error, 'Přihlašovací kód není platný nebo už vypršel.');
  const directSession = await sessionFromSignInResponse(data);
  if (directSession) bootstrapSession = directSession;
  const session = directSession ?? await getSecureSession();
  if (!session?.user.emailVerified) throw new SecureAccessError('Neon Auth nevytvořil ověřenou relaci. Vyžádejte si nový kód.');
}

export async function sendMigratedPasswordSetupCode(email: string): Promise<void> {
  const { error } = await requireNeonClient().auth.emailOtp.requestPasswordReset({
    email: email.trim().toLocaleLowerCase('cs'),
  });
  if (error) throw readableError(error, 'Kód pro nastavení nového hesla se nepodařilo odeslat.');
}

export async function completeMigratedPasswordSetup(email: string, otp: string, password: string): Promise<void> {
  if (password.length < 10) throw new SecureAccessError('Heslo musí mít alespoň 10 znaků.');
  const { error } = await requireNeonClient().auth.emailOtp.resetPassword({
    email: email.trim().toLocaleLowerCase('cs'),
    otp: otp.trim(),
    password,
  });
  if (error) throw readableError(error, 'Nové heslo se nepodařilo nastavit. Zkontrolujte nejnovější kód.');
  await signInSecureAccount(email, password);
}

export async function verifyEmailVerificationCode(email: string, otp: string, password?: string): Promise<void> {
  const { error } = await requireNeonClient().auth.emailOtp.verifyEmail({
    email: email.trim().toLocaleLowerCase('cs'),
    otp: otp.trim(),
  });
  if (error) throw readableError(error, 'Ověřovací kód není platný nebo už vypršel.');
  // Ověření e-mailu samo nemusí po předchozím bezpečnostním odhlášení obnovit
  // cookie relace. Heslo zůstává jen v paměti formuláře a použije se jednou.
  let directSession: SecureSession | null = null;
  if (password) {
    clearPendingNeonAuthJwt();
    const { data: signInData, error: signInError } = await requireNeonClient().auth.signIn.email({
      email: email.trim().toLocaleLowerCase('cs'),
      password,
      callbackURL: appRedirectUrl(),
    });
    if (signInError) throw readableError(signInError, 'E-mail je ověřený, ale přihlášení se nepodařilo dokončit.');
    directSession = await sessionFromSignInResponse(signInData);
    if (directSession) bootstrapSession = directSession;
  }
  const session = directSession ?? await getSecureSession();
  if (!session?.user.emailVerified) throw new SecureAccessError('E-mail se nepodařilo bezpečně ověřit. Vyžádejte si nový kód.');
  emitSession('SIGNED_IN', session);
}

export async function signInSecureAccount(email: string, password: string): Promise<void> {
  clearPendingNeonAuthJwt();
  const { data, error } = await requireNeonClient().auth.signIn.email({
    email: email.trim().toLocaleLowerCase('cs'),
    password,
    callbackURL: appRedirectUrl(),
  });
  if (error) throw readableError(error, 'Přihlášení přes Neon Auth se nepodařilo.');
  const directSession = await sessionFromSignInResponse(data);
  if (directSession) bootstrapSession = directSession;
  const session = directSession ?? await getSecureSession();
  if (!session) throw new SecureAccessError('Neon Auth nevytvořil platnou relaci. Zkuste přihlášení zopakovat.');
  if (!session.user.emailVerified) {
    await requireNeonClient().auth.signOut().catch(() => undefined);
    throw new SecureAccessError('Tento Neon účet ještě nemá ověřený e-mail. Na přihlašovací stránce zvolte „Aktivovat původní účet“ a dokončete ověření kódem.');
  }
  emitSession('SIGNED_IN', session);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await requireNeonClient().auth.requestPasswordReset({
    email: email.trim().toLocaleLowerCase('cs'),
    redirectTo: appRedirectUrl('?password-recovery=1'),
  });
  if (error) throw readableError(error, 'Odkaz pro obnovu hesla se nepodařilo odeslat z Neon Auth.');
}

export async function updateSecurePassword(password: string): Promise<void> {
  if (password.length < 10) throw new Error('Heslo musí mít alespoň 10 znaků.');
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) throw new Error('Odkaz pro obnovu hesla je neplatný nebo už vypršel. Vyžádejte si nový.');
  const { error } = await requireNeonClient().auth.resetPassword({ newPassword: password, token });
  if (error) throw readableError(error, 'Nové heslo se nepodařilo uložit v Neon Auth.');
  url.searchParams.delete('token');
  url.searchParams.delete('password-recovery');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

export async function signOutSecureAccount(): Promise<void> {
  const session = await getSecureSession().catch(() => null);
  const { error } = await requireNeonClient().auth.signOut();
  bootstrapSession = null;
  clearPendingNeonAuthJwt();
  await clearSecureAccountLocalData(session?.user.id);
  emitSession('SIGNED_OUT', null);
  if (error) throw readableError(error, 'Serverové odhlášení z Neonu se nepodařilo, místní oprávnění však bylo odstraněno.');
}

export async function beginMigratedAccountActivation(): Promise<void> {
  bootstrapSession = null;
  clearPendingNeonAuthJwt();
  const { error } = await requireNeonClient().auth.signOut();
  // Při jednorázové aktivaci rušíme jen starou relaci a offline grant. Stažený
  // balíček zůstane na zařízení a po propojení stejného profilu se znovu použije.
  await clearSecureAuthorizationData();
  emitSession('SIGNED_OUT', null);
  if (error) throw readableError(error, 'Starou relaci se nepodařilo ukončit. Zkuste aktivaci znovu online.');
}

export async function requestNeonSessionJwt(): Promise<string> {
  if (!neonAuthUrl) throw new SecureAccessError('Neon Auth není nakonfigurovaný.', 503, 'neon_auth_not_configured');
  if (sessionIsUsable(bootstrapSession)) return bootstrapSession.access_token;
  const response = await fetch(`${neonAuthUrl}/token`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  let data: unknown = null;
  try { data = await response.json(); } catch { /* Zpracuje se níže. */ }
  const token = data && typeof data === 'object' && typeof (data as { token?: unknown }).token === 'string'
    ? (data as { token: string }).token
    : '';
  if (!response.ok || !token) throw new SecureAccessError('Neon Auth nevydal autorizační token.', response.status, 'neon_token_failed');
  return token;
}

export async function loadNeonPublicJwks(): Promise<unknown> {
  if (!neonAuthJwksUrl) throw new SecureAccessError('Veřejné klíče Neon Auth nejsou nakonfigurované.', 503, 'neon_jwks_not_configured');
  const response = await fetch(neonAuthJwksUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new SecureAccessError('Veřejné klíče Neon Auth se nepodařilo načíst.', response.status, 'neon_jwks_failed');
  return response.json();
}

async function requireSecureAccessToken(): Promise<string> {
  return requestNeonSessionJwt();
}

const PROFILE_SELECT = 'id,auth_user_id,email,display_name,status,role,created_at,reviewed_at,last_seen_at';

export async function loadSecureProfile(): Promise<SecureProfile | null> {
  const session = await getSecureSession();
  if (!session) return null;
  const token = await requireSecureAccessToken();
  await neonRpc('ensure_my_profile', token, {
    requested_email: session.user.email,
    requested_display_name: session.user.user_metadata.display_name,
  });
  const rows = await neonSelect<unknown>('profiles', token, {
    select: PROFILE_SELECT,
    auth_user_id: `eq.${session.user.id}`,
    limit: '1',
  });
  return rows[0] ? secureProfileSchema.parse(rows[0]) : null;
}

export async function loadPendingProfiles(): Promise<SecureProfile[]> {
  const rows = await neonSelect<unknown>('profiles', await requireSecureAccessToken(), {
    select: PROFILE_SELECT,
    status: 'eq.pending',
    order: 'created_at.asc',
  });
  return z.array(secureProfileSchema).parse(rows);
}

export async function loadAllProfiles(): Promise<SecureProfile[]> {
  const rows = await neonSelect<unknown>('profiles', await requireSecureAccessToken(), {
    select: PROFILE_SELECT,
    order: 'display_name.asc',
  });
  return z.array(secureProfileSchema).parse(rows);
}

export async function touchSecurePresence(): Promise<void> {
  await neonRpc('touch_my_presence', await requireSecureAccessToken());
}

export async function reviewSecureProfile(userId: string, decision: 'approved' | 'rejected'): Promise<void> {
  await neonRpc('review_account', await requireSecureAccessToken(), { target_user_id: userId, decision });
}

export async function setSecureProfileStatus(userId: string, status: 'approved' | 'rejected' | 'suspended'): Promise<void> {
  const changed = await neonRpc<boolean>('set_account_status', await requireSecureAccessToken(), { target_user_id: userId, desired_status: status });
  if (changed !== true) throw new Error('Stav účtu nebyl změněn. Ověřte oprávnění a aktuální stav profilu.');
}

function currentDeviceLabel(): { label: string; platform: string } {
  const platform = navigator.userAgent.slice(0, 120);
  const mobile = /iphone|ipad|android|mobile/i.test(platform);
  const family = /iphone|ipad/i.test(platform) ? 'Apple iOS' : /android/i.test(platform) ? 'Android' : /windows/i.test(platform) ? 'Windows' : /macintosh/i.test(platform) ? 'macOS' : 'Webový prohlížeč';
  return { label: `${family} · ${mobile ? 'telefon/tablet' : 'počítač'}`, platform };
}

export async function registerSecureDevice(deviceId: string, accessToken?: string): Promise<void> {
  const { label, platform } = currentDeviceLabel();
  const registered = await neonRpc<boolean>('register_my_device', accessToken ?? await requireSecureAccessToken(), {
    target_device_id: deviceId,
    target_label: label,
    target_platform: platform,
  });
  if (registered !== true) throw new Error('Toto zařízení nelze autorizovat. Mohlo být správcem odvoláno.');
}

export async function loadMySecureDevices(profileId: string): Promise<SecureDevice[]> {
  const rows = await neonSelect<unknown>('user_devices', await requireSecureAccessToken(), {
    select: '*', user_id: `eq.${profileId}`, order: 'last_seen_at.desc',
  });
  return z.array(secureDeviceSchema).parse(rows);
}

export async function loadAllSecureDevices(): Promise<SecureDevice[]> {
  const rows = await neonSelect<unknown>('user_devices', await requireSecureAccessToken(), { select: '*', order: 'last_seen_at.desc' });
  return z.array(secureDeviceSchema).parse(rows);
}

export async function revokeSecureDevice(userId: string, deviceId: string): Promise<void> {
  const revoked = await neonRpc<boolean>('revoke_device', await requireSecureAccessToken(), { target_user_id: userId, target_device_id: deviceId });
  if (revoked !== true) throw new Error('Zařízení nebylo odvoláno. Zkontrolujte oprávnění nebo zda je ještě aktivní.');
}

function safeFileName(value: string): string {
  const cleaned = value.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 120) || 'podklad';
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
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

  const token = await requireSecureAccessToken();
  const id = createUuid();
  const fileBytes = input.file ? new Uint8Array(await readBlobBytes(input.file)) : null;
  const chunkSize = 512 * 1024;
  const fileChunkCount = fileBytes ? Math.ceil(fileBytes.length / chunkSize) : 0;
  const row = {
    id,
    user_id: input.profile.id,
    kind: input.kind,
    title: input.title.trim(),
    artist: input.artist?.trim() ?? '',
    notes: input.notes?.trim() ?? '',
    file_path: input.file ? `neon-chunks:${id}/${safeFileName(input.file.name)}` : null,
    file_name: input.file?.name ?? null,
    file_type: input.file?.type || null,
    file_size: input.file?.size ?? 0,
    file_sha256: fileBytes ? await sha256Bytes(fileBytes) : null,
    file_chunk_count: fileChunkCount,
    upload_complete: !input.file,
    rights_status: 'requires_review' as const,
    license: 'UNVERIFIED - requires admin review',
    attribution: input.profile.display_name,
    status: 'pending_review' as const,
    admin_note: '',
  };
  try {
    const inserted = await neonInsert<unknown>('song_submissions', token, row);
    if (fileBytes) {
      for (let chunkIndex = 0; chunkIndex < fileChunkCount; chunkIndex += 1) {
        const chunk = fileBytes.subarray(chunkIndex * chunkSize, Math.min((chunkIndex + 1) * chunkSize, fileBytes.length));
        await neonInsert('song_submission_files', token, {
          submission_id: id,
          chunk_index: chunkIndex,
          byte_size: chunk.length,
          sha256: await sha256Bytes(chunk),
          data_base64: encodeBase64(chunk),
        });
      }
      await neonRpc('complete_my_song_upload', token, { target_submission_id: id });
    }
    return remoteSubmissionSchema.parse(inserted[0]);
  } catch (error) {
    if (fileBytes) await neonRpc('abort_my_song_upload', token, { target_submission_id: id }).catch(() => undefined);
    throw readableError(error instanceof Error ? error : null, 'Návrh se nepodařilo odeslat do Neonu.');
  }
}

export async function loadRemoteSongSubmissions(): Promise<RemoteSongSubmission[]> {
  const rows = await neonSelect<unknown>('song_submissions', await requireSecureAccessToken(), { select: '*', order: 'created_at.desc' });
  return z.array(remoteSubmissionSchema).parse(rows);
}

export async function reviewRemoteSongSubmission(submissionId: string, decision: 'accepted_for_review' | 'rejected', adminNote = ''): Promise<void> {
  await neonRpc('review_song_submission', await requireSecureAccessToken(), {
    target_submission_id: submissionId,
    decision,
    note: adminNote.trim(),
  });
}

export async function submitSongCorrection(input: {
  songId: string;
  songTitle: string;
  originalValue?: string;
  proposedValue?: string;
  note: string;
}): Promise<string> {
  const id = createUuid();
  const submittedId = await neonRpc<string | null>('submit_my_song_correction', await requireSecureAccessToken(), {
    target_id: id,
    target_song_id: input.songId,
    target_song_title: input.songTitle,
    target_original_value: input.originalValue?.trim() ?? '',
    target_proposed_value: input.proposedValue?.trim() ?? '',
    target_note: input.note.trim(),
  });
  if (submittedId !== id) throw new Error('Návrh opravy nebyl přijat. Účet musí být schválený.');
  return id;
}

export async function loadSongCorrections(): Promise<SongCorrection[]> {
  const rows = await neonSelect<unknown>('song_corrections', await requireSecureAccessToken(), { select: '*', order: 'created_at.desc' });
  return z.array(songCorrectionSchema).parse(rows);
}

export async function reviewSongCorrection(input: {
  id: string;
  decision: 'accepted' | 'rejected' | 'pending';
  note?: string;
  proposedValue?: string;
}): Promise<void> {
  const reviewed = await neonRpc<boolean>('review_song_correction', await requireSecureAccessToken(), {
    target_correction_id: input.id,
    decision: input.decision,
    note: input.note?.trim() ?? '',
    edited_proposed_value: input.proposedValue?.trim() || null,
  });
  if (reviewed !== true) throw new Error('Rozhodnutí nebylo uloženo. Ověřte oprávnění nebo existenci návrhu.');
}

export async function loadSharedSetlists(): Promise<SharedSetlist[]> {
  const rows = await neonRpc<unknown[]>('list_shared_setlists', await requireSecureAccessToken());
  return z.array(sharedSetlistSchema).parse(rows);
}

export async function publishMySetlist(input: {
  id: string;
  sourceSetlistId: string;
  name: string;
  songIds: string[];
}): Promise<string> {
  return neonRpc<string>('publish_my_setlist', await requireSecureAccessToken(), {
    target_id: input.id,
    target_source_setlist_id: input.sourceSetlistId,
    target_name: input.name.trim(),
    target_song_ids: input.songIds,
  });
}

export async function updateSharedSetlist(id: string, name: string, songIds: string[]): Promise<void> {
  await neonRpc('update_shared_setlist', await requireSecureAccessToken(), {
    target_shared_setlist_id: id,
    target_name: name.trim(),
    target_song_ids: songIds,
  });
}

export async function deleteSharedSetlist(id: string): Promise<void> {
  await neonRpc('delete_shared_setlist', await requireSecureAccessToken(), { target_shared_setlist_id: id });
}

function libraryScope(profile: SecureProfile): 'admin' | 'members' {
  return profile.role === 'admin' ? 'admin' : 'members';
}

async function loadContentPackageRow(profile: SecureProfile) {
  const scope = libraryScope(profile);
  const rows = await neonSelect<unknown>('content_packages', await requireSecureAccessToken(), {
    select: 'scope,version,manifest,package_bytes,chunk_count,sha256',
    scope: `eq.${scope}`,
    is_active: 'eq.true',
    limit: '1',
  });
  return rows[0] ? contentPackageRowSchema.parse(rows[0]) : null;
}

export async function loadApprovedLibraryManifest(profile: SecureProfile): Promise<LibraryManifest | null> {
  return (await loadContentPackageRow(profile))?.manifest ?? null;
}

export async function downloadApprovedLibrary(
  profile: SecureProfile,
  options: { force?: boolean; localSongCount?: number } = {},
): Promise<ApprovedLibraryDownloadResult> {
  const packageRow = await loadContentPackageRow(profile);
  if (!packageRow) throw new Error(profile.role === 'admin' ? 'Soukromá správcovská knihovna zatím není v Neonu připravená.' : 'Soukromá členská knihovna zatím není v Neonu připravená.');
  const localMetadata = await loadDownloadedLibraryMetadata();
  if (!options.force && localMetadata?.version === packageRow.manifest.version && options.localSongCount === packageRow.manifest.songCount) {
    return { count: packageRow.manifest.songCount, changed: false, manifest: packageRow.manifest };
  }
  const scope = libraryScope(profile);
  const rawChunks = await neonSelect<unknown>('content_package_chunks', await requireSecureAccessToken(), {
    select: 'chunk_index,byte_size,sha256,data_base64',
    scope: `eq.${scope}`,
    version: `eq.${packageRow.version}`,
    order: 'chunk_index.asc',
  });
  const chunks = z.array(contentPackageChunkSchema).parse(rawChunks);
  if (chunks.length !== packageRow.chunk_count) throw new Error('Balíček v Neonu není úplný. Původní knihovna zůstala zachovaná.');
  const verifiedChunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk.chunk_index !== index) throw new Error('Pořadí částí knihovny je poškozené.');
    const bytes = decodeBase64(chunk.data_base64);
    if (bytes.length !== chunk.byte_size || await sha256Bytes(bytes) !== chunk.sha256) throw new Error('Kontrolní součet části knihovny nesouhlasí.');
    verifiedChunks.push(bytes);
    totalBytes += bytes.length;
  }
  if (totalBytes !== packageRow.package_bytes) throw new Error('Stažený balíček nemá očekávanou velikost. Původní knihovna zůstala zachovaná.');
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of verifiedChunks) { combined.set(chunk, offset); offset += chunk.length; }
  if (await sha256Bytes(combined) !== packageRow.sha256) throw new Error('Kontrolní součet celé knihovny nesouhlasí. Původní knihovna zůstala zachovaná.');
  const imported = await importFullBackup(new Blob([combined], { type: 'application/json' }), {
    replaceDownloadedLibrary: true,
    expectedLibraryScope: scope,
    ownerUserId: profile.id,
    verifiedManifest: packageRow.manifest,
  });
  return { count: imported.personalSongCount, changed: true, manifest: packageRow.manifest };
}

export async function loadCloudUserState(): Promise<UserState | null> {
  const rows = await neonSelect<{ state: unknown }>('user_app_state', await requireSecureAccessToken(), { select: 'state', limit: '1' });
  if (!rows[0]) return null;
  const parsed = migrateUserState(rows[0].state);
  if (!parsed) throw new Error('Synchronizovaná uživatelská data mají neplatný formát.');
  return parsed;
}

export async function saveCloudUserState(state: UserState): Promise<void> {
  const profile = await loadSecureProfile();
  if (!profile) throw new Error('Pro synchronizaci je nutné přihlášení přes Neon Auth.');
  await neonUpsert('user_app_state', await requireSecureAccessToken(), {
    user_id: profile.id,
    state,
    updated_at: new Date().toISOString(),
  }, 'user_id');
}
