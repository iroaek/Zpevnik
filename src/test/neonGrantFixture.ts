import type { SecureProfile } from '../auth/secureAccess';
import type { NeonOfflineKeySet } from '../auth/offlineGrant';

export const syntheticProfile: SecureProfile = {
  id: '11111111-1111-4111-8111-111111111111', auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'offline@example.test', display_name: 'Testovací člen', status: 'approved', role: 'member',
  created_at: '2026-09-01T00:00:00Z', reviewed_at: '2026-09-01T01:00:00Z', last_seen_at: null,
};
export const syntheticIssuer = 'https://auth.example.test';
export async function neonGrantFixture(overrides: Record<string, unknown> = {}) {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const now = Math.floor(Date.now() / 1000) * 1000;
  const claims = { iss: syntheticIssuer, aud: syntheticIssuer, sub: syntheticProfile.auth_user_id, email: syntheticProfile.email, emailVerified: true, role: 'member', banned: false, iat: now / 1000, exp: now / 1000 + 900, ...overrides };
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
  const resign = async (changes: Record<string, unknown>) => {
    const input = [{ alg: 'EdDSA', typ: 'JWT', kid: 'synthetic-key' }, { ...claims, ...changes }].map(value => encode(new TextEncoder().encode(JSON.stringify(value)))).join('.');
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(input)));
    return `${input}.${encode(signature)}`;
  };
  const keySet: NeonOfflineKeySet = { keys: [{ kty: 'OKP', crv: 'Ed25519', x: publicJwk.x!, kid: 'synthetic-key', alg: 'EdDSA' }] };
  return { token: await resign({}), resign, now, keySet, options: { issuer: syntheticIssuer, audience: syntheticIssuer, keySet, profile: syntheticProfile, deviceId: 'synthetic-device', contentVersion: 'synthetic-version', now } };
}
