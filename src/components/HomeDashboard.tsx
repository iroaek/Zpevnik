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
        <div className="home-ambient" aria-hidden="true"><i /><i /><i /></div>
        <div className="home-ready-pill"><span aria-hidden="true" />Připraveno k hraní</div>
        <div className="library-dashboard__heading">
          <p className="eyebrow">Váš hudební prostor</p>
          <h1 id="home-dashboard-heading">Český zpěvník</h1>
          <p>Texty, akordy a setlisty připravené na pódium i k ohni.</p>
          <div className="home-dashboard-stats" aria-label="Stav zpěvníku">
            <span><strong>{songs.length}</strong><small>písní v knihovně</small></span>
            <i aria-hidden="true" />
            <span><strong>{setlistCount}</strong><small>vašich setlistů</small></span>
          </div>
        </div>
        <nav className="dashboard-orbits" aria-label="Hudební rozcestník">
          <button type="button" className="dashboard-orbit dashboard-orbit--featured" onClick={() => lastSong ? onOpenSong(lastSong.id) : onNavigate('songs')}>
            <span className="dashboard-orbit__icon" aria-hidden="true"><Icon name="play" size={32} /></span><strong>Pokračovat</strong><small>{lastSong?.title ?? 'Vybrat píseň'}</small><em aria-hidden="true">↗</em>
          </button>
          <button type="button" className="dashboard-orbit" onClick={() => onNavigate('songs')}>
            <span className="dashboard-orbit__icon" aria-hidden="true"><Icon name="music" size={32} /></span><strong>Akordy</strong><small>Celá knihovna</small><em aria-hidden="true">↗</em>
          </button>
          <button type="button" className="dashboard-orbit" onClick={() => onNavigate('songs/favorites')}>
            <span className="dashboard-orbit__icon" aria-hidden="true"><Icon name="heart" size={32} /></span><strong>Oblíbené</strong><small>{favorites.length} písní</small><em aria-hidden="true">↗</em>
          </button>
          <button type="button" className="dashboard-orbit" onClick={() => onNavigate('songs/artists')}>
            <span className="dashboard-orbit__icon" aria-hidden="true"><Icon name="users" size={32} /></span><strong>Interpreti</strong><small>Podle autora</small><em aria-hidden="true">↗</em>
          </button>
          <button type="button" className="dashboard-orbit" onClick={() => onNavigate('setlists')}>
            <span className="dashboard-orbit__icon" aria-hidden="true"><Icon name="list" size={32} /></span><strong>Setlisty</strong><small>{setlistCount} seznamů</small><em aria-hidden="true">↗</em>
          </button>
          <button type="button" className="dashboard-orbit" onClick={() => onNavigate('import')}>
            <span className="dashboard-orbit__icon" aria-hidden="true"><Icon name="plus" size={32} /></span><strong>Přidat</strong><small>PDF nebo píseň</small><em aria-hidden="true">↗</em>
          </button>
        </nav>
        <p className="home-gesture-hint"><span aria-hidden="true">●</span> Vyberte prostor a začněte hrát</p>
      </section>
    </section>
  );
}
