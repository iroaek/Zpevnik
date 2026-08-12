import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAllProfiles, loadRemoteSongSubmissions, type SecureProfile } from '../auth/secureAccess';
import { AdminOverview } from './AdminOverview';

vi.mock('../auth/secureAccess', () => ({ loadAllProfiles: vi.fn(), loadRemoteSongSubmissions: vi.fn() }));

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

describe('profesionální administrátorský dashboard', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(loadAllProfiles).mockReset().mockResolvedValue([
      profile({ id: '11111111-1111-4111-8111-111111111111', display_name: 'Schválený člen', email: 'schvaleny@example.test', status: 'approved', last_seen_at: new Date().toISOString() }),
      profile({ id: '22222222-2222-4222-8222-222222222222', display_name: 'Čekající člen', email: 'cekajici@example.test' }),
    ]);
    vi.mocked(loadRemoteSongSubmissions).mockReset().mockResolvedValue([{
      id: '33333333-3333-4333-8333-333333333333',
      user_id: '11111111-1111-4111-8111-111111111111',
      kind: 'request',
      title: 'Syntetická píseň',
      artist: '',
      notes: '',
      file_path: null,
      file_name: null,
      file_type: null,
      file_size: 0,
      rights_status: 'requires_review',
      license: 'UNVERIFIED - requires admin review',
      attribution: 'Schválený člen',
      status: 'pending_review',
      admin_note: '',
      created_at: '2026-08-06T00:00:00.000Z',
    }]);
  });

  it('zobrazuje metriky, grafy a propojenou pracovní frontu', async () => {
    const onOpen = vi.fn();
    render(<AdminOverview online cloudSync={{ status: 'synced', lastSyncedAt: null, error: null, pendingCount: 2, nextRetryAt: null, refresh: vi.fn().mockResolvedValue(undefined) }} onOpen={onOpen} />);

    await waitFor(() => expect(loadAllProfiles).toHaveBeenCalledOnce());
    expect(screen.getByRole('heading', { name: 'Přehled administrace' })).toBeVisible();
    expect(screen.getByRole('img', { name: '1 z 2 účtů je schválených' })).toBeVisible();
    expect(screen.getByText('Vyžaduje pozornost').parentElement).toHaveTextContent('4');
    await userEvent.click(screen.getByRole('button', { name: /Nové registrace/ }));
    expect(onOpen).toHaveBeenCalledWith('requests');
  });
});
