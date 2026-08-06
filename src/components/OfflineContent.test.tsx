import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadApprovedLibrary, type SecureProfile } from '../auth/secureAccess';
import { catalogSchema } from '../domain/song';
import catalogJson from '../generated/catalog.json';
import { inspectOfflineContent } from '../pwa/contentCache';
import { removeDownloadedLibrarySongs, removePersonalSong } from '../storage/database';
import { OfflineContent } from './OfflineContent';

vi.mock('../hooks/useConnectivity', () => ({ useConnectivity: () => true }));
vi.mock('../auth/secureAccess', () => ({ downloadApprovedLibrary: vi.fn() }));
vi.mock('../pwa/updateManager', () => ({ checkForUpdate: vi.fn() }));
vi.mock('../storage/database', () => ({
  removeDownloadedLibrarySongs: vi.fn(),
  removePersonalSong: vi.fn(),
}));
vi.mock('../pwa/contentCache', () => ({
  inspectOfflineContent: vi.fn(),
  downloadAllSongs: vi.fn(),
  downloadAllScores: vi.fn(),
  removeAllOfflineContent: vi.fn(),
  removeScores: vi.fn(),
}));

const catalog = catalogSchema.parse(catalogJson as unknown);
const downloadedSong = {
  ...catalog.songs[0],
  id: 'personal-stazena-synteticka',
  title: 'Stažená syntetická píseň',
  sortTitle: 'Stažená syntetická píseň',
  authors: ['Testovací autor'],
  personalOnly: true,
  chordProPath: 'indexeddb:personal-stazena-synteticka',
  sourceIdentifier: 'songs_data/synteticky-test.pdf#page=1',
};
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
    vi.mocked(removeDownloadedLibrarySongs).mockReset().mockResolvedValue(1);
    vi.mocked(removePersonalSong).mockReset().mockResolvedValue(undefined);
  });

  it('nabídne schválenému členovi stažení knihovny a po importu obnoví seznam písní', async () => {
    const refreshLibrary = vi.fn().mockResolvedValue(undefined);
    vi.mocked(downloadApprovedLibrary).mockResolvedValue(485);

    render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} downloadedLibrarySongs={[]} onPersonalLibraryChanged={refreshLibrary} onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout členské písně' }));

    await waitFor(() => expect(downloadApprovedLibrary).toHaveBeenCalledWith(profile));
    expect(refreshLibrary).toHaveBeenCalledOnce();
    expect(await screen.findByText('Hotovo: do tohoto zařízení bylo bezpečně uloženo 485 členských písní.')).toBeVisible();
  });

  it('v místním režimu soukromou členskou kartu nezobrazuje', () => {
    render(<OfflineContent catalog={catalog} onNavigate={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Soukromá členská knihovna' })).not.toBeInTheDocument();
  });

  it('odstraní vybranou členskou píseň pouze z tohoto zařízení', async () => {
    const refreshLibrary = vi.fn().mockResolvedValue(undefined);
    render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} downloadedLibrarySongs={[downloadedSong]} onPersonalLibraryChanged={refreshLibrary} onNavigate={vi.fn()} />);

    await userEvent.click(screen.getByText('Spravovat stažené písně (1)'));
    await userEvent.click(screen.getByRole('button', { name: 'Odstranit Stažená syntetická píseň z tohoto zařízení' }));
    await userEvent.click(screen.getByRole('button', { name: 'Potvrdit' }));

    await waitFor(() => expect(removePersonalSong).toHaveBeenCalledWith(downloadedSong.id));
    expect(refreshLibrary).toHaveBeenCalledOnce();
    expect(await screen.findByText('Píseň „Stažená syntetická píseň“ byla odstraněna pouze z tohoto zařízení.')).toBeVisible();
  });

  it('po potvrzení odstraní celou staženou členskou knihovnu', async () => {
    const refreshLibrary = vi.fn().mockResolvedValue(undefined);
    render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} downloadedLibrarySongs={[downloadedSong]} onPersonalLibraryChanged={refreshLibrary} onNavigate={vi.fn()} />);

    await userEvent.click(screen.getByText('Spravovat stažené písně (1)'));
    await userEvent.click(screen.getByRole('button', { name: 'Odstranit celou staženou knihovnu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ano, odstranit knihovnu' }));

    await waitFor(() => expect(removeDownloadedLibrarySongs).toHaveBeenCalledOnce());
    expect(refreshLibrary).toHaveBeenCalledOnce();
    expect(await screen.findByText('Stažená soukromá knihovna byla z tohoto zařízení odstraněna (1 písní). Vlastní PDF importy zůstaly zachované.')).toBeVisible();
  });
});
