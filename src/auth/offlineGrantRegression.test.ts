import { describe, expect, it } from 'vitest';
import { verifyNeonOfflineGrant } from './offlineGrant';
import { neonGrantFixture } from '../test/neonGrantFixture';

describe('podepsané Neon oprávnění po skutečné expiraci online JWT', () => {
  it('po 20 minutách nadále ověří offline grant, po 30 dnech jej odmítne', async () => {
    const value = await neonGrantFixture();
    await expect(verifyNeonOfflineGrant(value.token, { ...value.options, now: value.now + 20 * 60_000 })).resolves.toMatchObject({ payload: { contentPackages: ['members'] } });
    await expect(verifyNeonOfflineGrant(value.token, { ...value.options, now: value.now + 30 * 86400_000 })).rejects.toMatchObject({ reason: 'expired' });
  });
  it.each([
    [{ iat: Date.now(), exp: Date.now() + 900_000 }, 'not-active'],
    [{ exp: 1 }, 'malformed'],
    [{ emailVerified: false }, 'wrong-package'],
    [{ banned: true }, 'wrong-package'],
    [{ role: 'pending' }, 'wrong-package'],
    [{ iss: 'https://other.example.test' }, 'wrong-issuer'],
    [{ aud: 'another-app' }, 'wrong-audience'],
    [{ sub: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, 'identity-mismatch'],
    [{ nbf: Math.floor(Date.now() / 1000) + 600 }, 'not-active'],
  ])('odmítne neplatné podepsané autorizační údaje %#', async (claims, reason) => {
    const value = await neonGrantFixture(claims);
    await expect(verifyNeonOfflineGrant(value.token, value.options)).rejects.toMatchObject({ reason });
  });
  it('odmítne chybný podpis a chybějící lokální klíč bez síťového dotazu', async () => {
    const value = await neonGrantFixture();
    const parts = value.token.split('.'); parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    await expect(verifyNeonOfflineGrant(parts.join('.'), value.options)).rejects.toMatchObject({ reason: 'invalid-signature' });
    await expect(verifyNeonOfflineGrant(value.token, { ...value.options, keySet: { keys: [{ ...value.keySet.keys[0], kid: 'different-key' }] } })).rejects.toMatchObject({ reason: 'unknown-key' });
  });
});
