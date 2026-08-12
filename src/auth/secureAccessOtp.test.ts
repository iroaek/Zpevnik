import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  clearPendingJwt: vi.fn(),
  consumePendingJwt: vi.fn(),
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
}));

vi.mock('../backend/neonClient', () => ({
  clearPendingNeonAuthJwt: auth.clearPendingJwt,
  consumePendingNeonAuthJwt: auth.consumePendingJwt,
  neonAuthIssuer: 'https://auth.example.test',
  neonAuthJwksUrl: 'https://auth.example.test/.well-known/jwks.json',
  neonAuthUrl: 'https://auth.example.test',
  neonClientConfigured: true,
  neonDataApiUrl: 'https://data.example.test/rest/v1',
  requireNeonClient: () => ({
    auth: {
      getSession: auth.getSession,
      signIn: { emailOtp: auth.signInWithOtp },
    },
  }),
}));

import { signInSecureAccountWithCode, subscribeToSecureSession } from './secureAccess';

function testJwt(): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + 600 }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `test-header.${payload}.test-signature`;
}

describe('Neon OTP relace', () => {
  afterEach(() => vi.clearAllMocks());

  it('použije JWT z úspěšné OTP odpovědi i když Safari neuloží cross-site cookie', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'clen@example.test',
      emailVerified: true,
      name: 'Testovací člen',
    };
    auth.signInWithOtp.mockResolvedValue({ data: { token: 'opaque-session-token', user }, error: null });
    auth.consumePendingJwt.mockReturnValue(testJwt());
    auth.getSession.mockResolvedValue({ data: null, error: null });
    const listener = vi.fn();
    const unsubscribe = subscribeToSecureSession(listener);

    await signInSecureAccountWithCode('CLEN@example.test', ' 123456 ');

    expect(auth.clearPendingJwt).toHaveBeenCalledOnce();
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'clen@example.test', otp: '123456' });
    expect(auth.consumePendingJwt).toHaveBeenCalledWith(user.id);
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith('SIGNED_IN', expect.objectContaining({
      access_token: expect.stringContaining('test-header.'),
      user: expect.objectContaining({ id: user.id, emailVerified: true }),
    }));

    unsubscribe();
  });
});
