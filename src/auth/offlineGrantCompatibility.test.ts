import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyNeonOfflineGrant, type VerifyNeonOfflineGrantOptions } from './offlineGrant';

const encodeBytes = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const encodeJson = (value: unknown) => encodeBytes(new TextEncoder().encode(JSON.stringify(value)));

async function memberGrant(claimOverrides: Record<string, unknown> = {}) {
  const now = Date.parse('2026-09-15T12:00:00.000Z');
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const claims = {
    iss: 'https://auth.example.test', aud: 'https://auth.example.test',
    sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'synthetic@example.test',
    emailVerified: true, role: 'member', banned: false,
    iat: now / 1000 - 3600, exp: now / 1000 - 2700,
    ...claimOverrides,
  };
  const input = `${encodeJson({ alg: 'EdDSA', kid: 'synthetic-compat-key' })}.${encodeJson(claims)}`;
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(input)));
  const options: VerifyNeonOfflineGrantOptions = {
    issuer: 'https://auth.example.test', audience: 'https://auth.example.test',
    keySet: { keys: [{ kty: 'OKP', crv: 'Ed25519', x: publicKey.x!, kid: 'synthetic-compat-key', alg: 'EdDSA' }] },
    profile: {
      id: '11111111-1111-4111-8111-111111111111',
      auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'synthetic@example.test',
      display_name: 'Syntetický člen', status: 'approved', role: 'member',
    },
    deviceId: 'synthetic-device', contentVersion: 'synthetic-v1', now,
  };
  return { token: `${input}.${encodeBytes(signature)}`, options, claims };
}

function unsupportedNativeEd25519() {
  vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new DOMException('Unsupported algorithm', 'NotSupportedError'));
}

afterEach(() => vi.restoreAllMocks());

describe('Neon grant on browsers without native Ed25519', () => {
  it('verifies a signed member grant after the online JWT expired without network access', async () => {
    const fixture = await memberGrant();
    unsupportedNativeEd25519();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Offline'));
    const result = await verifyNeonOfflineGrant(fixture.token, fixture.options);
    expect(result.payload.contentPackages).toEqual(['members']);
    expect(Date.parse(result.payload.offlineValidUntil)).toBeGreaterThan(fixture.options.now!);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('also verifies when native import works but native verification is unsupported', async () => {
    const fixture = await memberGrant();
    vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(new DOMException('Unsupported algorithm', 'NotSupportedError'));
    await expect(verifyNeonOfflineGrant(fixture.token, fixture.options)).resolves.toMatchObject({ token: fixture.token });
  });

  it.each(['payload', 'signature', 'key'] as const)('rejects a modified %s', async part => {
    const fixture = await memberGrant();
    const segments = fixture.token.split('.');
    if (part === 'payload') segments[1] = encodeJson({ ...fixture.claims, role: 'admin' });
    if (part === 'signature') segments[2] = `${segments[2][0] === 'A' ? 'B' : 'A'}${segments[2].slice(1)}`;
    if (part === 'key') {
      const otherPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
      fixture.options.keySet.keys[0].x = (await crypto.subtle.exportKey('jwk', otherPair.publicKey)).x!;
    }
    unsupportedNativeEd25519();
    await expect(verifyNeonOfflineGrant(segments.join('.'), fixture.options)).rejects.toMatchObject({ reason: 'invalid-signature' });
  });

  it('rejects an unrecognized signing key before using the fallback', async () => {
    const fixture = await memberGrant();
    fixture.options.keySet.keys[0].kid = 'other-key';
    unsupportedNativeEd25519();
    await expect(verifyNeonOfflineGrant(fixture.token, fixture.options)).rejects.toMatchObject({ reason: 'unknown-key' });
    expect(crypto.subtle.importKey).not.toHaveBeenCalled();
  });

  it.each([{ role: 'admin' }, { emailVerified: false }, { banned: true }])('preserves signed authorization checks: %j', async claims => {
    const fixture = await memberGrant(claims);
    unsupportedNativeEd25519();
    await expect(verifyNeonOfflineGrant(fixture.token, fixture.options)).rejects.toMatchObject({ reason: 'wrong-package' });
  });

  it.each(['pending', 'rejected', 'suspended'] as const)('rejects a %s member profile', async status => {
    const fixture = await memberGrant();
    fixture.options.profile.status = status;
    unsupportedNativeEd25519();
    await expect(verifyNeonOfflineGrant(fixture.token, fixture.options)).rejects.toMatchObject({ reason: 'wrong-package' });
  });

  it('rejects an expired offline grant', async () => {
    const now = Date.parse('2026-09-15T12:00:00.000Z') / 1000;
    const fixture = await memberGrant({ iat: now - 31 * 86400, exp: now - 31 * 86400 + 900 });
    unsupportedNativeEd25519();
    await expect(verifyNeonOfflineGrant(fixture.token, fixture.options)).rejects.toMatchObject({ reason: 'expired' });
  });

  it('does not retry a native invalid signature through the fallback', async () => {
    const fixture = await memberGrant();
    vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(false);
    await expect(verifyNeonOfflineGrant(fixture.token, fixture.options)).rejects.toMatchObject({ reason: 'invalid-signature' });
  });

  it.each(['DataError', 'OperationError'])('does not bypass native %s', async name => {
    const fixture = await memberGrant();
    const error = new DOMException('Synthetic native rejection', name);
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(error);
    await expect(verifyNeonOfflineGrant(fixture.token, fixture.options)).rejects.toBe(error);
  });

  it('rejects the small-order identity forgery accepted by permissive ZIP215 verification', async () => {
    const fixture = await memberGrant();
    const identity = new Uint8Array(32); identity[0] = 1;
    fixture.options.keySet.keys[0].x = encodeBytes(identity);
    const forgedSignature = new Uint8Array(64); forgedSignature[0] = 1;
    const segments = fixture.token.split('.'); segments[2] = encodeBytes(forgedSignature);
    unsupportedNativeEd25519();
    await expect(verifyNeonOfflineGrant(segments.join('.'), fixture.options)).rejects.toMatchObject({ reason: 'invalid-signature' });
  });
});
