import { describe, expect, it } from 'vitest';
import { OfflineGrantValidationError, verifyOfflineGrant, type OfflineGrantPayload } from './offlineGrant';

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
    const changed = `${value.token.slice(0, -1)}${value.token.endsWith('A') ? 'B' : 'A'}`;
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
