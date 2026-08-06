import { useMemo, useState } from 'react';
import type { Song } from '../domain/song';
import type { PersonalLibrarySummary } from '../personalLibrary';

type CollectionMode = 'all' | 'favorites' | 'recent';

interface LibraryProps {
  songs: Song[];
  favorites: string[];
  recent: string[];
  onOpenSong: (id: string) => void;
  personalSummary?: PersonalLibrarySummary | null;
  deviceSongCount?: number;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function Library({ songs, favorites, recent, onOpenSong, personalSummary, deviceSongCount = 0 }: LibraryProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<CollectionMode>('all');
  const [key, setKey] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [language, setLanguage] = useState('');
  const [category, setCategory] = useState('');
  const [scoreAvailability, setScoreAvailability] = useState('');
  const [instrument, setInstrument] = useState('');

  const options = useMemo(() => ({
    keys: [...new Set(songs.map((song) => song.originalKey).filter(Boolean))] as string[],
    languages: [...new Set(songs.map((song) => song.language))],
    categories: [...new Set(songs.flatMap((song) => song.categories))],
    instruments: [...new Set(songs.flatMap((song) => song.scoreAssets.map((asset) => asset.instrument)))],
  }), [songs]);

  const searchIndex = useMemo(() => new Map(songs.map((song) => [song.id, [song.title, ...song.alternativeTitles, ...song.authors, song.firstLine, ...song.tags, ...song.categories].map(normalize).join(' ')])), [songs]);
  const lastSong = recent.length > 0 ? songs.find((song) => song.id === recent[0]) : undefined;

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    const base = mode === 'favorites'
      ? songs.filter((song) => favorites.includes(song.id))
      : mode === 'recent'
        ? recent.map((id) => songs.find((song) => song.id === id)).filter((song): song is Song => Boolean(song))
        : songs;
    return base.filter((song) => {
      const haystack = searchIndex.get(song.id) ?? '';
      return (!needle || haystack.includes(needle))
        && (!key || song.originalKey === key)
        && (!difficulty || song.difficulty === difficulty)
        && (!language || song.language === language)
        && (!category || song.categories.includes(category))
        && (!scoreAvailability || (scoreAvailability === 'yes' ? song.scoreAssets.length > 0 : song.scoreAssets.length === 0))
        && (!instrument || song.scoreAssets.some((asset) => asset.instrument === instrument));
    });
  }, [songs, favorites, recent, mode, query, key, difficulty, language, category, scoreAvailability, instrument, searchIndex]);

  return (
    <section className="library" aria-labelledby="library-heading">
      <div className="hero-card">
        <p className="eyebrow">Offline u ohně i doma</p>
        <h1 id="library-heading">Co si dnes zazpíváme?</h1>
        <label className="search-box">
          <span className="visually-hidden">Hledat píseň</span>
          <span aria-hidden="true">⌕</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Název, autor, první řádek…" />
        </label>
      </div>

      {(personalSummary?.songCount || deviceSongCount > 0) && (
        <aside className="personal-library-note" aria-label="Stav osobní knihovny">
          <span className="personal-library-note__icon" aria-hidden="true">⌂</span>
          <span>
            <strong>Osobní knihovna: {(personalSummary?.songCount ?? 0) + deviceSongCount} písní</strong>
            <small>
              {deviceSongCount > 0 && `${deviceSongCount} uložených přímo v tomto zařízení. `}
              {personalSummary && `${personalSummary.songCount} z místního vývojového serveru; ${personalSummary.continuationCandidates} možných pokračování a ${personalSummary.exactDuplicateGroups} skupin duplicit zůstává odděleno.`}
            </small>
          </span>
        </aside>
      )}

      {lastSong && <button type="button" className="continue-card" onClick={() => onOpenSong(lastSong.id)}><span><small>Pokračovat naposledy</small><strong>{lastSong.title}</strong></span><span aria-hidden="true">›</span></button>}

      <div className="collection-tabs" role="group" aria-label="Sbírka písní">
        {([['all', 'Všechny'], ['favorites', `Oblíbené (${favorites.length})`], ['recent', 'Nedávné']] as const).map(([value, label]) => (
          <button type="button" className={mode === value ? 'chip chip--active' : 'chip'} aria-pressed={mode === value} onClick={() => setMode(value)} key={value}>{label}</button>
        ))}
      </div>

      <details className="filters">
        <summary>Filtry <span aria-hidden="true">⌄</span></summary>
        <div className="filter-grid">
          <label>Tónina<select value={key} onChange={(event) => setKey(event.target.value)}><option value="">Všechny</option>{options.keys.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Obtížnost<select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="">Všechny</option><option value="easy">Snadná</option><option value="medium">Střední</option><option value="hard">Těžká</option><option value="unknown">Neuvedená</option></select></label>
          <label>Jazyk<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">Všechny</option>{options.languages.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Typ písně<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Všechny</option>{options.categories.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Dostupnost not<select value={scoreAvailability} onChange={(event) => setScoreAvailability(event.target.value)}><option value="">Nerozhoduje</option><option value="yes">Má noty</option><option value="no">Bez not</option></select></label>
          <label>Nástroj<select value={instrument} onChange={(event) => setInstrument(event.target.value)}><option value="">Všechny</option>{options.instruments.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
      </details>

      <div className="results-heading"><h2>Písně</h2><span>{filtered.length} výsledků</span></div>
      <div className="song-list">
        {filtered.map((song) => (
          <button type="button" className="song-card" onClick={() => onOpenSong(song.id)} key={song.id}>
            <span className="song-card__main">
              <strong>{song.title}</strong>
              <span>{song.authors.join(', ') || 'Autor neuveden'}</span>
              {song.personalOnly && <span className="song-card__labels"><span>Osobní · ke kontrole</span>{song.reviewFlags?.includes('possible_duplicate') && <span>Možná duplicita</span>}</span>}
            </span>
            <span className="song-card__meta"><span>{song.originalKey ?? '—'}</span>{song.scoreAssets.length > 0 && <span aria-label="Obsahuje noty">♫</span>}{favorites.includes(song.id) && <span aria-label="Oblíbená">★</span>}<span aria-hidden="true">›</span></span>
          </button>
        ))}
        {filtered.length === 0 && <p className="empty-state">Tomuto hledání neodpovídá žádná píseň.</p>}
      </div>
    </section>
  );
}
