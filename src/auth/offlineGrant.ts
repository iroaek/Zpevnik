import { z } from 'zod';

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

export const offlineGrantPayloadSchema = z.object({
  version: z.literal(1),
  issuer: z.string().url(),
  audience: z.string().min(1).max(120),
  subject: z.string().uuid(),
  displayName: z.string().trim().min(2).max(60).optional(),
  scopes: z.array(z.string().min(1).max(100)).max(30),
  contentPackages: z.array(z.string().min(1).max(120)).min(1).max(20),
  contentVersion: z.string().min(1).max(128),
  issuedAt: z.string().datetime({ offset: true }),
  notBefore: z.string().datetime({ offset: true }),
  offlineValidUntil: z.string().datetime({ offset: true }),
  keyId: z.string().min(1).max(120),
  deviceId: z.string().min(8).max(200).optional(),
});

const protectedJwsHeaderSchema = z.object({
  alg: z.literal('ES256'),
  typ: z.literal('JWT').optional(),
  kid: z.string().min(1).max(120),
});

export const offlineGrantKeySetSchema = z.object({
  keys: z.array(z.object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: z.string().regex(base64UrlPattern),
    y: z.string().regex(base64UrlPattern),
    kid: z.string().min(1),
    use: z.literal('sig').optional(),
    alg: z.literal('ES256').optional(),
  }).passthrough()).min(1),
});

export type OfflineGrantPayload = z.infer<typeof offlineGrantPayloadSchema>;
export type OfflineGrantKeySet = z.infer<typeof offlineGrantKeySetSchema>;

const neonProtectedHeaderSchema = z.object({
  alg: z.literal('EdDSA'),
  typ: z.literal('JWT').optional(),
  kid: z.string().min(1).max(200),
});

const neonSessionClaimsSchema = z.object({
  iss: z.string().url(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().uuid(),
  id: z.string().uuid().optional(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  role: z.string().min(1).max(60),
  banned: z.boolean().default(false),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export const neonOfflineKeySetSchema = z.object({
  keys: z.array(z.object({
    kty: z.literal('OKP'),
    crv: z.literal('Ed25519'),
    x: z.string().regex(base64UrlPattern),
    kid: z.string().min(1),
    alg: z.literal('EdDSA').optional(),
  }).passthrough()).min(1),
});

export type NeonOfflineKeySet = z.infer<typeof neonOfflineKeySetSchema>;

export interface VerifiedOfflineGrant {
  token: string;
  payload: OfflineGrantPayload;
  verifiedAt: string;
}

export type OfflineGrantValidationReason =
  | 'malformed'
  | 'unsupported-algorithm'
  | 'unknown-key'
  | 'invalid-signature'
  | 'wrong-issuer'
  | 'wrong-audience'
  | 'wrong-device'
  | 'wrong-package'
  | 'not-active'
  | 'expired';

export class OfflineGrantValidationError extends Error {
  constructor(public readonly reason: OfflineGrantValidationReason, message: string) {
    super(message);
    this.name = 'OfflineGrantValidationError';
  }
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!base64UrlPattern.test(value)) throw new OfflineGrantValidationError('malformed', 'Offline oprávnění má neplatné kódování.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
  } catch (error) {
    if (error instanceof OfflineGrantValidationError) throw error;
    throw new OfflineGrantValidationError('malformed', 'Offline oprávnění není platný JWS dokument.');
  }
}

export interface VerifyOfflineGrantOptions {
  issuer: string;
  audience: string;
  keySet: OfflineGrantKeySet;
  requiredPackage?: string;
  deviceId?: string;
  now?: number;
  clockToleranceMs?: number;
}

export interface VerifyNeonOfflineGrantOptions {
  issuer: string;
  audience: string;
  keySet: NeonOfflineKeySet;
  profile: {
    id: string;
    auth_user_id: string | null;
    email: string;
    display_name: string;
    status: 'pending' | 'approved' | 'rejected' | 'suspended';
    role: 'member' | 'admin';
  };
  contentVersion: string;
  deviceId?: string;
  offlineDays?: number;
  now?: number;
  clockToleranceMs?: number;
}

export async function verifyOfflineGrant(token: string, options: VerifyOfflineGrantOptions): Promise<VerifiedOfflineGrant> {
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => !segment)) {
    throw new OfflineGrantValidationError('malformed', 'Offline oprávnění má neplatný formát.');
  }
  const headerResult = protectedJwsHeaderSchema.safeParse(decodeJson(segments[0]));
  if (!headerResult.success) throw new OfflineGrantValidationError('unsupported-algorithm', 'Offline oprávnění nepoužívá podporovaný podpis ES256.');
  const payloadResult = offlineGrantPayloadSchema.safeParse(decodeJson(segments[1]));
  if (!payloadResult.success) throw new OfflineGrantValidationError('malformed', 'Offline oprávnění nemá platný obsah.');
  const header = headerResult.data;
  const payload = payloadResult.data;
  if (header.kid !== payload.keyId) throw new OfflineGrantValidationError('unknown-key', 'Identifikátor podpisového klíče nesouhlasí.');
  const parsedKeySet = offlineGrantKeySetSchema.parse(options.keySet);
  const key = parsedKeySet.keys.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new OfflineGrantValidationError('unknown-key', 'Podpisový klíč offline oprávnění není známý.');
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    key as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const validSignature = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    decodeBase64Url(segments[2]),
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
  if (!validSignature) throw new OfflineGrantValidationError('invalid-signature', 'Podpis offline oprávnění není platný.');
  if (payload.issuer !== options.issuer) throw new OfflineGrantValidationError('wrong-issuer', 'Offline oprávnění vydal jiný server.');
  if (payload.audience !== options.audience) throw new OfflineGrantValidationError('wrong-audience', 'Offline oprávnění není určené pro tuto aplikaci.');
  if (options.deviceId && payload.deviceId && payload.deviceId !== options.deviceId) {
    throw new OfflineGrantValidationError('wrong-device', 'Offline oprávnění patří jinému zařízení.');
  }
  if (options.requiredPackage && !payload.contentPackages.includes(options.requiredPackage)) {
    throw new OfflineGrantValidationError('wrong-package', 'Offline oprávnění nepovoluje tento obsahový balíček.');
  }
  const now = options.now ?? Date.now();
  const tolerance = options.clockToleranceMs ?? 5 * 60_000;
  const notBefore = Date.parse(payload.notBefore);
  const expiresAt = Date.parse(payload.offlineValidUntil);
  if (notBefore > now + tolerance) throw new OfflineGrantValidationError('not-active', 'Offline oprávnění ještě není platné.');
  if (expiresAt <= now - tolerance) throw new OfflineGrantValidationError('expired', 'Offline oprávnění vypršelo. Připojte se k internetu a obnovte je.');
  return { token, payload, verifiedAt: new Date(now).toISOString() };
}

export async function verifyNeonOfflineGrant(token: string, options: VerifyNeonOfflineGrantOptions): Promise<VerifiedOfflineGrant> {
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => !segment)) {
    throw new OfflineGrantValidationError('malformed', 'Neon offline oprávnění má neplatný formát.');
  }
  const headerResult = neonProtectedHeaderSchema.safeParse(decodeJson(segments[0]));
  if (!headerResult.success) throw new OfflineGrantValidationError('unsupported-algorithm', 'Neon offline oprávnění nepoužívá podporovaný podpis Ed25519.');
  const claimsResult = neonSessionClaimsSchema.safeParse(decodeJson(segments[1]));
  if (!claimsResult.success) throw new OfflineGrantValidationError('malformed', 'Neon offline oprávnění nemá platné autorizační údaje.');
  const header = headerResult.data;
  const claims = claimsResult.data;
  const keySet = neonOfflineKeySetSchema.parse(options.keySet);
  const key = keySet.keys.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new OfflineGrantValidationError('unknown-key', 'Podpisový klíč Neon offline oprávnění není známý.');
  const cryptoKey = await crypto.subtle.importKey('jwk', key as JsonWebKey, 'Ed25519', false, ['verify']);
  const validSignature = await crypto.subtle.verify(
    'Ed25519',
    cryptoKey,
    decodeBase64Url(segments[2]),
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
  if (!validSignature) throw new OfflineGrantValidationError('invalid-signature', 'Podpis Neon offline oprávnění není platný.');
  if (claims.iss !== options.issuer) throw new OfflineGrantValidationError('wrong-issuer', 'Offline oprávnění vydal jiný Neon Auth server.');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(options.audience)) throw new OfflineGrantValidationError('wrong-audience', 'Offline oprávnění není určené pro tuto aplikaci.');
  if (!options.profile.auth_user_id || claims.sub !== options.profile.auth_user_id) {
    throw new OfflineGrantValidationError('malformed', 'Neon účet a místní profil si neodpovídají.');
  }
  if (claims.email.toLocaleLowerCase('cs') !== options.profile.email.toLocaleLowerCase('cs')) {
    throw new OfflineGrantValidationError('malformed', 'Neon účet používá jiný e-mail než místní profil.');
  }
  if (options.profile.status !== 'approved' || claims.banned || claims.role !== options.profile.role) {
    throw new OfflineGrantValidationError('wrong-package', 'Neon účet nemá schválený přístup k tomuto obsahovému balíčku.');
  }
  const requiredPackage = options.profile.role === 'admin' ? 'admin' : 'members';
  const issuedAtMs = claims.iat * 1000;
  const now = options.now ?? Date.now();
  const tolerance = options.clockToleranceMs ?? 5 * 60_000;
  if (issuedAtMs > now + tolerance) throw new OfflineGrantValidationError('not-active', 'Neon offline oprávnění ještě není platné.');
  const offlineDays = Math.min(30, Math.max(1, options.offlineDays ?? 30));
  const offlineValidUntilMs = issuedAtMs + offlineDays * 24 * 60 * 60 * 1000;
  if (offlineValidUntilMs <= now - tolerance) {
    throw new OfflineGrantValidationError('expired', 'Offline oprávnění vypršelo. Připojte se k internetu a obnovte je.');
  }
  const payload = offlineGrantPayloadSchema.parse({
    version: 1,
    issuer: claims.iss,
    audience: options.audience,
    subject: options.profile.id,
    displayName: options.profile.display_name,
    scopes: ['songs:read', 'user-state:sync'],
    contentPackages: [requiredPackage],
    contentVersion: options.contentVersion || 'not-downloaded',
    issuedAt: new Date(issuedAtMs).toISOString(),
    notBefore: new Date(issuedAtMs).toISOString(),
    offlineValidUntil: new Date(offlineValidUntilMs).toISOString(),
    keyId: header.kid,
    deviceId: options.deviceId,
  });
  return { token, payload, verifiedAt: new Date(now).toISOString() };
}

export function parseOfflineGrantKeySet(value: string | undefined): OfflineGrantKeySet | null {
  if (!value?.trim()) return null;
  try {
    return offlineGrantKeySetSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export function parseNeonOfflineKeySet(value: unknown): NeonOfflineKeySet | null {
  try {
    return neonOfflineKeySetSchema.parse(value);
  } catch {
    return null;
  }
}
