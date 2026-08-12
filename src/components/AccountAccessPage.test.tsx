import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountAccessPage } from './AccountAccessPage';

const auth = vi.hoisted(() => ({
  completePasswordSetup: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
  sendSignInCode: vi.fn(),
  sendPasswordSetupCode: vi.fn(),
  sendVerification: vi.fn(),
  signIn: vi.fn(),
  signInWithCode: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('../auth/secureAccess', () => ({
  completeMigratedPasswordSetup: auth.completePasswordSetup,
  registerSecureAccount: auth.register,
  sendEmailSignInCode: auth.sendSignInCode,
  sendEmailVerificationCode: auth.sendVerification,
  sendMigratedPasswordSetupCode: auth.sendPasswordSetupCode,
  sendPasswordReset: auth.reset,
  signInSecureAccount: auth.signIn,
  signInSecureAccountWithCode: auth.signInWithCode,
  verifyEmailVerificationCode: auth.verify,
}));

describe('schvalovaný účet', () => {
  afterEach(cleanup);

  beforeEach(() => {
    auth.completePasswordSetup.mockReset().mockResolvedValue(undefined);
    auth.register.mockReset().mockResolvedValue({ needsEmailConfirmation: true });
    auth.reset.mockReset().mockResolvedValue(undefined);
    auth.sendSignInCode.mockReset().mockResolvedValue(undefined);
    auth.sendPasswordSetupCode.mockReset().mockResolvedValue(undefined);
    auth.sendVerification.mockReset().mockResolvedValue(undefined);
    auth.signIn.mockReset().mockResolvedValue(undefined);
    auth.signInWithCode.mockReset().mockResolvedValue(undefined);
    auth.verify.mockReset().mockResolvedValue(undefined);
  });

  it('odešle úplnou registraci, pošle Neon OTP a vysvětlí schválení', async () => {
    const user = userEvent.setup();
    render(<AccountAccessPage canInstall={false} installed={false} onInstall={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Registrovat se' }));
    await user.type(screen.getByLabelText('Jméno nebo přezdívka'), 'Testovací člen');
    await user.type(screen.getByLabelText('E-mail'), 'clen@example.cz');
    await user.type(screen.getByLabelText('Heslo', { selector: '#account-password' }), 'VelmiDobreHeslo42');
    await user.type(screen.getByLabelText('Heslo znovu'), 'VelmiDobreHeslo42');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odeslat registraci' }));

    expect(auth.register).toHaveBeenCalledWith({ displayName: 'Testovací člen', email: 'clen@example.cz', password: 'VelmiDobreHeslo42' });
    expect(auth.sendVerification).toHaveBeenCalledWith('clen@example.cz');
    expect(await screen.findByRole('heading', { name: 'Ověření e-mailu' })).toBeInTheDocument();
    expect(screen.getByText(/ověřovací kód/i)).toBeInTheDocument();
    expect(screen.getByText(/účet počká na schválení administrátorem/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Šestimístný kód'), '246810');
    await user.click(screen.getByRole('button', { name: 'Ověřit kód' }));

    expect(auth.verify).toHaveBeenCalledWith('clen@example.cz', '246810', 'VelmiDobreHeslo42');
    expect(auth.sendPasswordSetupCode).not.toHaveBeenCalled();
    expect(await screen.findByText(/čeká na schválení administrátorem/i)).toBeInTheDocument();
  }, 10_000);

  it('neodešle registraci s rozdílnými hesly', async () => {
    const user = userEvent.setup();
    render(<AccountAccessPage canInstall={false} installed={false} onInstall={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Registrovat se' }));
    await user.type(screen.getByLabelText('Jméno nebo přezdívka'), 'Testovací člen');
    await user.type(screen.getByLabelText('E-mail'), 'clen@example.cz');
    await user.type(screen.getByLabelText('Heslo', { selector: '#account-password' }), 'VelmiDobreHeslo42');
    await user.type(screen.getByLabelText('Heslo znovu'), 'JineDobreHeslo42');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Odeslat registraci' }));

    expect(auth.register).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Zadaná hesla se neshodují.');
  });

  it('aktivuje migrovaný účet přihlašovacím kódem bez původního hesla', async () => {
    const user = userEvent.setup();
    render(<AccountAccessPage canInstall={false} installed={false} onInstall={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Přihlásit se kódem' }));
    await user.type(screen.getByLabelText('E-mail'), 'puvodni@example.cz');
    await user.click(screen.getByRole('button', { name: 'Poslat přihlašovací kód' }));

    expect(auth.register).not.toHaveBeenCalled();
    expect(auth.sendSignInCode).toHaveBeenCalledWith('puvodni@example.cz');
    expect(await screen.findByRole('heading', { name: 'Přihlášení kódem' })).toBeInTheDocument();
    expect(screen.getByText(/obnoví váš původní profil/i)).toBeInTheDocument();
  });

  it('ověří přihlašovací OTP a vytvoří relaci převedeného účtu', async () => {
    const user = userEvent.setup();
    render(<AccountAccessPage canInstall={false} installed={false} onInstall={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Přihlásit se kódem' }));
    await user.type(screen.getByLabelText('E-mail'), 'puvodni@example.cz');
    await user.click(screen.getByRole('button', { name: 'Poslat přihlašovací kód' }));
    await user.type(screen.getByLabelText('Šestimístný kód'), '123456');
    await user.click(screen.getByRole('button', { name: 'Ověřit kód' }));

    expect(auth.signInWithCode).toHaveBeenCalledWith('puvodni@example.cz', '123456');
    expect(auth.sendPasswordSetupCode).toHaveBeenCalledWith('puvodni@example.cz');
    expect(await screen.findByRole('heading', { name: 'Nastavení nového hesla' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Kód pro nastavení hesla'), '654321');
    await user.type(screen.getByLabelText('Nové heslo', { exact: true }), 'NoveBezpecneHeslo42');
    await user.type(screen.getByLabelText('Nové heslo znovu'), 'NoveBezpecneHeslo42');
    await user.click(screen.getByRole('button', { name: 'Uložit nové heslo' }));

    expect(auth.completePasswordSetup).toHaveBeenCalledWith('puvodni@example.cz', '654321', 'NoveBezpecneHeslo42');
  });

  it('z ověřovací obrazovky odešle nový přihlašovací kód a zneplatní starý', async () => {
    const user = userEvent.setup();
    render(<AccountAccessPage canInstall={false} installed={false} onInstall={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Přihlásit se kódem' }));
    await user.type(screen.getByLabelText('E-mail'), 'puvodni@example.cz');
    await user.click(screen.getByRole('button', { name: 'Poslat přihlašovací kód' }));
    await user.type(screen.getByLabelText('Šestimístný kód'), '111111');
    await user.click(screen.getByRole('button', { name: 'Poslat nový kód' }));

    expect(auth.sendSignInCode).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Šestimístný kód')).toHaveValue('');
    expect(await screen.findByText(/nahrazuje všechny dříve zaslané kódy/i)).toBeInTheDocument();
  });
});
