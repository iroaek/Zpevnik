import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Song } from '../domain/song';
import type { UserState } from '../storage/database';
import { SongReader } from './SongReader';

vi.mock('../pwa/contentCache', () => ({
  fetchContent: vi.fn(async () => new Response('{title: Syntetická píseň}\n[C]Čistě vymyšlený řádek')),
}));

vi.mock('../auth/secureAccess', () => ({
  submitSongCorrection: vi.fn(async () => undefined),
}));

vi.mock('../storage/database', () => ({
  getLocalSongOverride: vi.fn(async () => null),
  getPersonalSongContent: vi.fn(async () => null),
  removeLocalSongOverride: vi.fn(async () => undefined),
  saveLocalSongOverride: vi.fn(async () => undefined),
  toggleFavorite: (state: UserState) => state,
  updateSetlistSongs: (state: UserState) => state,
}));

const song = {
  id: 'vykon-test', title: 'Syntetická píseň', sortTitle: 'Syntetická píseň', alternativeTitles: [],
  authors: ['Test'], lyricists: [], composers: [], language: 'cs', originalKey: 'C', timeSignature: '4/4', tempo: 96,
  capo: null, tags: [], categories: ['syntetická'], difficulty: 'easy', firstLine: 'Čistě vymyšlený řádek', chordProPath: 'content/test.cho',
  contentBytes: 48, scoreAssets: [], source: 'test', sourceIdentifier: 'test', rightsStatus: 'synthetic', license: 'CC0-1.0',
  attribution: 'test', notes: '', createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z',
} satisfies Song;

const initialState: UserState = {
  schemaVersion: 7,
  updatedAt: '2026-08-13T00:00:00.000Z',
  favorites: [], recentSongIds: [], setlists: [], songReaderPreferences: {},
  settings: {
    theme: 'system', fontSize: 20, notation: 'czech', showChords: true, collapseRepeatedChoruses: true,
    printSize: 'A4', autoScrollSpeed: 25, catalogDensity: 'standard', motion: 'gentle',
    accessibility: { highContrast: false, largeControls: false, oneHanded: false },
    reader: {
      chordScale: 1, lineHeight: 1.3, columnWidth: 760, focusSections: false, wrapLayoutText: true,
      stageFontSize: 24, transpose: 0, capoFret: 0, autoScrollSpeed: 25,
    },
  },
};

function Subject() {
  const [state, setState] = useState(initialState);
  return <SongReader song={song} userState={state} onUserStateChange={setState} onBack={vi.fn()} catalogVersion="test" />;
}

describe('Režimy pro živé hraní', () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.fireMode;
    delete document.documentElement.dataset.performanceMode;
  });

  it('odděluje režim u ohně a pódium a ponechá text v hlavní vrstvě', async () => {
    const user = userEvent.setup();
    const view = render(<Subject />);
    expect(await screen.findByText('Čistě vymyšlený řádek')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Režim u ohně' }));
    await waitFor(() => expect(view.container.querySelector('.song-reader--fire')).not.toBeNull());
    expect(screen.getByRole('navigation', { name: 'Hlavní ovládání hraní' })).toBeVisible();
    expect(screen.getByText('Čistě vymyšlený řádek')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Ukončit režim u ohně' }));
    await waitFor(() => expect(view.container.querySelector('.song-reader--off')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Pódiový režim' }));
    await waitFor(() => expect(view.container.querySelector('.song-reader--stage')).not.toBeNull());
    expect(document.documentElement.dataset.performanceMode).toBe('stage');
  });
});
