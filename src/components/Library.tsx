import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '../domain/song';
import type { PersonalLibrarySummary } from '../personalLibrary';

type CollectionMode = 'all' | 'favorites' | 'recent';

interface LibraryProps {
  songs: Song[];
  favorites: string[];
  recent: string[];
  setlistCount?: number;
  onOpenSong: (id: string) => void;
  onNavigate: (path: string) => void;
  personalSummary?: PersonalLibrarySummary | null;
  deviceSongCount?: number;
}

interface LibraryViewState {
  query: string;
  mode: CollectionMode;
  key: string;
  difficulty: string;
  language: string;
  category: string;
  scoreAvailability: string;
  instrument: string;
  letter: string;
}

const PAGE_SIZE = 60;
const VIEW_STORAGE_KEY = 'zpevnik-library-view-v1';
const initialView: LibraryViewState = { query: '', mode: 'all', key: '', difficulty: '', language: '', category: '', scoreAvailability: '', instrument: '', letter: '' };

function loadView(): LibraryViewState {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(VIEW_STORAGE_KEY) ?? '') as Partial<LibraryViewState>;
    return { ...initialView, ...parsed, mode: ['all', 'favorites', 'recent'].includes(parsed.mode ?? '') ? parsed.mode as CollectionMode : 'all' };
  } catch {
    return initialView;
  }
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs');
}

function firstLetter(song: Song): string {
  const first = normalize(song.sortTitle || song.title).charAt(0).toLocaleUpperCase('cs');
  return /^[A-Z]$/.test(first) ? first : '#';
}

function reviewCount(song: Song): number {
  return new Set([...(song.reviewFlags ?? []), ...song.tags.filter((tag) => tag.startsWith('review:'))]).size;
}

export function Library({ songs, favorites, recent, setlistCount = 0, onOpenSong, onNavigate, personalSummary, deviceSongCount = 0 }: LibraryProps) {
  const [view, setView] = useState<LibraryViewState>(loadView);
  const [page, setPage] = useState({ signature: '', count: PAGE_SIZE });
  const sentinelRef = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(view.query);
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);

  const updateView = <K extends keyof LibraryViewState>(key: K, value: LibraryViewState[K]) => setView((current) => ({ ...current, [key]: value }));
  const clearFilters = () => setView((current) => ({ ...initialView, query: current.query, mode: current.mode }));

  useEffect(() => {
    try { sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view)); } catch { /* Soukromý režim může sessionStorage blokovat. */ }
  }, [view]);

  const options = useMemo(() => ({
    keys: [...new Set(songs.map((song) => song.originalKey).filter(Boolean))] as string[],
    languages: [...new Set(songs.map((song) => song.language))],
    categories: [...new Set(songs.flatMap((song) => song.categories))],
    instruments: [...new Set(songs.flatMap((song) => song.scoreAssets.map((asset) => asset.instrument)))],
    letters: [...new Set(songs.map(firstLetter))].sort((left, right) => left.localeCompare(right, 'cs')),
  }), [songs]);

  const searchIndex = useMemo(() => new Map(songs.map((song) => [song.id, [song.title, ...song.alternativeTitles, ...song.authors, song.firstLine, ...song.tags, ...song.categories].map(normalize).join(' ')])), [songs]);
  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const recentSongs = useMemo(() => recent.map((id) => songById.get(id)).filter((song): song is Song => Boolean(song)).slice(0, 8), [recent, songById]);
  const lastSong = recentSongs[0];

  const filtered = useMemo(() => {
    const needle = normalize(deferredQuery.trim());
    const base = view.mode === 'favorites'
      ? songs.filter((song) => favoriteIds.has(song.id))
      : view.mode === 'recent'
        ? recent.map((id) => songById.get(id)).filter((song): song is Song => Boolean(song))
        : songs;
    return base.filter((song) => {
      const haystack = searchIndex.get(song.id) ?? '';
      return (!needle || haystack.includes(needle))
        && (!view.letter || firstLetter(song) === view.letter)
        && (!view.key || song.originalKey === view.key)
        && (!view.difficulty || song.difficulty === view.difficulty)
        && (!view.language || song.language === view.language)
        && (!view.category || song.categories.includes(view.category))
        && (!view.scoreAvailability || (view.scoreAvailability === 'yes' ? song.scoreAssets.length > 0 : song.scoreAssets.length === 0))
        && (!view.instrument || song.scoreAssets.some((asset) => asset.instrument === view.instrument));
    });
  }, [deferredQuery, favoriteIds, recent, searchIndex, songById, songs, view]);

  const filterSignature = JSON.stringify([deferredQuery, view.mode, view.letter, view.key, view.difficulty, view.language, view.category, view.scoreAvailability, view.instrument]);
  const visibleCount = page.signature === filterSignature ? page.count : PAGE_SIZE;
  const visibleSongs = filtered.slice(0, visibleCount);
  const activeFilterCount = [view.letter, view.key, view.difficulty, view.language, view.category, view.scoreAvailability, view.instrument].filter(Boolean).length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= filtered.length || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setPage({ signature: filterSignature, count: visibleCount + PAGE_SIZE });
    }, { rootMargin: '500px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filterSignature, filtered.length, visibleCount]);

  return (
    <section className="library" aria-labelledby="library-heading">
      <div className="hero-card">
        <p className="eyebrow">Offline u ohně i doma</p>
        <h1 id="library-heading">Co si dnes zazpíváme?</h1>
      </div>
      <label className="search-box library-sticky-search">
        <span className="visually-hidden">Hledat píseň</span><span aria-hidden="true">⌕</span>
        <input type="search" value={view.query} onChange={(event) => updateView('query', event.target.value)} placeholder="Název, autor, první řádek…" />
        {view.query && <button type="button" className="search-clear" aria-label="Vymazat hledání" onClick={() => updateView('query', '')}>×</button>}
      </label>

      <nav className="library-quick-actions" aria-label="Rychlé volby knihovny">
        {lastSong && <button type="button" onClick={() => onOpenSong(lastSong.id)}><span aria-hidden="true">▶</span><span><small>Pokračovat</small><strong>{lastSong.title}</strong></span></button>}
        <button type="button" onClick={() => updateView('mode', 'favorites')}><span aria-hidden="true">★</span><span><small>Oblíbené</small><strong>{favorites.length} písní</strong></span></button>
        <button type="button" onClick={() => onNavigate('setlists')}><span aria-hidden="true">☷</span><span><small>Moje setlisty</small><strong>{setlistCount} seznamů</strong></span></button>
      </nav>

      {(personalSummary?.songCount || deviceSongCount > 0) && <aside className="personal-library-note" aria-label="Stav osobní knihovny"><span className="personal-library-note__icon" aria-hidden="true">⌂</span><span><strong>Osobní knihovna: {(personalSummary?.songCount ?? 0) + deviceSongCount} písní</strong><small>{deviceSongCount > 0 && `${deviceSongCount} uložených přímo v tomto zařízení. `}{personalSummary && `${personalSummary.songCount} z místního vývojového serveru.`}</small></span></aside>}

      {recentSongs.length > 1 && view.mode === 'all' && !view.query && <section className="recent-strip" aria-labelledby="recent-strip-heading"><div className="results-heading"><h2 id="recent-strip-heading">Naposledy otevřené</h2><button type="button" className="text-button" onClick={() => updateView('mode', 'recent')}>Zobrazit vše</button></div><div>{recentSongs.map((song) => <button type="button" onClick={() => onOpenSong(song.id)} key={song.id}><strong>{song.title}</strong><small>{song.authors.join(', ') || 'Autor neuveden'}</small></button>)}</div></section>}

      <div className="library-tools">
        <div className="collection-tabs" role="group" aria-label="Sbírka písní">{([['all', 'Všechny'], ['favorites', `Oblíbené (${favorites.length})`], ['recent', 'Nedávné']] as const).map(([value, label]) => <button type="button" className={view.mode === value ? 'chip chip--active' : 'chip'} aria-pressed={view.mode === value} onClick={() => updateView('mode', value)} key={value}>{label}</button>)}</div>
        <div className="alphabet-filter" aria-label="Rychlý výběr podle prvního písmene"><button type="button" className={!view.letter ? 'active' : ''} aria-pressed={!view.letter} onClick={() => updateView('letter', '')}>Vše</button>{options.letters.map((letter) => <button type="button" className={view.letter === letter ? 'active' : ''} aria-pressed={view.letter === letter} onClick={() => updateView('letter', letter)} key={letter}>{letter}</button>)}</div>
      </div>

      <details className="filters">
        <summary>Filtry{activeFilterCount > 0 && ` (${activeFilterCount})`} <span aria-hidden="true">⌄</span></summary>
        <div className="filter-grid">
          <label>Tónina<select value={view.key} onChange={(event) => updateView('key', event.target.value)}><option value="">Všechny</option>{options.keys.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Obtížnost<select value={view.difficulty} onChange={(event) => updateView('difficulty', event.target.value)}><option value="">Všechny</option><option value="easy">Snadná</option><option value="medium">Střední</option><option value="hard">Těžká</option><option value="unknown">Neuvedená</option></select></label>
          <label>Jazyk<select value={view.language} onChange={(event) => updateView('language', event.target.value)}><option value="">Všechny</option>{options.languages.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Typ písně<select value={view.category} onChange={(event) => updateView('category', event.target.value)}><option value="">Všechny</option>{options.categories.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Dostupnost not<select value={view.scoreAvailability} onChange={(event) => updateView('scoreAvailability', event.target.value)}><option value="">Nerozhoduje</option><option value="yes">Má noty</option><option value="no">Bez not</option></select></label>
          <label>Nástroj<select value={view.instrument} onChange={(event) => updateView('instrument', event.target.value)}><option value="">Všechny</option>{options.instruments.map((value) => <option key={value}>{value}</option>)}</select></label>
          {activeFilterCount > 0 && <button type="button" className="secondary-button" onClick={clearFilters}>Zrušit všechny filtry</button>}
        </div>
      </details>

      <div className="results-heading"><h2>Písně</h2><span>{filtered.length} výsledků · zobrazeno {visibleSongs.length}</span></div>
      <div className="song-list">
        {visibleSongs.map((song) => <button type="button" className="song-card" onClick={() => onOpenSong(song.id)} key={song.id}><span className="song-card__main"><strong>{song.title}</strong><span>{song.authors.join(', ') || 'Autor neuveden'}</span>{song.personalOnly && reviewCount(song) > 0 && <span className="song-card__labels"><span>Ke kontrole · {reviewCount(song)}</span></span>}</span><span className="song-card__meta"><span>{song.originalKey ?? '—'}</span>{song.scoreAssets.length > 0 && <span aria-label="Obsahuje noty">♫</span>}{favoriteIds.has(song.id) && <span aria-label="Oblíbená">★</span>}<span aria-hidden="true">›</span></span></button>)}
        {filtered.length === 0 && <p className="empty-state">Tomuto hledání neodpovídá žádná píseň. <button type="button" className="text-button" onClick={() => setView(initialView)}>Zrušit hledání a filtry</button></p>}
      </div>
      {visibleCount < filtered.length && <div ref={sentinelRef} className="load-more"><button type="button" className="secondary-button" onClick={() => setPage({ signature: filterSignature, count: visibleCount + PAGE_SIZE })}>Zobrazit dalších {Math.min(PAGE_SIZE, filtered.length - visibleCount)} písní</button></div>}
    </section>
  );
}
