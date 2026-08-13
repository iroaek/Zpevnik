import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('hledá bez ohledu na diakritiku a otevře píseň', async () => {
    const onOpen = vi.fn();
    render(<Library songs={[song]} favorites={[]} recent={[]} onOpenSong={onOpen} />);
    expect(screen.getByRole('searchbox').closest('.library-sticky-panel')).not.toBeNull();
    await userEvent.type(screen.getByRole('searchbox'), 'zluta');
    await userEvent.click(screen.getByRole('button', { name: /^Žlutá zkouška/ }));
    expect(onOpen).toHaveBeenCalledWith('synteticky-test', expect.any(HTMLElement));
  });

  it('filtr zachová po návratu', () => {
    const songs = Array.from({ length: 15 }, (_, index) => ({
      ...song,
      id: `synteticky-${index}`,
      title: `${index < 10 ? 'A' : 'B'} syntetická ${index}`,
      sortTitle: `${index < 10 ? 'A' : 'B'} syntetická ${index}`,
    }));
    const first = render(<Library songs={songs} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    expect(first.container.querySelectorAll('.song-card')).toHaveLength(15);
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(first.container.querySelectorAll('.song-card')).toHaveLength(5);
    first.unmount();

    const second = render(<Library songs={songs} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    expect(second.container.querySelectorAll('.song-card')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('u tisíců písní ponechá v DOM jen viditelné řádky', () => {
    const songs = Array.from({ length: 1_000 }, (_, index) => ({
      ...song,
      id: `virtualni-${index}`,
      title: `Virtuální syntetická ${index}`,
      sortTitle: `Virtuální syntetická ${index.toString().padStart(4, '0')}`,
    }));
    const view = render(<Library songs={songs} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    expect(view.container.querySelector('.song-list--virtualized')).not.toBeNull();
    expect(view.container.querySelectorAll('.song-card').length).toBeLessThan(100);
    expect(view.container.querySelector('.virtual-song-spacer')).not.toBeNull();
  });

  it('přepíná mezi velkými kartami a kompaktním seznamem', async () => {
    const view = render(<Library songs={[song]} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kompaktní seznam' }));
    expect(view.container.querySelector('.song-list--compact')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Karty' }));
    expect(view.container.querySelector('.song-list--cards')).not.toBeNull();
  });

  it('zobrazí starší tóniny s is jednotně jako křížky', () => {
    render(<Library songs={[{ ...song, originalKey: 'Fis' }]} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    expect(screen.getByLabelText('Tónina F#')).toBeVisible();
    expect(screen.queryByText('Fis')).not.toBeInTheDocument();
  });

  it('přejetí doleva otevře rychlé akce i při okamžitém dokončení gesta', () => {
    vi.useFakeTimers();
    render(<Library songs={[song]} favorites={[]} recent={[]} onOpenSong={vi.fn()} />);
    const card = screen.getByRole('button', { name: /^Žlutá zkouška/ }).closest('article');
    expect(card).not.toBeNull();
    fireEvent.pointerDown(card!, { pointerType: 'touch', clientX: 120, clientY: 30 });
    fireEvent.pointerMove(card!, { pointerType: 'touch', clientX: 45, clientY: 32 });
    fireEvent.pointerUp(card!, { pointerType: 'touch', clientX: 45, clientY: 32 });
    act(() => vi.advanceTimersByTime(140));
    expect(screen.getByRole('dialog', { name: 'Žlutá zkouška' })).toBeVisible();
    vi.useRealTimers();
  });
});
