import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecureProfile, SharedSetlist } from '../auth/secureAccess';
import { catalogSchema } from '../domain/song';
import catalogJson from '../generated/catalog.json';
import type { Setlist } from '../storage/database';

const api = vi.hoisted(() => ({
  load: vi.fn<() => Promise<SharedSetlist[]>>(),
  publish: vi.fn<() => Promise<string>>(),
  update: vi.fn<() => Promise<void>>(),
  remove: vi.fn<() => Promise<void>>(),
}));

vi.mock('../auth/secureAccess', () => ({
  loadSharedSetlists: api.load,
  publishMySetlist: api.publish,
  updateSharedSetlist: api.update,
  deleteSharedSetlist: api.remove,
}));

import { SharedSetlists } from './SharedSetlists';

const catalog = catalogSchema.parse(catalogJson as unknown);
const song = catalog.songs[0];
const member: SecureProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'clen@example.test',
  display_name: 'Člen Test',
  status: 'approved',
  role: 'member',
  created_at: '2026-08-12T10:00:00.000Z',
  reviewed_at: '2026-08-12T10:05:00.000Z',
  last_seen_at: null,
};
const localSetlist: Setlist = {
  id: 'local-setlist',
  name: 'Večer u ohně',
  songIds: [song.id],
  createdAt: '2026-08-12T10:00:00.000Z',
  updatedAt: '2026-08-12T10:00:00.000Z',
};
const shared: SharedSetlist = {
  id: '22222222-2222-4222-8222-222222222222',
  owner_id: member.id,
  owner_name: member.display_name,
  source_setlist_id: localSetlist.id,
  name: localSetlist.name,
  song_ids: [song.id],
  created_at: '2026-08-12T10:00:00.000Z',
  updated_at: '2026-08-12T10:00:00.000Z',
};

describe('členské sdílené setlisty', () => {
  beforeEach(() => {
    api.load.mockReset();
    api.publish.mockReset();
    api.update.mockReset();
    api.remove.mockReset();
    api.update.mockResolvedValue();
    api.remove.mockResolvedValue();
  });
  afterEach(cleanup);

  it('člen zveřejní vybraný setlist a vidí potvrzení', async () => {
    api.load.mockResolvedValueOnce([]).mockResolvedValueOnce([shared]);
    api.publish.mockResolvedValue(shared.id);
    render(<SharedSetlists songs={catalog.songs} profile={member} online selectedLocal={localSetlist} onOpenSong={vi.fn()} onCopyToMySetlists={vi.fn()} />);

    await waitFor(() => expect(api.load).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Sdílet členům' }));

    await waitFor(() => expect(api.publish).toHaveBeenCalledWith(expect.objectContaining({
      sourceSetlistId: localSetlist.id,
      name: localSetlist.name,
      songIds: [song.id],
    })));
    expect(await screen.findByText(/nyní vidí všichni schválení členové/i)).toBeVisible();
  });

  it('jiný člen uloží sdílený setlist jako vlastní offline kopii', async () => {
    const otherMember = { ...member, id: '33333333-3333-4333-8333-333333333333', auth_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    const copy = vi.fn();
    api.load.mockResolvedValue([shared]);
    render(<SharedSetlists songs={catalog.songs} profile={otherMember} online onOpenSong={vi.fn()} onCopyToMySetlists={copy} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Uložit kopii mezi moje setlisty' }));
    expect(copy).toHaveBeenCalledWith(shared.name, [song.id]);
  });

  it('administrátor upraví setlist jiného člena', async () => {
    const admin: SecureProfile = { ...member, id: '44444444-4444-4444-8444-444444444444', auth_user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', role: 'admin', display_name: 'Správce' };
    api.load.mockResolvedValueOnce([shared]).mockResolvedValueOnce([shared]).mockResolvedValueOnce([{ ...shared, name: 'Upravený večer' }]);
    render(<SharedSetlists songs={catalog.songs} profile={admin} online onOpenSong={vi.fn()} onCopyToMySetlists={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Upravit sdílený setlist' }));
    const input = screen.getByLabelText('Název sdíleného setlistu');
    await userEvent.clear(input);
    await userEvent.type(input, 'Upravený večer');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit sdílené změny' }));

    await waitFor(() => expect(api.update).toHaveBeenCalledWith(shared.id, 'Upravený večer', [song.id]));
    expect(await screen.findByText(/Administrátorská úprava/i)).toBeVisible();
  });

  it('nepřepíše novější úpravu jiného člena', async () => {
    const newer = { ...shared, name: 'Novější verze', updated_at: '2026-08-12T11:00:00.000Z' };
    api.load.mockResolvedValueOnce([shared]).mockResolvedValueOnce([newer]);
    render(<SharedSetlists songs={catalog.songs} profile={member} online onOpenSong={vi.fn()} onCopyToMySetlists={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Upravit sdílený setlist' }));
    await userEvent.click(screen.getByRole('button', { name: 'Uložit sdílené změny' }));

    expect(await screen.findByText(/mezitím upravil jiný člen/i)).toBeVisible();
    expect(api.update).not.toHaveBeenCalled();
  });
});
