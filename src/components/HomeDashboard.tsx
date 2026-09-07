import { useMemo, useState } from 'react';
import type { Song } from '../domain/song';
import { Icon, type IconName } from '../ui/Icon';
import { SearchField } from '../ui/SearchField';
import { formatCount } from '../ui/format';
import { resolvePublicPath } from '../pwa/paths';

interface HomeDashboardProps {
  songs: Song[]; favorites: string[]; recent: string[]; setlistCount: number;
  onOpenSong: (id: string) => void; onNavigate: (path: string) => void;
  onSearch?: (query: string) => void;
}
export function HomeDashboard({ songs, favorites, recent, setlistCount, onOpenSong, onNavigate, onSearch }: HomeDashboardProps) {
  const [query, setQuery] = useState('');
  const recentSongs = useMemo(() => {
    const byId = new Map(songs.map((song) => [song.id, song]));
    return recent.map((id) => byId.get(id)).filter((song): song is Song => Boolean(song)).slice(0, 5);
  }, [recent, songs]);
  const lastSong = recentSongs[0];
  const shortcuts: Array<{ path: string; label: string; detail: string; icon: IconName; tone: string }> = [
    { path: 'songs', label: 'Písně', detail: formatCount(songs.length) + ' v knihovně', icon: 'music', tone: 'songs' },
    { path: 'setlists', label: 'Setlisty', detail: formatCount(setlistCount) + ' ' + (setlistCount === 1 ? 'váš seznam' : setlistCount > 1 && setlistCount < 5 ? 'vaše seznamy' : 'vašich seznamů'), icon: 'list', tone: 'setlists' },
    { path: 'songs/favorites', label: 'Oblíbené', detail: formatCount(favorites.length) + ' v oblíbených', icon: 'heart', tone: 'favorites' },
    { path: 'songs/artists', label: 'Autoři', detail: 'Procházet podle jména', icon: 'users', tone: 'authors' },
    { path: 'offline', label: 'Offline', detail: 'Ověřit připravenost', icon: 'download', tone: 'offline' },
    { path: 'import', label: 'Přidat', detail: 'Píseň nebo vlastní PDF', icon: 'plus', tone: 'import' },
  ];
  return <section className="home-dashboard-page" aria-labelledby="home-dashboard-heading">
    <div className="home-intro"><h1 id="home-dashboard-heading">Český zpěvník</h1><p>Písně, které nás spojují.</p></div>
    <form className="home-search" role="search" onSubmit={(event) => { event.preventDefault(); if (onSearch) onSearch(query); else onNavigate('songs'); }}>
      <SearchField value={query} onChange={setQuery} /><button type="submit" className="icon-button" aria-label="Hledat v knihovně"><Icon name="chevronRight" /></button>
    </form>
    <button type="button" className="continue-song" onClick={() => lastSong ? onOpenSong(lastSong.id) : onNavigate('songs')}>
      <img src={resolvePublicPath('images/taborovy-zpevnik.jpg')} alt="" aria-hidden="true" />
      <span><small>{lastSong ? 'Pokračovat v poslední písni' : 'Začněte písní'}</small><strong>{lastSong?.title ?? 'Otevřít knihovnu'}</strong><span>{lastSong?.authors.join(', ') || (lastSong ? 'Autor neuveden' : 'Vyberte, co si dnes zahrajete')}</span></span><Icon name="chevronRight" size={24} />
    </button>
    <nav className="home-shortcuts" aria-label="Hudební rozcestník">
      {shortcuts.map(item => <button key={item.path} type="button" className={'shortcut shortcut--' + item.tone} aria-label={item.label + ' ' + item.detail} onClick={() => onNavigate(item.path)}>
        <Icon name={item.icon} /><span><strong>{item.label}</strong><small>{item.detail}</small></span>
      </button>)}
    </nav>
    {recentSongs.length > 1 && <section className="home-recent"><div className="results-heading"><h2>Naposledy otevřené</h2></div>{recentSongs.slice(1).map((song) => <button type="button" key={song.id} onClick={() => onOpenSong(song.id)}><span><strong>{song.title}</strong><small>{song.authors.join(', ') || 'Autor neuveden'}</small></span><Icon name="chevronRight" size={18} /></button>)}</section>}
  </section>;
}
