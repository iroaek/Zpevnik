import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SecureProfile } from '../auth/secureAccess';
import { defaultUserState, type UserProfile } from '../storage/database';
import { Settings } from './Settings';

vi.mock('../auth/secureAccess', () => ({ signOutSecureAccount: vi.fn() }));
vi.mock('../personalLibraryDownload', () => ({ downloadPersonalLibrary: vi.fn() }));
vi.mock('./AdminUsersPanel', () => ({ AdminUsersPanel: () => <section><h2 id="admin-users-heading">Databáze uživatelů</h2></section> }));
vi.mock('./AdminAccessPanel', () => ({ AdminAccessPanel: () => <section><h2 id="admin-access-heading">Schvalování</h2></section> }));
vi.mock('./QrCodeGenerator', () => ({ QrCodeGenerator: () => <section><h2 id="qr-generator-heading">QR kódy</h2></section> }));

const localProfile: UserProfile = {
  schemaVersion: 1,
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Správce',
  role: 'admin',
  monochromeMode: true,
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
};

const secureAdmin: SecureProfile = {
  id: localProfile.id,
  email: 'spravce@example.test',
  display_name: localProfile.displayName,
  status: 'approved',
  role: 'admin',
  created_at: localProfile.createdAt,
  reviewed_at: localProfile.updatedAt,
  last_seen_at: localProfile.updatedAt,
};

describe('administrátorské nastavení', () => {
  afterEach(cleanup);

  it('nabídne samostatnou administraci a umožní obnovit serverová oprávnění', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();
    render(<Settings
      userState={defaultUserState}
      userProfile={localProfile}
      secureProfile={secureAdmin}
      secureMode
      personalSongs={[]}
      onUserStateChange={vi.fn()}
      onUserProfileChange={vi.fn()}
      onPersonalLibraryChanged={vi.fn().mockResolvedValue(undefined)}
      onNavigate={navigate}
      onRefreshSecureProfile={refresh}
    />);

    await userEvent.click(screen.getByRole('button', { name: 'Otevřít administraci' }));
    expect(navigate).toHaveBeenCalledWith('admin');
    await userEvent.click(screen.getByRole('button', { name: 'Obnovit oprávnění' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(await screen.findByText('Oprávnění účtu byla obnovena ze serveru.')).toBeVisible();
  });
});
