import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neonGrantFixture, syntheticProfile } from '../src/test/neonGrantFixture.js';

const remote = vi.hoisted(() => ({ freshToken: vi.fn(), keys: vi.fn(), register: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/auth/secureAccess.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/auth/secureAccess.js')>(),
  offlineGrantIssuer: 'https://auth.example.test', offlineGrantAudience: 'https://auth.example.test',
  loadNeonPublicJwks: remote.keys, registerSecureDevice: remote.register, requestNeonSessionJwt: remote.freshToken,
}));
import { neonAuthRepository } from '../src/repositories/neonAuthRepository.js';
import { changeAuthIntent, clearOfflineGrantRecord, getOrCreateDeviceId, loadAuthIntent, loadOfflineGrantRecord, saveOfflineGrantRecord, loadNeonSessionCredential, saveNeonSessionCredential } from '../src/storage/database.js';

describe('celý životní cyklus podpisu a skutečného IndexedDB', () => {
  beforeEach(async () => { await changeAuthIntent(syntheticProfile.auth_user_id, false); await clearOfflineGrantRecord(); vi.clearAllMocks(); });
  async function issued() {
    const fixture = await neonGrantFixture(); remote.keys.mockResolvedValue(fixture.keySet);
    const verified = await neonAuthRepository.issueOfflineGrant(syntheticProfile, await getOrCreateDeviceId(), fixture.token);
    return { schemaVersion: 1 as const, ...verified, profile: syntheticProfile };
  }
  it('po serverové změně role vyžádá nový podpis; neuzná starou roli', async () => {
    const stale = await neonGrantFixture({ role: 'user' });
    const freshToken = await stale.resign({ role: 'member' });
    remote.keys.mockResolvedValue(stale.keySet);
    remote.freshToken.mockResolvedValue(freshToken);
    await expect(neonAuthRepository.issueOfflineGrant(syntheticProfile, await getOrCreateDeviceId(), stale.token)).resolves.toMatchObject({ token: freshToken, payload: { contentPackages: ['members'] } });
    expect(remote.freshToken).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
    remote.freshToken.mockResolvedValue(stale.token);
    await expect(neonAuthRepository.issueOfflineGrant(syntheticProfile, await getOrCreateDeviceId(), stale.token)).rejects.toMatchObject({ reason: 'wrong-package' });
  });
  it('neschválený profil nikdy nezaregistruje zařízení ani nevydá grant', async () => {
    await expect(neonAuthRepository.issueOfflineGrant({ ...syntheticProfile, status: 'pending' }, 'synthetic-device', 'unused')).rejects.toMatchObject({ code: 'grant_issue_failed', status: 403 });
    expect(remote.register).not.toHaveBeenCalled(); expect(remote.keys).not.toHaveBeenCalled();
  });
  it('při rotaci kid znovu načte důvěryhodné JWKS a uloží nový klíč', async () => {
    const fixture = await neonGrantFixture();
    remote.keys.mockResolvedValueOnce({ keys: [{ ...fixture.keySet.keys[0], kid: 'old-key' }] }).mockResolvedValue(fixture.keySet);
    const verified = await neonAuthRepository.issueOfflineGrant(syntheticProfile, await getOrCreateDeviceId(), fixture.token);
    expect(remote.keys).toHaveBeenCalledTimes(2);
    await neonAuthRepository.saveOfflineGrant({ schemaVersion: 1, ...verified, profile: syntheticProfile });
    expect((await neonAuthRepository.getOfflineGrant())?.payload.keyId).toBe('synthetic-key');
  });
  it('chyba kvóty při skutečném zápisu transakci vrátí a zachová starý grant', async () => {
    const grant = await issued(); await neonAuthRepository.saveOfflineGrant(grant);
    const next = await issued();
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'offlineAuth') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
    try { await expect(neonAuthRepository.saveOfflineGrant(next)).rejects.toMatchObject({ name: 'QuotaExceededError' }); }
    finally { put.mockRestore(); }
    expect((await neonAuthRepository.getOfflineGrant())?.token).toBe(grant.token);
  });
  it('opožděné přihlášení nemůže přepsat trvalý logout', async () => {
    const signal = AbortSignal.abort(); await changeAuthIntent(null, true);
    await expect(changeAuthIntent(syntheticProfile.auth_user_id, false, signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect((await loadAuthIntent()).signedOut).toBe(true);
  });
  it('uloží, znovu přečte a kryptograficky ověří tentýž grant', async () => {
    const grant = await issued(); await neonAuthRepository.saveOfflineGrant(grant);
    expect(await neonAuthRepository.getOfflineGrant()).toMatchObject({ token: grant.token, payload: grant.payload });
  });
  it('souběžná inicializace vrací jednu stabilní identitu instalace', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => getOrCreateDeviceId()));
    expect(new Set(ids).size).toBe(1); expect(await getOrCreateDeviceId()).toBe(ids[0]);
  });
  it('po logoutu odmítne opožděný zápis grantu i obnovovací session', async () => {
    const grant = await issued(); const intent = await loadAuthIntent();
    await changeAuthIntent(null, true);
    await expect(saveOfflineGrantRecord(grant, { intentRevision: intent.revision })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(saveNeonSessionCredential({ schemaVersion: 1, provider: 'neon-auth', sessionToken: 'synthetic-session-token', user: { id: syntheticProfile.auth_user_id!, email: syntheticProfile.email, emailVerified: true, displayName: syntheticProfile.display_name }, savedAt: new Date().toISOString() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await loadOfflineGrantRecord()).toBeNull(); expect(await loadNeonSessionCredential()).toBeNull();
  });
  it('po přepnutí účtu odmítne opožděný výsledek předchozího účtu', async () => {
    const grant = await issued(); const intent = await loadAuthIntent();
    await changeAuthIntent('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
    await expect(saveOfflineGrantRecord(grant, { intentRevision: intent.revision })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await neonAuthRepository.getOfflineGrant()).toBeNull();
  });
  it('zrušený zápis nesmaže poslední platné oprávnění', async () => {
    const grant = await issued(); await neonAuthRepository.saveOfflineGrant(grant);
    const controller = new AbortController(); controller.abort();
    await expect(neonAuthRepository.saveOfflineGrant(await issued(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect((await neonAuthRepository.getOfflineGrant())?.token).toBe(grant.token);
  });
  it.each(['device', 'key'])('odmítne grant s nesprávným lokálním údajem: %s', async kind => {
    const grant = await issued();
    await saveOfflineGrantRecord(kind === 'key' ? { ...grant, keySet: undefined } : { ...grant, payload: { ...grant.payload, deviceId: 'another-device' } });
    await expect(neonAuthRepository.getOfflineGrant()).rejects.toMatchObject({ code: kind === 'key' ? 'verification_key_unavailable' : 'identity_mismatch' });
  });
});
