import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../domain/song';
import { HomeDashboard } from './HomeDashboard';

const song = {
  id: 'synteticky-test', title: 'Syntetická zkouška', sortTitle: 'Syntetická zkouška', alternativeTitles: [],
  authors: ['Test'], lyricists: [], composers: [], language: 'cs', originalKey: 'G', timeSignature: null, tempo: null,
  capo: null, tags: [], categories: [], difficulty: 'easy', firstLine: 'Vymyšlený řádek', chordProPath: 'content/test.cho',
  contentBytes: 12, scoreAssets: [], source: 'test', sourceIdentifier: 'test', rightsStatus: 'synthetic', license: 'CC0-1.0',
  attribution: 'test', notes: '', createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z',
} satisfies Song;

describe('Úvodní rozcestník', () => {
  afterEach(cleanup);

  it('zobrazuje pouze šest hlavních voleb a otevře samostatnou knihovnu', async () => {
    const onNavigate = vi.fn();
    const view = render(<HomeDashboard songs={[song]} favorites={[]} recent={[]} setlistCount={0} onOpenSong={vi.fn()} onNavigate={onNavigate} />);
    expect(view.container.querySelectorAll('.dashboard-orbits button')).toHaveLength(6);
    expect(view.container.querySelector('.library-sticky-panel')).toBeNull();
    expect(view.container.querySelector('.song-list')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Akordy/ }));
    expect(onNavigate).toHaveBeenCalledWith('songs');
  });
});
