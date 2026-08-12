import { describe, expect, it } from 'vitest';
import { OfflineGrantValidationError, verifyNeonOfflineGrant, verifyOfflineGrant, type OfflineGrantPayload } from './offlineGrant';

function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function fixture(overrides: Partial<OfflineGrantPayload> = {}) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const payload: OfflineGrantPayload = {
    version: 1,
    issuer: 'https://auth.example.test/offline-grant',
    audience: 'cesky-zpevnik-offline',
    subject: '11111111-1111-4111-8111-111111111111',
    displayName: 'Testovací člen',
    scopes: ['songs:read'],
    contentPackages: ['members'],
    contentVersion: 'abc123def456',
    issuedAt: '2026-08-11T11:59:00.000Z',
    notBefore: '2026-08-11T11:59:00.000Z',
    offlineValidUntil: '2026-09-10T12:00:00.000Z',
    keyId: 'test-key-1',
    deviceId: 'device-test-1234',
    ...overrides,
  };
  const header = { alg: 'ES256', typ: 'JWT', kid: payload.keyId };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(signingInput)));
  const token = `${signingInput}.${encodeBase64Url(signature)}`;
  return {
    token,
    payload,
    options: {
      issuer: payload.issuer,
      audience: payload.audience,
      requiredPackage: 'members',
      deviceId: payload.deviceId,
      now: Date.parse('2026-08-11T12:00:00.000Z'),
      keySet: { keys: [{ ...publicJwk, kty: 'EC' as const, crv: 'P-256' as const, x: publicJwk.x!, y: publicJwk.y!, kid: payload.keyId, alg: 'ES256' as const, use: 'sig' as const }] },
    },
  };
}

describe('podepsané offline oprávnění', () => {
  it('ověří ES256 podpis, issuer, audience, zařízení a balíček', async () => {
    const value = await fixture();
    await expect(verifyOfflineGrant(value.token, value.options)).resolves.toMatchObject({ payload: value.payload });
  });

  it('odmítne změněný podpis', async () => {
    const value = await fixture();
    const parts = value.token.split('.');
    parts[2] = `${parts[2].startsWith('A') ? 'B' : 'A'}${parts[2].slice(1)}`;
    const changed = parts.join('.');
    await expect(verifyOfflineGrant(changed, value.options)).rejects.toMatchObject({ reason: 'invalid-signature' });
  });

  it.each([
    ['issuer', { issuer: 'https://other.example.test' }, 'wrong-issuer'],
    ['audience', { audience: 'other-app' }, 'wrong-audience'],
    ['contentPackage', { requiredPackage: 'admin' }, 'wrong-package'],
    ['deviceId', { deviceId: 'other-device' }, 'wrong-device'],
  ])('odmítne chybný %s', async (_label, optionOverride, reason) => {
    const value = await fixture();
    await expect(verifyOfflineGrant(value.token, { ...value.options, ...optionOverride })).rejects.toMatchObject({ reason });
  });

  it('odmítne vypršené oprávnění', async () => {
    const value = await fixture({ offlineValidUntil: '2026-08-10T12:00:00.000Z' });
    await expect(verifyOfflineGrant(value.token, value.options)).rejects.toSatisfy((error: unknown) => error instanceof OfflineGrantValidationError && error.reason === 'expired');
  });
});

describe('Neon Auth offline oprávnění', () => {
  it('ověří Ed25519 podpis, podepsanou roli a odvodí třicetidenní offline platnost', async () => {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const now = Date.parse('2026-08-12T12:00:00.000Z');
    const issuedAt = Math.floor(now / 1000);
    const issuer = 'https://auth.example.neon.tech';
    const header = { alg: 'EdDSA', typ: 'JWT', kid: 'neon-test-key' };
    const claims = {
      iss: issuer,
      aud: issuer,
      sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'clen@example.test',
      emailVerified: true,
      role: 'member',
      banned: false,
      iat: issuedAt,
      exp: issuedAt + 900,
    };
    const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(signingInput)));
    const token = `${signingInput}.${encodeBase64Url(signature)}`;
    const verified = await verifyNeonOfflineGrant(token, {
      issuer,
      audience: issuer,
      keySet: { keys: [{ kty: 'OKP', crv: 'Ed25519', x: publicJwk.x!, kid: 'neon-test-key', alg: 'EdDSA' }] },
      profile: {
        id: '11111111-1111-4111-8111-111111111111',
        auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        email: 'clen@example.test',
        display_name: 'Testovací člen',
        status: 'approved',
        role: 'member',
      },
      contentVersion: 'content-v1',
      deviceId: 'device-test-1234',
      now,
    });

    expect(verified.payload.subject).toBe('11111111-1111-4111-8111-111111111111');
    expect(verified.payload.contentPackages).toEqual(['members']);
    expect(Date.parse(verified.payload.offlineValidUntil) - Date.parse(verified.payload.issuedAt)).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('odmítne podepsanou roli, která nesouhlasí se schváleným profilem', async () => {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const now = Date.now();
    const header = { alg: 'EdDSA', typ: 'JWT', kid: 'neon-role-test' };
    const claims = {
      iss: 'https://auth.example.neon.tech',
      aud: 'https://auth.example.neon.tech',
      sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'admin@example.test',
      emailVerified: true,
      role: 'member',
      banned: false,
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 900,
    };
    const signingInput = `${encodeJson(header)}.${encodeJson(claims)}`;
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(signingInput)));
    await expect(verifyNeonOfflineGrant(`${signingInput}.${encodeBase64Url(signature)}`, {
      issuer: claims.iss,
      audience: claims.aud,
      keySet: { keys: [{ kty: 'OKP', crv: 'Ed25519', x: publicJwk.x!, kid: 'neon-role-test', alg: 'EdDSA' }] },
      profile: {
        id: '11111111-1111-4111-8111-111111111111',
        auth_user_id: claims.sub,
        email: claims.email,
        display_name: 'Správce',
        status: 'approved',
        role: 'admin',
      },
      contentVersion: 'content-v1',
      now,
    })).rejects.toMatchObject({ reason: 'wrong-package' });
  });
});
