import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { offlineGrantAllowsReading, verifyNeonOfflineGrant } from '../src/auth/offlineGrant.js';
import { changeAuthIntent, clearOfflineGrantRecord, getOrCreateDeviceId, loadAuthIntent, loadOfflineGrantRecord, saveOfflineGrantRecord } from '../src/storage/database.js';
import { neonGrantFixture, syntheticProfile } from '../src/test/neonGrantFixture.js';

const verifier = readFileSync('src/auth/offlineGrant.ts', 'utf8');
const client = readFileSync('src/auth/secureAccess.ts', 'utf8');
const repository = readFileSync('src/repositories/neonAuthRepository.ts', 'utf8');

describe('Neon offline oprávnění', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearOfflineGrantRecord();
    await changeAuthIntent(null, true);
  });

  it('uloží a znovu ověří členský grant bez sítě a nativního Ed25519 po vypršení online JWT', async () => {
    const now = Math.floor(Date.now() / 1000);
    const fixture = await neonGrantFixture({ iat: now - 3600, exp: now - 2700 });
    await changeAuthIntent(syntheticProfile.auth_user_id, false);
    const intent = await loadAuthIntent();
    const deviceId = await getOrCreateDeviceId();
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new DOMException('Unsupported algorithm', 'NotSupportedError'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Offline'));

    const verified = await verifyNeonOfflineGrant(fixture.token, { ...fixture.options, deviceId });
    await saveOfflineGrantRecord({
      schemaVersion: 1, provider: 'neon-auth', ...verified,
      profile: syntheticProfile, keySet: fixture.keySet,
    }, { intentRevision: intent.revision });
    const stored = await loadOfflineGrantRecord();
    expect(stored).toMatchObject({ token: fixture.token, keySet: fixture.keySet, profile: syntheticProfile });
    if (!stored?.keySet) throw new Error('Grant or verification key was not persisted');
    expect(await getOrCreateDeviceId()).toBe(deviceId);
    const restored = await verifyNeonOfflineGrant(stored.token, {
      ...fixture.options, profile: stored.profile, keySet: stored.keySet,
      deviceId, contentVersion: stored.payload.contentVersion,
    });
    expect(offlineGrantAllowsReading(restored.payload, stored.profile, fixture.now)).toBe(true);
    expect(restored.payload.offlineValidUntil).toBe(verified.payload.offlineValidUntil);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('povolí offline obsah pouze schválené podepsané roli member/admin', () => {
    expect(verifier).toContain("options.profile.status !== 'approved'");
    expect(verifier).toContain('claims.banned');
    expect(verifier).toContain('claims.role !== options.profile.role');
    expect(verifier).toContain("options.profile.role === 'admin' ? 'admin' : 'members'");
  });

  it('ukládá veřejný JWKS s grantem a nepotřebuje Edge Function ani privátní klíč', () => {
    expect(repository).toContain("provider: 'neon-auth'");
    expect(repository).toContain('loadNeonPublicJwks(signal)');
    expect(repository).not.toMatch(/supabase|private_jwk|service_role/i);
    expect(client).not.toMatch(/functions\.invoke|VITE_NEON_OFFLINE_GRANT_URL/i);
  });

  it('po přihlášení uloží grant z již ověřeného JWT bez druhého cookie požadavku', () => {
    const hook = readFileSync('src/hooks/useSecureAccount.ts', 'utf8');
    expect(hook).toContain('result.session.access_token');
    expect(repository).toContain('accessToken || requestNeonSessionJwt({ signal })');
  });
});
