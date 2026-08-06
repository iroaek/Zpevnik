import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountAccessPage } from './AccountAccessPage';

const auth = vi.hoisted(() => ({
  register: vi.fn(),
  reset: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('../auth/secureAccess', () => ({
  registerSecureAccount: auth.register,
  sendPasswordReset: auth.reset,
  signInSecureAccount: auth.signIn,
}));

describe('schvalovaný účet', () => {
  afterEach(cleanup);

  beforeEach(() => {
    auth.register.mockReset().mockResolvedValue({ needsEmailConfirmation: true });
    auth.reset.mockReset().mockResolvedValue(undefined);
    auth.signIn.mockReset().mockResolvedValue(undefined);
  });

  it('odešle úplnou registraci a vysvětlí potvrzení e-mailu i schválení', async () => {
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
    expect(await screen.findByText(/potvrďte odkaz v e-mailu/i)).toBeInTheDocument();
    expect(screen.getByText(/počká na schválení administrátorem/i)).toBeInTheDocument();
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
});
