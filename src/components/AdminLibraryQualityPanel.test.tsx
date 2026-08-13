import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../domain/song';
import { AdminLibraryQualityPanel } from './AdminLibraryQualityPanel';

function song(id: string, change: Partial<Song> = {}): Song {
  return {
    id,
    title: 'Syntetická kontrola',
    sortTitle: 'Syntetická kontrola',
    alternativeTitles: [],
    authors: ['Vývojový tým'],
    lyricists: [],
    composers: [],
    language: 'cs',
    originalKey: 'C',
    timeSignature: null,
    tempo: null,
    capo: null,
    tags: [],
    categories: ['synthetic'],
    difficulty: 'easy',
    firstLine: 'Krátký syntetický řádek',
    chordProPath: `content/songs/${id}.cho`,
    contentBytes: 30,
    contentFormat: 'chordpro',
    chordsVerified: true,
    reviewFlags: [],
    scoreAssets: [],
    source: 'synthetic test',
    sourceIdentifier: id,
    rightsStatus: 'synthetic',
    license: 'CC0-1.0',
    attribution: 'Vývojový tým',
    notes: '',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    ...change,
  };
}

describe('administrátorská kontrola kvality', () => {
  afterEach(cleanup);

  it('oddělí akordové chyby a duplicity bez automatického slučování', async () => {
    const openSong = vi.fn();
    render(<AdminLibraryQualityPanel songs={[
      song('prvni', { reviewFlags: ['malformed_chord_layout'] }),
      song('druha'),
      song('treti'),
    ]} onOpenSong={openSong} />);

    expect(screen.getByText('Rozpadlé umístění akordů')).toBeVisible();
    expect(screen.getAllByText('Shodný název a interpret')).toHaveLength(3);
    await userEvent.click(screen.getAllByRole('button', { name: 'Porovnat verze' })[0]);
    expect(screen.getByRole('heading', { name: 'Porovnání 3 verzí' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: /Akordy/ }));
    await userEvent.click(screen.getByRole('button', { name: /Otevřít a prověřit/ }));
    expect(openSong).toHaveBeenCalledWith('prvni');
    expect(screen.getByText(/nikdy sama nemaže ani neslučuje/)).toBeVisible();
  });
});
