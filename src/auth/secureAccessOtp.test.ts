import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  clearPendingJwt: vi.fn(),
  consumePendingJwt: vi.fn(),
  getSession: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithOtp: vi.fn(),
  signOut: vi.fn().mockResolvedValue({ error: null }),
  signUp: vi.fn(), verifyEmail: vi.fn(), passwordResetLink: vi.fn(), resetPasswordLink: vi.fn(),
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
      emailOtp: {
        verifyEmail: auth.verifyEmail,
        requestPasswordReset: auth.requestPasswordReset,
        resetPassword: auth.resetPassword,
      },
      getSession: auth.getSession,
      signOut: auth.signOut,
      signUp: { email: auth.signUp },
      requestPasswordReset: auth.passwordResetLink,
      resetPassword: auth.resetPasswordLink,
      signIn: {
        email: auth.signInWithEmail,
        emailOtp: auth.signInWithOtp,
      },
    },
  }),
}));

import {
  completeMigratedPasswordSetup,
  getSecureSession,
  sendMigratedPasswordSetupCode,
  signInSecureAccountWithCode,
  signOutSecureAccount,
  subscribeToSecureSession,
  registerSecureAccount,
  verifyEmailVerificationCode,
  sendPasswordReset,
  updateSecurePassword,
} from './secureAccess';
import { changeAuthIntent, loadNeonSessionCredential, saveNeonSessionCredential } from '../storage/database';

function testJwt(): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + 600 }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `test-header.${payload}.test-signature`;
}

describe('Neon OTP relace', () => {
  beforeEach(async () => { await changeAuthIntent(null, false); });
  afterEach(async () => {
    await signOutSecureAccount().catch(() => undefined);
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('registrace čeká na ověření e-mailu; ověřovací kód s heslem obnoví stejný přihlašovací tok', async () => {
    const user = { id: '22222222-2222-4222-8222-222222222222', email: 'new@example.test', name: 'Testovací člen', emailVerified: false };
    auth.signUp.mockResolvedValue({ data: { token: 'synthetic-registration-session', user }, error: null });
    const listener = vi.fn(); const unsubscribe = subscribeToSecureSession(listener);
    try {
      expect(await registerSecureAccount({ email: user.email, displayName: user.name, password: 'Synthetic-password' })).toEqual({ needsEmailConfirmation: true });
      expect(listener).not.toHaveBeenCalledWith('SIGNED_IN', expect.anything());
      expect(auth.signOut).toHaveBeenCalled();
      auth.verifyEmail.mockResolvedValue({ error: null });
      auth.signInWithEmail.mockResolvedValue({ data: { token: 'synthetic-verified-session', user: { ...user, emailVerified: true } }, error: null });
      auth.consumePendingJwt.mockReturnValue(testJwt());
      await verifyEmailVerificationCode(user.email, '123456', 'Synthetic-password');
      expect(listener).toHaveBeenCalledWith('SIGNED_IN', expect.objectContaining({ user: expect.objectContaining({ id: user.id, emailVerified: true }) }));
      expect(await loadNeonSessionCredential()).toMatchObject({ sessionToken: 'synthetic-verified-session' });
    } finally { unsubscribe(); }
  });

  it('odkaz obnovy hesla sám nevytváří přístup a po použití odstraní kód z URL', async () => {
    auth.passwordResetLink.mockResolvedValue({ error: null }); auth.resetPasswordLink.mockResolvedValue({ error: null });
    await sendPasswordReset('test@example.test');
    expect(auth.passwordResetLink).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@example.test' }));
    const listener = vi.fn(); const unsubscribe = subscribeToSecureSession(listener);
    history.replaceState({}, '', '/?token=synthetic-recovery-code&password-recovery=1');
    try {
      await updateSecurePassword('Synthetic-password');
      expect(auth.resetPasswordLink).toHaveBeenCalledWith({ newPassword: 'Synthetic-password', token: 'synthetic-recovery-code' });
      expect(new URL(location.href).searchParams.has('token')).toBe(false);
      expect(listener).not.toHaveBeenCalledWith('SIGNED_IN', expect.anything());
    } finally { unsubscribe(); history.replaceState({}, '', '/'); }
  });

  it('po restartu vymění obnovený neprůhledný session token za JWT', async () => {
    const user = {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'restart@example.test',
      emailVerified: true,
      name: 'Restartovaný člen',
    };
    const jwt = testJwt();
    auth.getSession.mockResolvedValue({
      data: { session: { token: 'opaque-restart-token', expiresAt: new Date(Date.now() + 600_000) }, user },
      error: null,
    });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ token: jwt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const session = await getSecureSession();

    expect(fetchMock).toHaveBeenCalledWith('https://auth.example.test/token', expect.objectContaining({
      credentials: 'omit',
      headers: expect.objectContaining({ Authorization: 'Bearer opaque-restart-token' }),
    }));
    expect(session).toMatchObject({ access_token: jwt, user: { id: user.id } });
  });

  it('po zavření PWA obnoví relaci i bez cross-site cookie', async () => {
    const user = {
      id: '33333333-3333-4333-8333-333333333333',
      email: 'pwa-restart@example.test',
      emailVerified: true,
      name: 'Trvalý člen',
    };
    await saveNeonSessionCredential({
      schemaVersion: 1,
      provider: 'neon-auth',
      sessionToken: 'opaque-persisted-session-token',
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        displayName: user.name,
      },
      savedAt: '2026-08-14T08:00:00.000Z',
    });
    auth.getSession.mockResolvedValue({ data: null, error: null });
    const jwt = testJwt();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ token: jwt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const session = await getSecureSession();

    expect(auth.getSession).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('https://auth.example.test/token', expect.objectContaining({
      credentials: 'omit',
      headers: expect.objectContaining({ Authorization: 'Bearer opaque-persisted-session-token' }),
    }));
    expect(session).toMatchObject({
      access_token: jwt,
      user: { id: user.id, email: user.email, user_metadata: { display_name: user.name } },
    });
    expect(await loadNeonSessionCredential()).toMatchObject({ sessionToken: 'opaque-persisted-session-token' });
  });

  it('použije JWT z úspěšné OTP odpovědi i když Safari neuloží cross-site cookie', async () => {
    const user = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'clen@example.test',
      emailVerified: true,
      name: 'Testovací člen',
    };
    auth.signInWithOtp.mockResolvedValue({ data: { token: 'opaque-session-token', user }, error: null });
    auth.requestPasswordReset.mockResolvedValue({ data: null, error: null });
    auth.resetPassword.mockResolvedValue({ data: null, error: null });
    auth.signInWithEmail.mockResolvedValue({ data: { token: 'new-password-session-token', user }, error: null });
    const jwt = testJwt();
    auth.consumePendingJwt.mockReturnValue(null);
    auth.getSession.mockResolvedValue({ data: null, error: null });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ token: jwt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    const unsubscribe = subscribeToSecureSession(listener);

    await signInSecureAccountWithCode('CLEN@example.test', ' 123456 ');
    const session = await getSecureSession();

    expect(auth.clearPendingJwt).toHaveBeenCalledOnce();
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'clen@example.test', otp: '123456' });
    expect(auth.consumePendingJwt).toHaveBeenCalledWith(user.id);
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('https://auth.example.test/token', expect.objectContaining({
      credentials: 'omit',
      headers: expect.objectContaining({ Authorization: 'Bearer opaque-session-token' }),
    }));
    expect(session).toEqual(expect.objectContaining({
      access_token: jwt,
      user: expect.objectContaining({ id: user.id, emailVerified: true }),
    }));
    // Přihlášení se zveřejní aplikaci až po povinném nastavení vlastního hesla.
    expect(listener).not.toHaveBeenCalled();

    await sendMigratedPasswordSetupCode('CLEN@example.test');
    await completeMigratedPasswordSetup('CLEN@example.test', '654321', 'NoveBezpecneHeslo42');

    expect(auth.requestPasswordReset).toHaveBeenCalledWith({ email: 'clen@example.test' });
    expect(auth.resetPassword).toHaveBeenCalledWith({
      email: 'clen@example.test',
      otp: '654321',
      password: 'NoveBezpecneHeslo42',
    });
    expect(auth.signInWithEmail).toHaveBeenCalledWith({
      email: 'clen@example.test',
      password: 'NoveBezpecneHeslo42',
      callbackURL: expect.any(String),
    });
    expect(fetchMock).toHaveBeenLastCalledWith('https://auth.example.test/token', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer new-password-session-token' }),
    }));
    expect(listener).toHaveBeenCalledWith('SIGNED_IN', expect.objectContaining({
      access_token: jwt,
      user: expect.objectContaining({ email: 'clen@example.test' }),
    }));
    expect(await loadNeonSessionCredential()).toMatchObject({
      sessionToken: 'new-password-session-token',
      user: { email: 'clen@example.test', emailVerified: true },
    });

    unsubscribe();
  });
});
