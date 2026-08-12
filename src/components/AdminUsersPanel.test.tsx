import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAllProfiles, loadAllSecureDevices, type SecureProfile } from '../auth/secureAccess';
import { AdminUsersPanel } from './AdminUsersPanel';
import { isProfileOnline } from './adminUserPresence';

vi.mock('../auth/secureAccess', () => ({ loadAllProfiles: vi.fn(), loadAllSecureDevices: vi.fn(), revokeSecureDevice: vi.fn(), setSecureProfileStatus: vi.fn() }));

function profile(overrides: Partial<SecureProfile> & Pick<SecureProfile, 'id' | 'display_name' | 'email'>): SecureProfile {
  const { id, display_name, email, ...rest } = overrides;
  return {
    id,
    auth_user_id: null,
    display_name,
    email,
    status: 'pending',
    role: 'member',
    created_at: '2026-08-06T00:00:00.000Z',
    reviewed_at: null,
    last_seen_at: null,
    ...rest,
  };
}

describe('administrátorský přehled uživatelů', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(loadAllSecureDevices).mockReset().mockResolvedValue([]);
    vi.mocked(loadAllProfiles).mockReset().mockResolvedValue([
      profile({ id: '11111111-1111-4111-8111-111111111111', display_name: 'Online člen', email: 'online@example.test', status: 'approved', last_seen_at: new Date().toISOString() }),
      profile({ id: '22222222-2222-4222-8222-222222222222', display_name: 'Čekající člen', email: 'ceka@example.test' }),
      profile({ id: '33333333-3333-4333-8333-333333333333', display_name: 'Starší člen', email: 'offline@example.test', last_seen_at: '2026-08-06T00:00:00.000Z' }),
    ]);
  });

  it('zobrazí počty registrovaných, online a autorizovaných i jejich jména', async () => {
    render(<AdminUsersPanel />);

    await waitFor(() => expect(loadAllProfiles).toHaveBeenCalledOnce());
    expect(screen.getByText('Registrovaných').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Online').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Autorizovaných').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Online člen')).toBeVisible();
    expect(screen.getByText('Čekající člen')).toBeVisible();
    expect(screen.getByText('Starší člen')).toBeVisible();
  });

  it('vyhledává podle jména a e-mailu', async () => {
    render(<AdminUsersPanel />);
    await screen.findByText('Online člen');

    await userEvent.type(screen.getByLabelText('Hledat podle jména nebo e-mailu'), 'ceka@');

    expect(screen.getByText('Čekající člen')).toBeVisible();
    expect(screen.queryByText('Online člen')).not.toBeInTheDocument();
  });

  it('považuje za online pouze aktivitu z posledních dvou minut', () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    expect(isProfileOnline(profile({ id: '44444444-4444-4444-8444-444444444444', display_name: 'Aktivní', email: 'aktivni@example.test', last_seen_at: '2026-08-06T11:58:01.000Z' }), now)).toBe(true);
    expect(isProfileOnline(profile({ id: '55555555-5555-4555-8555-555555555555', display_name: 'Neaktivní', email: 'neaktivni@example.test', last_seen_at: '2026-08-06T11:57:59.000Z' }), now)).toBe(false);
  });
});
