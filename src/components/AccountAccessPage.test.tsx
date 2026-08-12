import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountAccessPage } from './AccountAccessPage';

const auth = vi.hoisted(() => ({
  register: vi.fn(),
  reset: vi.fn(),
  sendVerification: vi.fn(),
  signIn: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('../auth/secureAccess', () => ({
  registerSecureAccount: auth.register,
  sendEmailVerificationCode: auth.sendVerification,
  sendPasswordReset: auth.reset,
  signInSecureAccount: auth.signIn,
  verifyEmailVerificationCode: auth.verify,
}));

describe('schvalovaný účet', () => {
  afterEach(cleanup);

  beforeEach(() => {
    auth.register.mockReset().mockResolvedValue({ needsEmailConfirmation: true });
    auth.reset.mockReset().mockResolvedValue(undefined);
    auth.sendVerification.mockReset().mockResolvedValue(undefined);
    auth.signIn.mockReset().mockResolvedValue(undefined);
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
  });

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

  it('aktivuje migrovaný účet novým heslem a přejde na OTP', async () => {
    const user = userEvent.setup();
    render(<AccountAccessPage canInstall={false} installed={false} onInstall={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Aktivovat původní účet' }));
    await user.type(screen.getByLabelText('E-mail'), 'puvodni@example.cz');
    await user.type(screen.getByLabelText('Heslo', { selector: '#account-password' }), 'NoveBezpecneHeslo42');
    await user.type(screen.getByLabelText('Heslo znovu'), 'NoveBezpecneHeslo42');
    await user.click(screen.getByRole('button', { name: 'Poslat aktivační kód' }));

    expect(auth.register).toHaveBeenCalledWith({
      displayName: 'Původní člen',
      email: 'puvodni@example.cz',
      password: 'NoveBezpecneHeslo42',
    });
    expect(auth.sendVerification).toHaveBeenCalledWith('puvodni@example.cz');
    expect(await screen.findByRole('heading', { name: 'Ověření e-mailu' })).toBeInTheDocument();
    expect(screen.getByText(/obnoví váš původní profil/i)).toBeInTheDocument();
  });

  it('umožní znovu poslat OTP pro rozpracovanou aktivaci', async () => {
    auth.register.mockRejectedValueOnce(new Error('Účet s tímto e-mailem už v Neonu existuje. Použijte přihlášení nebo obnovu hesla.'));
    const user = userEvent.setup();
    render(<AccountAccessPage canInstall={false} installed={false} onInstall={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Aktivovat původní účet' }));
    await user.type(screen.getByLabelText('E-mail'), 'puvodni@example.cz');
    await user.type(screen.getByLabelText('Heslo', { selector: '#account-password' }), 'NoveBezpecneHeslo42');
    await user.type(screen.getByLabelText('Heslo znovu'), 'NoveBezpecneHeslo42');
    await user.click(screen.getByRole('button', { name: 'Poslat aktivační kód' }));

    expect(auth.sendVerification).toHaveBeenCalledWith('puvodni@example.cz');
    expect(await screen.findByText(/aktivační účet už existoval/i)).toBeInTheDocument();
  });
});
