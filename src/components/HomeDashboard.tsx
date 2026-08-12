import { useMemo } from 'react';
import type { Song } from '../domain/song';
import { Icon } from '../ui/Icon';

interface HomeDashboardProps {
  songs: Song[];
  favorites: string[];
  recent: string[];
  setlistCount: number;
  onOpenSong: (id: string) => void;
  onNavigate: (path: string) => void;
}

export function HomeDashboard({ songs, favorites, recent, setlistCount, onOpenSong, onNavigate }: HomeDashboardProps) {
  const lastSong = useMemo(() => {
    const songById = new Map(songs.map((song) => [song.id, song]));
    return recent.map((id) => songById.get(id)).find((song): song is Song => Boolean(song));
  }, [recent, songs]);

  return (
    <section className="home-dashboard-page" aria-labelledby="home-dashboard-heading">
      <section className="library-dashboard library-dashboard--home">
        <div className="library-dashboard__heading">
          <p className="eyebrow">Váš hudební prostor</p>
          <h1 id="home-dashboard-heading">Český zpěvník</h1>
          <p>Texty, akordy a setlisty připravené na pódium i k ohni.</p>
        </div>
        <nav className="dashboard-orbits" aria-label="Hudební rozcestník">
          <button type="button" onClick={() => lastSong ? onOpenSong(lastSong.id) : onNavigate('songs')}>
            <span aria-hidden="true"><Icon name="play" size={36} /></span><strong>Pokračovat</strong><small>{lastSong?.title ?? 'Vybrat píseň'}</small>
          </button>
          <button type="button" onClick={() => onNavigate('songs')}>
            <span aria-hidden="true"><Icon name="music" size={36} /></span><strong>Akordy</strong><small>{songs.length} písní</small>
          </button>
          <button type="button" onClick={() => onNavigate('songs/favorites')}>
            <span aria-hidden="true"><Icon name="heart" size={36} /></span><strong>Oblíbené</strong><small>{favorites.length} písní</small>
          </button>
          <button type="button" onClick={() => onNavigate('songs/artists')}>
            <span aria-hidden="true"><Icon name="users" size={36} /></span><strong>Interpreti</strong><small>Podle autora</small>
          </button>
          <button type="button" onClick={() => onNavigate('setlists')}>
            <span aria-hidden="true"><Icon name="list" size={36} /></span><strong>Setlisty</strong><small>{setlistCount} seznamů</small>
          </button>
          <button type="button" onClick={() => onNavigate('import')}>
            <span aria-hidden="true"><Icon name="plus" size={36} /></span><strong>Přidat</strong><small>PDF nebo píseň</small>
          </button>
        </nav>
      </section>
    </section>
  );
}
