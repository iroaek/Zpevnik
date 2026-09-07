import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { normalizeSharpSpelling } from '../domain/chords';
import { createLibrarySearchDocuments, searchLibraryDocuments } from '../domain/librarySearch';
import type { Song } from '../domain/song';
import { Dialog } from '../ui/Dialog';
import { SearchField } from '../ui/SearchField';
import { formatCount } from '../ui/format';
import type { PersonalLibrarySummary } from '../personalLibrary';
import type { CatalogDensity, Setlist } from '../storage/database';
import { isDownloadedLibrarySong } from '../domain/librarySource';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { haptic } from '../ui/haptics';
import { runElementTransition } from '../ui/motion';

type CollectionMode = 'all' | 'favorites' | 'recent';
export type LibraryEntry = 'all' | 'favorites' | 'artists';

interface LibraryProps {
  songs: Song[];
  favorites: string[];
  recent: string[];
  setlists?: Setlist[];
  onOpenSong: (id: string, sharedSource?: HTMLElement | null) => void;
  onToggleFavorite?: (id: string) => void;
  onAddToSetlist?: (songId: string, setlistId: string) => void;
  onAddToTonight?: (songId: string) => void;
  onDeleteSong?: (songId: string) => Promise<void>;
  onNotify?: (message: string) => void;
  personalSummary?: PersonalLibrarySummary | null;
  deviceSongCount?: number;
  entry?: LibraryEntry;
  density?: CatalogDensity;
  onAdd?: () => void;
  onDensityChange?: (density: CatalogDensity) => void;
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
  sort: 'title' | 'author' | 'recent';
}

const VIRTUALIZE_AFTER = 160;
const VIRTUAL_OVERSCAN_ROWS = 4;
const SWIPE_ACTION_THRESHOLD = 64;
const SWIPE_ACTION_WIDTH = 112;
const VIEW_STORAGE_KEY = 'zpevnik-library-view-v1';
const EMPTY_SEARCH_RESULTS = new Set<string>();
const initialView: LibraryViewState = { query: '', mode: 'all', key: '', difficulty: '', language: '', category: '', scoreAvailability: '', instrument: '', letter: '', sort: 'title' };

function loadView(): LibraryViewState {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(VIEW_STORAGE_KEY) ?? '') as Partial<LibraryViewState>;
    return {
      ...initialView,
      ...parsed,
      mode: ['all', 'favorites', 'recent'].includes(parsed.mode ?? '') ? parsed.mode as CollectionMode : 'all',
      sort: ['title', 'author', 'recent'].includes(parsed.sort ?? '') ? parsed.sort as LibraryViewState['sort'] : 'title',
    };
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

function displaySongKey(key: string | null): string {
  return key ? normalizeSharpSpelling(key, 'czech') : '—';
}

export function Library({ songs, favorites, recent, setlists = [], onOpenSong, onToggleFavorite, onAddToSetlist, onAddToTonight, onDeleteSong, onNotify, personalSummary, deviceSongCount = 0, entry = 'all', density = 'standard', onDensityChange, onAdd }: LibraryProps) {
  const [localDensity, setLocalDensity] = useState<CatalogDensity>(density);
  const effectiveDensity = onDensityChange ? density : localDensity;
  const [view, setView] = useState<LibraryViewState>(() => {
    const saved = loadView();
    if (entry === 'favorites') return { ...saved, mode: 'favorites' };
    if (entry === 'artists') return { ...saved, mode: 'all', sort: 'author' };
    return saved;
  });
  const [quickSongId, setStoredQuickSongId] = useState<string | null>(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const setQuickSongId = (songId: string | null) => {
    if (songId) setStoredQuickSongId(songId);
    setQuickActionsOpen(Boolean(songId));
  };
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [swipe, setSwipe] = useState<{ id: string; x: number; armed: boolean; phase: 'dragging' | 'settling' } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const virtualFrame = useRef<number | null>(null);
  const [virtualViewport, setVirtualViewport] = useState({ listTop: 0, width: 0, scrollY: 0, height: 800, columns: 1, textScale: 1 });
  const swipeStart = useRef<{ id: string; x: number; y: number; axis: 'pending' | 'x' | 'y'; lastX: number; lastTime: number; velocityX: number; armed: boolean } | null>(null);
  const swipeOffset = useRef<{ id: string; x: number; velocityX: number } | null>(null);
  const swipeSettleTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const searchWorkerRef = useRef<Worker | null>(null);
  const searchRequestRef = useRef(0);
  const [workerSearchIds, setWorkerSearchIds] = useState<Set<string> | null>(null);
  const deferredQuery = useDeferredValue(view.query);
  const shouldUseSearchWorker = typeof Worker !== 'undefined' && songs.length >= VIRTUALIZE_AFTER;
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);

  const updateView = <K extends keyof LibraryViewState>(key: K, value: LibraryViewState[K]) => setView((current) => ({ ...current, [key]: value }));
  const clearFilters = () => setView((current) => ({ ...initialView, query: current.query, mode: current.mode }));
  const changeDensity = (nextDensity: CatalogDensity) => {
    if (nextDensity === effectiveDensity) return;
    runElementTransition(listRef.current, () => {
      flushSync(() => {
        setLocalDensity(nextDensity);
        onDensityChange?.(nextDensity);
      });
    }, { name: 'catalog-density', duration: 260 });
    haptic('selection');
  };

  useEffect(() => {
    try { sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view)); } catch { /* Soukromý režim může sessionStorage blokovat. */ }
  }, [view]);

  useEffect(() => () => {
    if (swipeSettleTimer.current !== null) window.clearTimeout(swipeSettleTimer.current);
  }, []);

  useEffect(() => {
    const update = () => setShowBackToTop(window.scrollY > 700);
    window.addEventListener('scroll', update, { passive: true });
    update();
    return () => window.removeEventListener('scroll', update);
  }, []);

  useEffect(() => {
    if (!quickSongId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setQuickSongId(null);
      setConfirmDelete(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [quickSongId]);

  const options = useMemo(() => ({
    keys: [...new Set(songs.map((song) => song.originalKey ? displaySongKey(song.originalKey) : null).filter(Boolean))] as string[],
    languages: [...new Set(songs.map((song) => song.language))],
    categories: [...new Set(songs.flatMap((song) => song.categories))],
    instruments: [...new Set(songs.flatMap((song) => song.scoreAssets.map((asset) => asset.instrument)))],
    letters: [...new Set(songs.map(firstLetter))].sort((left, right) => left.localeCompare(right, 'cs')),
  }), [songs]);

  const searchDocuments = useMemo(() => createLibrarySearchDocuments(songs), [songs]);
  const synchronousSearchIds = useMemo(() => shouldUseSearchWorker ? null : new Set(searchLibraryDocuments(searchDocuments, deferredQuery)), [deferredQuery, searchDocuments, shouldUseSearchWorker]);
  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);


  const filtered = useMemo(() => {
    const needle = normalize(deferredQuery.trim());
    const base = view.mode === 'favorites'
      ? songs.filter((song) => favoriteIds.has(song.id))
      : view.mode === 'recent'
        ? recent.map((id) => songById.get(id)).filter((song): song is Song => Boolean(song))
        : songs;
    const matches = base.filter((song) => {
      const matchesSearch = !needle || (workerSearchIds ?? synchronousSearchIds ?? EMPTY_SEARCH_RESULTS).has(song.id);
      return matchesSearch
        && (!view.letter || firstLetter(song) === view.letter)
        && (!view.key || displaySongKey(song.originalKey) === view.key)
        && (!view.difficulty || song.difficulty === view.difficulty)
        && (!view.language || song.language === view.language)
        && (!view.category || song.categories.includes(view.category))
        && (!view.scoreAvailability || (view.scoreAvailability === 'yes' ? song.scoreAssets.length > 0 : song.scoreAssets.length === 0))
        && (!view.instrument || song.scoreAssets.some((asset) => asset.instrument === view.instrument));
    });
    const recentOrder = new Map(recent.map((id, index) => [id, index]));
    return [...matches].sort((left, right) => {
      if (view.sort === 'author') return (left.authors[0] ?? '').localeCompare(right.authors[0] ?? '', 'cs') || left.sortTitle.localeCompare(right.sortTitle, 'cs');
      if (view.sort === 'recent') return (recentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (recentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.sortTitle.localeCompare(right.sortTitle, 'cs');
      return left.sortTitle.localeCompare(right.sortTitle, 'cs');
    });
  }, [deferredQuery, favoriteIds, recent, songById, songs, synchronousSearchIds, view, workerSearchIds]);

  useEffect(() => {
    if (!shouldUseSearchWorker) return;
    const worker = new Worker(new URL('../workers/librarySearch.worker.ts', import.meta.url), { type: 'module' });
    searchWorkerRef.current = worker;
    worker.postMessage({ type: 'index', documents: searchDocuments });
    worker.addEventListener('message', (event: MessageEvent<{ type: 'result'; requestId: number; ids: string[] }>) => {
      if (event.data.type !== 'result' || event.data.requestId !== searchRequestRef.current) return;
      setWorkerSearchIds(new Set(event.data.ids));
    });
    return () => {
      worker.terminate();
      searchWorkerRef.current = null;
    };
  }, [searchDocuments, shouldUseSearchWorker]);

  useEffect(() => {
    const query = deferredQuery.trim();
    let active = true;
    if (!query) {
      void Promise.resolve().then(() => { if (active) setWorkerSearchIds(null); });
      return () => { active = false; };
    }
    const worker = searchWorkerRef.current;
    if (!shouldUseSearchWorker || !worker) {
      void Promise.resolve().then(() => { if (active) setWorkerSearchIds(new Set(searchLibraryDocuments(searchDocuments, query))); });
      return () => { active = false; };
    }
    const requestId = ++searchRequestRef.current;
    void Promise.resolve().then(() => { if (active) setWorkerSearchIds(null); });
    worker.postMessage({ type: 'search', requestId, query });
    return () => { active = false; };
  }, [deferredQuery, searchDocuments, shouldUseSearchWorker]);

  const virtualized = filtered.length > VIRTUALIZE_AFTER && virtualViewport.textScale <= 1.25;
  const rowHeight = effectiveDensity === 'compact' ? 72 : effectiveDensity === 'stage' ? 144 : 80;
  const rowGap = effectiveDensity === 'stage' ? 8 : 0;
  const rowStride = rowHeight + rowGap + 1;
  const totalRows = Math.ceil(filtered.length / virtualViewport.columns);
  const relativeTop = Math.max(0, virtualViewport.scrollY - virtualViewport.listTop);
  const startRow = virtualized ? Math.max(0, Math.floor(relativeTop / rowStride) - VIRTUAL_OVERSCAN_ROWS) : 0;
  const endRow = virtualized
    ? Math.min(totalRows, Math.ceil((relativeTop + virtualViewport.height) / rowStride) + VIRTUAL_OVERSCAN_ROWS)
    : totalRows;
  const startIndex = startRow * virtualViewport.columns;
  const endIndex = Math.min(filtered.length, endRow * virtualViewport.columns);
  const visibleSongs = filtered.slice(startIndex, endIndex);
  const topSpacer = virtualized ? startRow * rowStride : 0;
  const bottomSpacer = virtualized ? Math.max(0, (totalRows - endRow) * rowStride) : 0;
  const activeFilterCount = [view.letter, view.key, view.difficulty, view.language, view.category, view.scoreAvailability, view.instrument].filter(Boolean).length;
  const quickSong = quickSongId ? songById.get(quickSongId) : undefined;
  const visibleQuickSong = quickSong;
  const activeFilters = [
    view.letter && { key: 'letter' as const, label: `Písmeno ${view.letter}` },
    view.key && { key: 'key' as const, label: `Tónina ${view.key}` },
    view.difficulty && { key: 'difficulty' as const, label: `Obtížnost: ${{ easy: 'snadná', medium: 'střední', hard: 'těžká', unknown: 'neuvedená' }[view.difficulty] ?? view.difficulty}` },
    view.language && { key: 'language' as const, label: view.language },
    view.category && { key: 'category' as const, label: view.category },
    view.scoreAvailability && { key: 'scoreAvailability' as const, label: view.scoreAvailability === 'yes' ? 'Má noty' : 'Bez not' },
    view.instrument && { key: 'instrument' as const, label: view.instrument },
  ].filter(Boolean) as Array<{ key: keyof LibraryViewState; label: string }>;

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const startLongPress = (id: string) => {
    cancelLongPress();
    longPressTriggered.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      haptic('selection');
      setQuickSongId(id);
    }, 550);
  };

  const openFromCard = (id: string, sharedSource?: HTMLElement | null) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    onOpenSong(id, sharedSource);
  };

  const startSwipe = (id: string, x: number, y: number, timestamp: number) => {
    if (swipeSettleTimer.current !== null) window.clearTimeout(swipeSettleTimer.current);
    swipeStart.current = { id, x, y, axis: 'pending', lastX: x, lastTime: timestamp, velocityX: 0, armed: false };
    swipeOffset.current = { id, x: 0, velocityX: 0 };
    startLongPress(id);
  };

  const moveSwipe = (id: string, x: number, y: number, timestamp: number) => {
    const start = swipeStart.current;
    if (!start || start.id !== id) return;
    const deltaX = x - start.x;
    const deltaY = y - start.y;
    if (start.axis === 'pending') {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 9) return;
      start.axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.25 ? 'x' : 'y';
    }
    if (start.axis === 'y') {
      cancelLongPress();
      return;
    }
    cancelLongPress();
    const absoluteX = Math.abs(deltaX);
    const resistedX = absoluteX <= SWIPE_ACTION_WIDTH ? absoluteX : SWIPE_ACTION_WIDTH + (absoluteX - SWIPE_ACTION_WIDTH) * 0.18;
    const constrainedX = Math.sign(deltaX) * Math.min(SWIPE_ACTION_WIDTH + 22, resistedX);
    const elapsed = Math.max(1, timestamp - start.lastTime);
    start.velocityX = (x - start.lastX) / elapsed;
    start.lastX = x;
    start.lastTime = timestamp;
    const armed = Math.abs(constrainedX) >= SWIPE_ACTION_THRESHOLD;
    if (armed && !start.armed) haptic('selection');
    start.armed = armed;
    swipeOffset.current = { id, x: constrainedX, velocityX: start.velocityX };
    setSwipe({ id, x: constrainedX, armed, phase: 'dragging' });
  };

  const finishSwipe = (id: string) => {
    cancelLongPress();
    const offset = swipeOffset.current?.id === id ? swipeOffset.current.x : 0;
    const velocity = swipeOffset.current?.id === id ? swipeOffset.current.velocityX : 0;
    swipeStart.current = null;
    swipeOffset.current = null;
    if (Math.abs(offset) > 10) longPressTriggered.current = true;
    const direction = Math.sign(Math.abs(offset) > 8 ? offset : velocity);
    const committed = direction !== 0 && (Math.abs(offset) >= SWIPE_ACTION_THRESHOLD || (Math.abs(offset) >= 28 && Math.abs(velocity) >= 0.45));
    setSwipe({ id, x: committed ? direction * SWIPE_ACTION_WIDTH : 0, armed: committed, phase: 'settling' });
    swipeSettleTimer.current = window.setTimeout(() => {
      setSwipe((current) => current?.id === id ? null : current);
      if (!committed) return;
      longPressTriggered.current = true;
      if (direction > 0) {
        haptic('success');
        onAddToTonight?.(id);
      } else {
        haptic('selection');
        setQuickSongId(id);
      }
    }, committed ? 130 : 210);
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      if (virtualFrame.current !== null) cancelAnimationFrame(virtualFrame.current);
      virtualFrame.current = requestAnimationFrame(() => {
        const rect = list.getBoundingClientRect();
        const template = getComputedStyle(list).gridTemplateColumns;
        const columns = effectiveDensity === 'compact' || !template || template === 'none'
          ? 1
          : Math.max(1, template.split(/\s+/).filter(Boolean).length);
        setVirtualViewport((current) => {
          const next = { listTop: rect.top + window.scrollY, width: rect.width, scrollY: window.scrollY, height: window.innerHeight, columns, textScale: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 };
          return current.listTop === next.listTop && current.width === next.width && current.scrollY === next.scrollY && current.height === next.height && current.columns === next.columns && current.textScale === next.textScale ? current : next;
        });
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(list);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      if (virtualFrame.current !== null) cancelAnimationFrame(virtualFrame.current);
    };
  }, [effectiveDensity, filtered.length]);

  return (
    <section className="library" aria-labelledby="library-heading">
      <div className="page-heading"><div className="heading-title"><h1 id="library-heading">Písně</h1><span className="heading-count" aria-label="Počet výsledků">{formatCount(filtered.length)}</span></div>{onAdd && <button type="button" className="icon-button" aria-label="Přidat píseň nebo importovat" onClick={onAdd}><Icon name="plus" /></button>}</div>
      <SearchField value={view.query} onChange={(query) => updateView('query', query)} />
      <div className="quick-filter-pills" aria-label="Rychlé filtry">
        <button type="button" className={view.mode === 'all' ? 'active' : ''} aria-pressed={view.mode === 'all'} onClick={() => updateView('mode', 'all')}>Všechny</button>
        <button type="button" className={view.mode === 'favorites' ? 'active' : ''} aria-pressed={view.mode === 'favorites'} onClick={() => updateView('mode', view.mode === 'favorites' ? 'all' : 'favorites')}>Oblíbené</button>
        <button type="button" className={activeFilterCount || filtersOpen ? 'active' : ''} onClick={() => setFiltersOpen(true)}><Icon name="settings" size={16} />Filtry{activeFilterCount > 0 && ' (' + activeFilterCount + ')'}</button>
      </div>
      {activeFilters.length > 0 && <div className="active-filter-chips" aria-label="Aktivní filtry">{activeFilters.map((filter) => <button type="button" key={filter.key} onClick={() => updateView(filter.key, '' as never)} aria-label={'Odebrat filtr ' + filter.label}>{filter.label}<span aria-hidden="true">×</span></button>)}<button type="button" onClick={clearFilters}>Zrušit vše</button></div>}
      <Dialog open={filtersOpen} title="Filtry a zobrazení" onClose={() => setFiltersOpen(false)}>
        <label>Sbírka<select value={view.mode} onChange={(event) => updateView('mode', event.target.value as CollectionMode)}><option value="all">Všechny písně</option><option value="favorites">Oblíbené</option><option value="recent">Naposledy otevřené</option></select></label>
        <div className="filter-grid">
          <label>Tónina<select value={view.key} onChange={(event) => updateView('key', event.target.value)}><option value="">Všechny</option>{options.keys.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Obtížnost<select value={view.difficulty} onChange={(event) => updateView('difficulty', event.target.value)}><option value="">Všechny</option><option value="easy">Snadná</option><option value="medium">Střední</option><option value="hard">Těžká</option><option value="unknown">Neuvedená</option></select></label>
          <label>Jazyk<select value={view.language} onChange={(event) => updateView('language', event.target.value)}><option value="">Všechny</option>{options.languages.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Typ písně<select value={view.category} onChange={(event) => updateView('category', event.target.value)}><option value="">Všechny</option>{options.categories.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Dostupnost not<select value={view.scoreAvailability} onChange={(event) => updateView('scoreAvailability', event.target.value)}><option value="">Nerozhoduje</option><option value="yes">Má noty</option><option value="no">Bez not</option></select></label>
          <label>Nástroj<select value={view.instrument} onChange={(event) => updateView('instrument', event.target.value)}><option value="">Všechny</option>{options.instruments.map((value) => <option key={value}>{value}</option>)}</select></label>
          {activeFilterCount > 0 && <button type="button" className="secondary-button" onClick={clearFilters}>Zrušit všechny filtry</button>}
        </div>
<div className="library-view-controls"><label><span className="visually-hidden">Řazení písní</span><select value={view.sort} onChange={(event) => updateView('sort', event.target.value as LibraryViewState['sort'])}><option value="title">Podle názvu</option><option value="author">Podle autora</option><option value="recent">Naposledy otevřené</option></select></label><div className="library-density-control" data-density={effectiveDensity} role="group" aria-label="Hustota zobrazení katalogu"><span className="library-density-indicator" aria-hidden="true" /><button type="button" className={effectiveDensity === 'stage' ? 'active' : ''} aria-pressed={effectiveDensity === 'stage'} aria-label="Karty" title="Velké karty pro pódium" onClick={() => changeDensity('stage')}><Icon name="grid" /></button><button type="button" className={effectiveDensity === 'standard' ? 'active' : ''} aria-pressed={effectiveDensity === 'standard'} aria-label="Běžné zobrazení" title="Běžné zobrazení" onClick={() => changeDensity('standard')}><Icon name="music" /></button><button type="button" className={effectiveDensity === 'compact' ? 'active' : ''} aria-pressed={effectiveDensity === 'compact'} aria-label="Kompaktní seznam" title="Kompaktní seznam pro rychlé hledání" onClick={() => changeDensity('compact')}><Icon name="list" /></button></div></div>
        <details><summary>Abecední index</summary><div className="alphabet-filter" aria-label="Rychlý výběr podle prvního písmene"><button type="button" aria-pressed={!view.letter} onClick={() => updateView('letter', '')}>Vše</button>{options.letters.map((letter) => <button type="button" aria-pressed={view.letter === letter} onClick={() => updateView('letter', letter)} key={letter}>{letter}</button>)}</div></details>
        <dl className="library-counts"><div><dt>Katalog v tomto pohledu</dt><dd>{formatCount(songs.length)}</dd></div><div><dt>Staženo z členské knihovny</dt><dd>{formatCount(deviceSongCount)}</dd></div><div><dt>Osobní koncepty</dt><dd>{formatCount(songs.filter((song) => song.personalOnly && !isDownloadedLibrarySong(song)).length)}</dd></div>{personalSummary && <div><dt>Vývojový import</dt><dd>{formatCount(personalSummary.songCount)}</dd></div>}</dl>
        <details><summary>Akce a gesta</summary><p>Nabídka u každé písně umožňuje přidání do oblíbených a setlistu. Na telefonu lze také přejet doprava pro dnešní setlist nebo doleva pro nabídku.</p></details>
        <button type="button" className="primary-button" onClick={() => setFiltersOpen(false)}>Zobrazit výsledky ({formatCount(filtered.length)})</button>
      </Dialog>
      {deferredQuery !== view.query && <div className="catalog-skeleton" role="status" aria-label="Hledám v katalogu"><span /><span /><span /></div>}
      <div ref={listRef} className={`song-list song-list--${effectiveDensity}${effectiveDensity === 'stage' ? ' song-list--cards' : ''}${virtualized ? ' song-list--virtualized' : ''}`} aria-busy={deferredQuery !== view.query}>
        {topSpacer > 0 && <div className="virtual-song-spacer" aria-hidden="true" style={{ height: topSpacer }} />}
        {visibleSongs.map((song) => <article className={`song-card-shell${swipe?.id === song.id && swipe.phase === 'dragging' ? ' song-card-shell--dragging' : ''}${swipe?.id === song.id && swipe.phase === 'settling' ? ' song-card-shell--settling' : ''}${swipe?.id === song.id && swipe.armed ? ' song-card-shell--armed' : ''}`} key={song.id} onPointerDown={(event) => { if (event.pointerType === 'touch') { try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Safari může převzít svislý posun. */ } startSwipe(song.id, event.clientX, event.clientY, event.timeStamp); } else startLongPress(song.id); }} onPointerUp={() => finishSwipe(song.id)} onPointerCancel={() => { cancelLongPress(); swipeStart.current = null; swipeOffset.current = null; setSwipe((current) => current?.id === song.id ? { ...current, x: 0, armed: false, phase: 'settling' } : current); if (swipeSettleTimer.current !== null) window.clearTimeout(swipeSettleTimer.current); swipeSettleTimer.current = window.setTimeout(() => setSwipe((current) => current?.id === song.id ? null : current), 210); }} onPointerMove={(event) => { if (event.pointerType === 'touch') moveSwipe(song.id, event.clientX, event.clientY, event.timeStamp); else cancelLongPress(); }} onContextMenu={(event) => { event.preventDefault(); setQuickSongId(song.id); }}><span className="swipe-action swipe-action--right" aria-hidden="true"><Icon name={swipe?.id === song.id && swipe.armed && swipe.x > 0 ? 'check' : 'plus'} size={18} />Dnešní setlist</span><span className="swipe-action swipe-action--left" aria-hidden="true"><Icon name={swipe?.id === song.id && swipe.armed && swipe.x < 0 ? 'check' : 'menu'} size={18} />Akce</span><div className="song-card-motion" style={{ transform: swipe?.id === song.id ? `translate3d(${swipe.x}px, 0, 0)` : undefined }}><button type="button" className="song-card song-card__open" onClick={(event) => openFromCard(song.id, event.currentTarget.querySelector<HTMLElement>('.song-card__main > strong'))}><span className="song-card__main"><strong>{song.title}</strong><span>{song.authors.join(', ') || 'Autor neuveden'}</span>{song.personalOnly && reviewCount(song) > 0 && <span className="song-card__labels"><span>Ke kontrole · {reviewCount(song)}</span></span>}</span><span className="song-card__meta"><strong className="song-key" aria-label={`Tónina ${song.originalKey ? displaySongKey(song.originalKey) : 'neuvedena'}`}>{displaySongKey(song.originalKey)}</strong>{song.chordProPath.startsWith('indexeddb:') && <Icon name="download" size={17} className="offline-song-badge" />}{song.scoreAssets.length > 0 && <Icon name="music" size={17} />}{favoriteIds.has(song.id) && <Icon name="star" size={17} />}</span></button><button type="button" className="song-quick-button" aria-label={'Rychlé akce pro ' + song.title} title={`Rychlé akce pro ${song.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => setQuickSongId(song.id)}><Icon name="menu" size={19} /></button></div></article>)}
        {filtered.length === 0 && <EmptyState icon="search" title="Žádná píseň neodpovídá výběru" description="Zkuste kratší výraz nebo zrušte některý z aktivních filtrů." action={<button type="button" className="secondary-button" onClick={() => setView(initialView)}>Zrušit hledání a filtry</button>} />}
        {bottomSpacer > 0 && <div className="virtual-song-spacer" aria-hidden="true" style={{ height: bottomSpacer }} />}
      </div>
      {showBackToTop && <button type="button" className="back-to-top" aria-label="Zpět nahoru" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>}
      <Dialog open={quickActionsOpen && Boolean(visibleQuickSong)} title={visibleQuickSong?.title ?? 'Rychlé akce'} onClose={() => { setQuickSongId(null); setConfirmDelete(false); }}>
        {visibleQuickSong && <>{confirmDelete ? <div className="quick-delete-confirm"><p>Odstranit tuto uloženou píseň z tohoto zařízení?</p><button type="button" className="danger-button" onClick={() => void onDeleteSong?.(visibleQuickSong.id).then(() => { onNotify?.('Píseň byla odstraněna z tohoto zařízení.'); setQuickSongId(null); setConfirmDelete(false); })}>Ano, odstranit</button><button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Zrušit</button></div> : <><button type="button" className="secondary-button" onClick={() => { onToggleFavorite?.(visibleQuickSong.id); onNotify?.(favoriteIds.has(visibleQuickSong.id) ? 'Píseň byla odebrána z oblíbených.' : 'Píseň byla přidána do oblíbených.'); setQuickSongId(null); }}>{favoriteIds.has(visibleQuickSong.id) ? '☆ Odebrat z oblíbených' : '★ Přidat do oblíbených'}</button>{setlists.length > 0 && <label>Přidat do setlistu<select defaultValue="" onChange={(event) => { if (!event.target.value) return; onAddToSetlist?.(visibleQuickSong.id, event.target.value); setQuickSongId(null); }}><option value="" disabled>Vyberte setlist…</option>{setlists.map((setlist) => <option key={setlist.id} value={setlist.id} disabled={setlist.songIds.includes(visibleQuickSong.id)}>{setlist.name}{setlist.songIds.includes(visibleQuickSong.id) ? ' · již obsahuje' : ''}</option>)}</select></label>}<button type="button" className="primary-button" onClick={() => { setQuickSongId(null); onOpenSong(visibleQuickSong.id); }}>Otevřít píseň</button>{visibleQuickSong.chordProPath.startsWith('indexeddb:') && onDeleteSong && <button type="button" className="danger-button" onClick={() => setConfirmDelete(true)}>Odstranit z tohoto zařízení</button>}<small>{visibleQuickSong.chordProPath.startsWith('indexeddb:') ? 'Píseň je uložená offline v tomto zařízení.' : 'Offline dostupnost lze spravovat v části Offline.'}</small></>}</>}
      </Dialog>
    </section>
  );
}
