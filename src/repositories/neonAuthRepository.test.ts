import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecureProfile } from '../auth/secureAccess';

const mocks = vi.hoisted(() => ({
  requestJwt: vi.fn(async () => 'second-cookie-jwt'),
  loadJwks: vi.fn(async () => ({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: 'test', kid: 'key', alg: 'EdDSA' }] })),
  verify: vi.fn(async (token: string) => ({
    token,
    verifiedAt: '2026-08-12T12:00:00.000Z',
    payload: {
      version: 1 as const,
      issuer: 'https://auth.example.test',
      audience: 'https://auth.example.test',
      subject: '11111111-1111-4111-8111-111111111111',
      displayName: 'Člen Test',
      scopes: ['songs:read', 'user-state:sync'],
      contentPackages: ['members' as const],
      contentVersion: 'abc123',
      issuedAt: '2026-08-12T12:00:00.000Z',
      notBefore: '2026-08-12T12:00:00.000Z',
      offlineValidUntil: '2026-09-11T12:00:00.000Z',
      keyId: 'key',
      deviceId: 'device-test',
    },
  })),
}));

vi.mock('../auth/secureAccess', () => ({
  getSecureSession: vi.fn(),
  loadNeonPublicJwks: mocks.loadJwks,
  loadSecureProfile: vi.fn(),
  offlineGrantAudience: 'https://auth.example.test',
  offlineGrantIssuer: 'https://auth.example.test',
  requestNeonSessionJwt: mocks.requestJwt,
  secureProfileSchema: { parse: (value: unknown) => value },
  signOutSecureAccount: vi.fn(),
}));

vi.mock('../auth/offlineGrant', () => ({
  parseNeonOfflineKeySet: (value: unknown) => value,
  verifyNeonOfflineGrant: mocks.verify,
}));

vi.mock('../storage/database', () => ({
  clearOfflineGrantRecord: vi.fn(),
  loadDownloadedLibraryMetadata: vi.fn(async () => ({ version: 'abc123' })),
  loadOfflineGrantRecord: vi.fn(),
  saveOfflineGrantRecord: vi.fn(),
}));

import { neonAuthRepository } from './neonAuthRepository';

const profile: SecureProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'clen@example.test',
  display_name: 'Člen Test',
  status: 'approved',
  role: 'member',
  created_at: '2026-08-12T10:00:00.000Z',
  reviewed_at: '2026-08-12T10:05:00.000Z',
  last_seen_at: null,
};

describe('Neon Auth repository', () => {
  beforeEach(() => {
    mocks.requestJwt.mockClear();
    mocks.verify.mockClear();
  });

  it('uloží offline grant z JWT právě ověřené relace bez druhého cookie requestu', async () => {
    const result = await neonAuthRepository.issueOfflineGrant(profile, 'device-test', 'verified-session-jwt');

    expect(mocks.requestJwt).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledWith('verified-session-jwt', expect.objectContaining({ profile, deviceId: 'device-test' }));
    expect(result.token).toBe('verified-session-jwt');
  });
});
