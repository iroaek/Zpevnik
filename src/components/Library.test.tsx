import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../domain/song';
import { Library } from './Library';

const song: Song = {
  id: 'synteticky-test', title: 'Žlutá zkouška', sortTitle: 'Žlutá zkouška', alternativeTitles: ['Test bez háčků'],
  authors: ['Testovací autor'], lyricists: [], composers: [], language: 'cs', originalKey: 'G', timeSignature: null,
  tempo: null, capo: null, tags: ['syntetická'], categories: ['ukázková'], difficulty: 'easy', firstLine: 'Čistě vymyšlený řádek',
  chordProPath: 'content/songs/test.cho', contentBytes: 12, scoreAssets: [], source: 'test', sourceIdentifier: 'test-1', rightsStatus: 'synthetic',
  license: 'CC0-1.0', attribution: 'test', notes: '', createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z',
};

describe('Knihovna', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it('hledá bez ohledu na diakritiku a otevře píseň', async () => {
    const onOpen = vi.fn();
    render(<Library songs={[song]} favorites={[]} recent={[]} onOpenSong={onOpen} />);
    expect(screen.getByRole('searchbox').closest('.library-sticky-panel')).not.toBeNull();
    await userEvent.type(screen.getByRole('searchbox'), 'zluta');
    await userEvent.click(screen.getByRole('button', { name: /^Žlutá zkouška/ }));
    expect(onOpen).toHaveBeenCalledWith('synteticky-test');
  });

  it('velký katalog vykreslí postupně a filtr zachová po návratu', async () => {
    const songs = Array.from({ length: 75 }, (_, index) => ({
      ...song,
      id: `synteticky-${index}`,
      title: `${index < 65 ? 'A' : 'B'} syntetická ${index}`,
      sortTitle: `${index < 65 ? 'A' : 'B'} syntetická ${index}`,
    }));
    const first = render(<Library songs={songs} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    expect(first.container.querySelectorAll('.song-card')).toHaveLength(60);
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(first.container.querySelectorAll('.song-card')).toHaveLength(10);
    first.unmount();

    const second = render(<Library songs={songs} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    expect(second.container.querySelectorAll('.song-card')).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('přepíná mezi velkými kartami a kompaktním seznamem', async () => {
    const view = render(<Library songs={[song]} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kompaktní seznam' }));
    expect(view.container.querySelector('.song-list--compact')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Karty' }));
    expect(view.container.querySelector('.song-list--cards')).not.toBeNull();
  });

  it('přejetí doleva otevře rychlé akce i při okamžitém dokončení gesta', () => {
    render(<Library songs={[song]} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    const card = screen.getByRole('button', { name: /^Žlutá zkouška/ }).closest('article');
    expect(card).not.toBeNull();
    fireEvent.pointerDown(card!, { pointerType: 'touch', clientX: 120, clientY: 30 });
    fireEvent.pointerMove(card!, { pointerType: 'touch', clientX: 45, clientY: 32 });
    fireEvent.pointerUp(card!, { pointerType: 'touch', clientX: 45, clientY: 32 });
    expect(screen.getByRole('dialog', { name: 'Žlutá zkouška' })).toBeVisible();
  });
});
