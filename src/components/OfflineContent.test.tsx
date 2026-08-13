import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadApprovedLibrary, loadApprovedLibraryManifest, type SecureProfile } from '../auth/secureAccess';
import { catalogSchema } from '../domain/song';
import catalogJson from '../generated/catalog.json';
import { inspectOfflineContent } from '../pwa/contentCache';
import { checkForUpdate } from '../pwa/updateManager';
import { inspectContentPackageIntegrity, loadDownloadedLibraryMetadata, removeDownloadedLibrarySongs, removePersonalSong, removeProtectedSong } from '../storage/database';
import { OfflineContent } from './OfflineContent';

vi.mock('../hooks/useConnectivity', () => ({ useConnectivity: () => true }));
vi.mock('../auth/secureAccess', () => ({ downloadApprovedLibrary: vi.fn(), loadApprovedLibraryManifest: vi.fn() }));
vi.mock('../pwa/updateManager', () => ({
  activateWaitingUpdate: vi.fn(),
  checkForUpdate: vi.fn(),
  hasWaitingUpdate: vi.fn(() => false),
}));
vi.mock('../storage/database', () => ({
  loadDownloadedLibraryMetadata: vi.fn(),
  inspectContentPackageIntegrity: vi.fn(),
  removeDownloadedLibrarySongs: vi.fn(),
  removePersonalSong: vi.fn(),
  removeProtectedSong: vi.fn(),
}));
vi.mock('../pwa/contentCache', () => ({
  inspectOfflineContent: vi.fn(),
  downloadAllSongs: vi.fn(),
  downloadAllScores: vi.fn(),
  removeAllOfflineContent: vi.fn(),
  removeScores: vi.fn(),
  removeSongs: vi.fn(),
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
  auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'clen@example.test',
  display_name: 'Mobilní člen',
  status: 'approved',
  role: 'member',
  created_at: '2026-08-06T00:00:00.000Z',
  reviewed_at: '2026-08-06T01:00:00.000Z',
  last_seen_at: null,
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
    vi.mocked(loadApprovedLibraryManifest).mockReset().mockResolvedValue(null);
    vi.mocked(loadDownloadedLibraryMetadata).mockReset().mockResolvedValue(null);
    vi.mocked(inspectContentPackageIntegrity).mockReset().mockResolvedValue(null);
    vi.mocked(removeDownloadedLibrarySongs).mockReset().mockResolvedValue(1);
    vi.mocked(removePersonalSong).mockReset().mockResolvedValue(undefined);
    vi.mocked(removeProtectedSong).mockReset().mockResolvedValue(undefined);
    vi.mocked(checkForUpdate).mockReset().mockResolvedValue('up-to-date');
  });

  it('nabídne schválenému členovi stažení knihovny a po importu obnoví seznam písní', async () => {
    const refreshLibrary = vi.fn().mockResolvedValue(undefined);
    vi.mocked(downloadApprovedLibrary).mockResolvedValue({
      count: 485,
      changed: true,
      manifest: null,
      downloadedBytes: 1024,
      reusedBytes: 2048,
      downloadedChunks: 1,
      reusedChunks: 2,
    });

    render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} downloadedLibrarySongs={[]} onPersonalLibraryChanged={refreshLibrary} onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout knihovnu' }));

    await waitFor(() => expect(downloadApprovedLibrary).toHaveBeenCalledWith(profile, expect.objectContaining({
      localSongCount: 0,
      onProgress: expect.any(Function),
    })));
    expect(refreshLibrary).toHaveBeenCalledOnce();
    expect(await screen.findByText('Hotovo: bezpečně uloženo 485 písní. Staženo 1.0 kB, z dříve ověřených částí znovu použito 2.0 kB.')).toBeVisible();
  });

  it('rozpozná novější verzovaný balíček a nabídne bezpečnou aktualizaci', async () => {
    vi.mocked(loadDownloadedLibraryMetadata).mockResolvedValue({
      schemaVersion: 1, scope: 'members', version: 'a'.repeat(12), generatedAt: '2026-08-06T00:00:00.000Z',
      songCount: 1, contentBytes: 100, downloadedAt: '2026-08-06T01:00:00.000Z',
    });
    vi.mocked(loadApprovedLibraryManifest).mockResolvedValue({
      schemaVersion: 1, scope: 'members', version: 'b'.repeat(12), generatedAt: '2026-08-07T00:00:00.000Z',
      songCount: 2, contentBytes: 200,
    });
    render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} downloadedLibrarySongs={[downloadedSong]} onNavigate={vi.fn()} />);

    expect(await screen.findByText('Je dostupná nová verze')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nainstalovat novou knihovnu' })).toBeEnabled();
  });

  it('v místním režimu soukromou členskou kartu nezobrazuje', () => {
    render(<OfflineContent catalog={catalog} onNavigate={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Soukromá knihovna' })).not.toBeInTheDocument();
  });

  it('odstraní vybranou členskou píseň pouze z tohoto zařízení', async () => {
    const refreshLibrary = vi.fn().mockResolvedValue(undefined);
    render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} downloadedLibrarySongs={[downloadedSong]} onPersonalLibraryChanged={refreshLibrary} onNavigate={vi.fn()} />);

    await userEvent.click(screen.getByText('Odstranit jednotlivé písně (1)'));
    await userEvent.click(screen.getByRole('button', { name: 'Odstranit Stažená syntetická píseň z tohoto zařízení' }));
    await userEvent.click(screen.getByRole('button', { name: 'Potvrdit' }));

    await waitFor(() => expect(removeProtectedSong).toHaveBeenCalledWith(profile.id, downloadedSong.id));
    expect(refreshLibrary).toHaveBeenCalledOnce();
    expect(await screen.findByText('Píseň „Stažená syntetická píseň“ byla odstraněna pouze z tohoto zařízení.')).toBeVisible();
  });

  it('po potvrzení odstraní celou staženou členskou knihovnu', async () => {
    const refreshLibrary = vi.fn().mockResolvedValue(undefined);
    render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} downloadedLibrarySongs={[downloadedSong]} onPersonalLibraryChanged={refreshLibrary} onNavigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Odstranit knihovnu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ano, odstranit knihovnu' }));

    await waitFor(() => expect(removeDownloadedLibrarySongs).toHaveBeenCalledOnce());
    expect(refreshLibrary).toHaveBeenCalledOnce();
    expect(await screen.findByText('Stažená soukromá knihovna byla z tohoto zařízení odstraněna (1 písní). Vlastní PDF importy zůstaly zachované.')).toBeVisible();
  });

  it('zobrazí srozumitelný výsledek ruční kontroly aktualizace', async () => {
    render(<OfflineContent catalog={catalog} onNavigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Zkontrolovat aktualizaci' }));

    await waitFor(() => expect(checkForUpdate).toHaveBeenCalledOnce());
    expect(await screen.findByText('Používáte nejnovější dostupnou verzi aplikace.')).toBeVisible();
  });
});
