import { inspectAppShell } from '../pwa/appShell';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadApprovedLibrary, loadApprovedLibraryManifest, type SecureProfile } from '../auth/secureAccess';
import { catalogSchema } from '../domain/song';
import catalogJson from '../generated/catalog.json';
import { inspectOfflineContent } from '../pwa/contentCache';
import { checkForUpdate } from '../pwa/updateManager';
import { inspectContentPackageIntegrity, loadDownloadedLibraryMetadata, loadPendingMutations, removeDownloadedLibrarySongs, removePersonalSong, removeProtectedSong } from '../storage/database';
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
  loadPendingMutations: vi.fn(),
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

vi.mock('../pwa/appShell', () => ({ inspectAppShell: vi.fn(async () => ({ status: 'verified', checkedAt: '2026-09-07T12:00:00Z', missing: 0 })) }));
const pendingUserId = '33333333-3333-4333-8333-333333333333';
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
    vi.mocked(inspectAppShell).mockResolvedValue({ status: 'verified', checkedAt: '2026-09-07T12:00:00Z', missing: 0 });
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
    vi.mocked(loadPendingMutations).mockReset().mockResolvedValue([]);
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
    await userEvent.click(screen.getByText('Správa obsahu a zařízení'));
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout knihovnu' }));

    await waitFor(() => expect(downloadApprovedLibrary).toHaveBeenCalledWith(profile, expect.objectContaining({
      localSongCount: 0,
      onProgress: expect.any(Function),
    })));
    expect(refreshLibrary).toHaveBeenCalledOnce();
    expect(await screen.findByText('Hotovo: bezpečně uloženo 485 písní. Staženo 1,0 kB, z dříve ověřených částí znovu použito 2,0 kB.')).toBeVisible();
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

    await userEvent.click(screen.getByText('Správa obsahu a zařízení'));
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

  it.each(['missing', 'expired', 'other-account'] as const)('neoznačí dvě ze tří podmínek jako připraveno: %s', async (reason) => {
    vi.mocked(inspectContentPackageIntegrity).mockResolvedValue({ expectedSongs: 1, indexedSongs: 1, completeSongs: 1, missingSongs: 0, invalidSongs: 0, missingContent: 0, alteredContent: 0, availableBytes: 20, expectedBytes: 20, healthy: true });
    const valid = { version: 1 as const, issuer: 'https://auth.example.test', audience: 'qa', subject: profile.id, scopes: ['library:read'], contentPackages: ['members'], contentVersion: 'qa', issuedAt: '2020-01-01T00:00:00Z', notBefore: '2020-01-01T00:00:00Z', offlineValidUntil: '2099-01-01T00:00:00Z', keyId: 'qa' };
    const grant = reason === 'missing' ? null : reason === 'expired' ? { ...valid, offlineValidUntil: '2020-01-02T00:00:00Z' } : { ...valid, subject: pendingUserId };
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} offlineGrant={grant} downloadedLibrarySongs={[downloadedSong]} onNavigate={vi.fn()} onRefreshAuthorization={refresh} />);
    expect(await screen.findByText('Offline příprava není dokončena')).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Splněné podmínky')).toHaveTextContent('2/3'));
    expect(screen.queryByText('Připraveno bez internetu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Obnovit oprávnění' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it('při vypršení oprávnění zruší připravenost i na otevřené stránce', async () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.mocked(inspectContentPackageIntegrity).mockResolvedValue({ expectedSongs: 1, indexedSongs: 1, completeSongs: 1, missingSongs: 0, invalidSongs: 0, missingContent: 0, alteredContent: 0, availableBytes: 20, expectedBytes: 20, healthy: true });
      const grant = { version: 1 as const, issuer: 'https://auth.example.test', audience: 'qa', subject: profile.id, scopes: ['library:read'], contentPackages: ['members'], contentVersion: 'qa', issuedAt: new Date(now - 60_000).toISOString(), notBefore: new Date(now - 60_000).toISOString(), offlineValidUntil: new Date(now + 5_000).toISOString(), keyId: 'qa' };
      render(<OfflineContent catalog={catalog} secureMode secureProfile={profile} offlineGrant={grant} downloadedLibrarySongs={[downloadedSong]} onNavigate={vi.fn()} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getByText('Připraveno bez internetu')).toBeVisible();
      await act(async () => { await vi.advanceTimersByTimeAsync(5_001); });
      expect(screen.getByText('Offline příprava není dokončena')).toBeVisible();
      expect(screen.getByLabelText('Splněné podmínky')).toHaveTextContent('2/3');
    } finally { cleanup(); vi.useRealTimers(); }
  });

  it('ověřené veřejné texty jsou připravené i bez volitelných not', async () => {
    vi.mocked(inspectOfflineContent).mockResolvedValue({ supported: true, catalogCached: true, allSongsVerified: true, allScoresVerified: false, downloadedSongs: catalog.songs.length, totalSongs: catalog.songs.length, downloadedScores: 0, totalScores: 3, bytes: 20, lastUpdated: null, serviceWorkerActive: true });
    render(<OfflineContent catalog={catalog} onNavigate={vi.fn()} />);
    expect(await screen.findByText('Připraveno bez internetu')).toBeVisible();
    expect(screen.getByLabelText('Splněné podmínky')).toHaveTextContent('3/3');
    expect(screen.getByText('0 / 3 partů')).toBeVisible();
  });

});
