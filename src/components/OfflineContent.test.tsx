import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadApprovedLibrary, type SecureProfile } from '../auth/secureAccess';
import { catalogSchema } from '../domain/song';
import catalogJson from '../generated/catalog.json';
import { inspectOfflineContent } from '../pwa/contentCache';
import { OfflineContent } from './OfflineContent';

vi.mock('../hooks/useConnectivity', () => ({ useConnectivity: () => true }));
vi.mock('../auth/secureAccess', () => ({ downloadApprovedLibrary: vi.fn() }));
vi.mock('../pwa/updateManager', () => ({ checkForUpdate: vi.fn() }));
vi.mock('../pwa/contentCache', () => ({
  inspectOfflineContent: vi.fn(),
  downloadAllSongs: vi.fn(),
  downloadAllScores: vi.fn(),
  removeAllOfflineContent: vi.fn(),
  removeScores: vi.fn(),
}));

const catalog = catalogSchema.parse(catalogJson as unknown);
const profile: SecureProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'clen@example.test',
  display_name: 'Mobilní člen',
  status: 'approved',
  role: 'member',
  created_at: '2026-08-06T00:00:00.000Z',
  reviewed_at: '2026-08-06T01:00:00.000Z',
};

describe('Offline obsah', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(inspectOfflineContent).mockResolvedValue({
      supported: true,
      catalogCached: true,
      allSongsVerified: false,
      allScoresVerified: false,
      downloadedSongs: 0,
      downloadedScores: 0,
      totalSongs: catalog.songs.length,
      totalScores: 0,
      bytes: 0,
      lastUpdated: null,
      serviceWorkerActive: true,
    });
    vi.mocked(downloadApprovedLibrary).mockReset();
  });

  it('nabídne schválenému členovi stažení knihovny a po importu obnoví seznam písní', async () => {
    const refreshLibrary = vi.fn().mockResolvedValue(undefined);
    vi.mocked(downloadApprovedLibrary).mockResolvedValue(485);

    render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} personalSongCount={0} onPersonalLibraryChanged={refreshLibrary} onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout členské písně' }));

    await waitFor(() => expect(downloadApprovedLibrary).toHaveBeenCalledWith(profile));
    expect(refreshLibrary).toHaveBeenCalledOnce();
    expect(await screen.findByText('Hotovo: do tohoto zařízení bylo bezpečně uloženo 485 členských písní.')).toBeVisible();
  });

  it('v místním režimu soukromou členskou kartu nezobrazuje', () => {
    render(<OfflineContent catalog={catalog} onNavigate={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Soukromá členská knihovna' })).not.toBeInTheDocument();
  });
});
