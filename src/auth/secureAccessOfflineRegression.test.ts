import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('../backend/neonClient', () => ({
  clearPendingNeonAuthJwt: vi.fn(), consumePendingNeonAuthJwt: vi.fn(),
  neonAuthIssuer: 'https://auth.example.test', neonAuthJwksUrl: 'https://auth.example.test/.well-known/jwks.json',
  neonAuthUrl: 'https://auth.example.test', neonClientConfigured: true, neonDataApiUrl: 'https://data.example.test',
  requireNeonClient: () => ({ auth }),
}));

import { getSecureSession, signOutSecureAccount } from './secureAccess';
import { changeAuthIntent, loadNeonSessionCredential, saveNeonSessionCredential } from '../storage/database';

const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'test@example.test', name: 'Testovací člen', emailVerified: true };
const jwt = (expires: number) => `header.${btoa(JSON.stringify({ exp: expires }))}.signature`;

describe('reprodukce obnovy Neon session pro offline přípravu', () => {
  beforeEach(async () => { await changeAuthIntent(null, false); });
  afterEach(async () => {
    await signOutSecureAccount().catch(() => undefined);
    vi.unstubAllGlobals(); vi.clearAllMocks();
  });

  it('nepřevezme týdenní platnost session pro patnáctiminutový JWT vložený Neon SDK', async () => {
    const expires = Math.floor(Date.now() / 1000) + 900;
    auth.getSession.mockResolvedValue({ data: { user, session: { token: jwt(expires), expiresAt: new Date(Date.now() + 7 * 86400_000) } }, error: null });
    const session = await getSecureSession();
    expect(session?.expires_at).toBe(new Date(expires * 1000).toISOString());
  });

  it('HTTP 503 při bearer obnově nesmaže jedinou trvalou obnovovací session', async () => {
    auth.getSession.mockResolvedValue({ data: null, error: null });
    await saveNeonSessionCredential({ schemaVersion: 1, provider: 'neon-auth', sessionToken: 'synthetic-opaque-session', user: { ...user, displayName: user.name }, savedAt: new Date().toISOString() });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })));
    await getSecureSession().catch(() => null);
    expect(await loadNeonSessionCredential()).toMatchObject({ sessionToken: 'synthetic-opaque-session' });
  });
  it('poškozený JSON token z HTTP 200 není důvodem smazat obnovovací session', async () => {
    auth.getSession.mockResolvedValue({ data: null, error: null });
    await saveNeonSessionCredential({ schemaVersion: 1, provider: 'neon-auth', sessionToken: 'synthetic-opaque-session', user: { ...user, displayName: user.name }, savedAt: new Date().toISOString() });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"token":"malformed"}', { headers: { 'Content-Type': 'application/json' } })));
    await expect(getSecureSession()).rejects.toMatchObject({ code: 'neon_token_malformed' });
    expect(await loadNeonSessionCredential()).toMatchObject({ sessionToken: 'synthetic-opaque-session' });
  });
});
