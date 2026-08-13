import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteSharedSetlist,
  loadSharedSetlists,
  publishMySetlist,
  updateSharedSetlist,
  updateSharedSetlistLiveSong,
  type SecureProfile,
  type SharedSetlist,
} from '../auth/secureAccess';
import { createUuid } from '../domain/browserCompatibility';
import { isPublishable, type Song } from '../domain/song';
import type { Setlist } from '../storage/database';
import { friendlyError } from '../ui/friendlyError';

interface SharedSetlistsProps {
  songs: Song[];
  profile: SecureProfile | null;
  online: boolean;
  selectedLocal?: Setlist;
  onOpenSong: (id: string, sequence?: string[]) => void;
  onCopyToMySetlists: (name: string, songIds: string[]) => void;
  followedLiveSetlistId?: string;
  onFollowLive?: (setlistId: string) => void;
}

const SHARED_SETLIST_CACHE_KEY = 'zpevnik-shared-setlists-cache-v1';

function loadCachedSharedSetlists(): SharedSetlist[] {
  try {
    const cached = JSON.parse(localStorage.getItem(SHARED_SETLIST_CACHE_KEY) ?? '[]') as unknown;
    return Array.isArray(cached) ? cached as SharedSetlist[] : [];
  } catch {
    return [];
  }
}

function normalizedSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').trim();
}

export function SharedSetlists({
  songs,
  profile,
  online,
  selectedLocal,
  onOpenSong,
  onCopyToMySetlists,
  followedLiveSetlistId = '',
  onFollowLive = () => undefined,
}: SharedSetlistsProps) {
  const [records, setRecords] = useState<SharedSetlist[]>(loadCachedSharedSetlists);
  const [selectedSharedId, setSelectedSharedId] = useState(() => loadCachedSharedSetlists()[0]?.id ?? '');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftSongIds, setDraftSongIds] = useState<string[]>([]);
  const [songQuery, setSongQuery] = useState('');
  const approved = profile?.status === 'approved';
  const songsById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const shareableSongs = useMemo(() => songs.filter(isPublishable), [songs]);
  const shareableSongIds = useMemo(() => new Set(shareableSongs.map((song) => song.id)), [shareableSongs]);
  const selectedShared = records.find((record) => record.id === selectedSharedId) ?? records[0];
  const existingShare = selectedLocal && profile
    ? records.find((record) => record.owner_id === profile.id && record.source_setlist_id === selectedLocal.id)
    : undefined;
  const selectedLocalShareableIds = selectedLocal?.songIds.filter((id) => shareableSongIds.has(id)) ?? [];
  const canManageSelected = Boolean(selectedShared && profile
    && (selectedShared.owner_id === profile.id || profile.role === 'admin'));
  const missingSongCount = selectedShared
    ? selectedShared.song_ids.filter((id) => !songsById.has(id)).length
    : 0;

  const refresh = useCallback(async (preferredId = '', silent = false) => {
    if (!approved || !online) return;
    if (!silent) {
      setBusy('loading');
      setError('');
    }
    try {
      const next = await loadSharedSetlists();
      setRecords(next);
      try { localStorage.setItem(SHARED_SETLIST_CACHE_KEY, JSON.stringify(next)); } catch { /* Cache je jen offline fallback. */ }
      setSelectedSharedId((current) => preferredId || (next.some((record) => record.id === current) ? current : next[0]?.id ?? ''));
    } catch (caught) {
      if (!silent) setError(friendlyError(caught, 'Sdílené setlisty se nepodařilo načíst.'));
    } finally {
      if (!silent) setBusy('');
    }
  }, [approved, online]);

  useEffect(() => {
    if (!approved || !online) return;
    const refreshTimer = window.setTimeout(() => void refresh(), 0);
    const pollingTimer = window.setInterval(() => void refresh('', true), 5_000);
    return () => { window.clearTimeout(refreshTimer); window.clearInterval(pollingTimer); };
  }, [approved, online, refresh]);

  const publishSelected = async () => {
    if (!selectedLocal || !profile || selectedLocalShareableIds.length === 0) return;
    setBusy('publish');
    setError('');
    setMessage('');
    try {
      const id = await publishMySetlist({
        id: existingShare?.id ?? createUuid(),
        sourceSetlistId: selectedLocal.id,
        name: selectedLocal.name,
        songIds: selectedLocalShareableIds,
      });
      await refresh(id);
      const excluded = selectedLocal.songIds.length - selectedLocalShareableIds.length;
      setMessage(existingShare
        ? `Sdílený setlist byl aktualizován.${excluded ? ` ${excluded} neveřejných položek zůstalo jen u vás.` : ''}`
        : `Setlist nyní vidí všichni schválení členové.${excluded ? ` ${excluded} neveřejných položek zůstalo jen u vás.` : ''}`);
    } catch (caught) {
      setError(friendlyError(caught, 'Setlist se nepodařilo sdílet.'));
    } finally {
      setBusy('');
    }
  };

  const startEditing = () => {
    if (!selectedShared) return;
    setDraftName(selectedShared.name);
    setDraftSongIds(selectedShared.song_ids.filter((id) => shareableSongIds.has(id)));
    setSongQuery('');
    setConfirmDelete(false);
    setEditing(true);
  };

  const moveDraftSong = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= draftSongIds.length) return;
    setDraftSongIds((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveSharedChanges = async () => {
    if (!selectedShared || !draftName.trim() || draftSongIds.length === 0) return;
    setBusy('save');
    setError('');
    try {
      const latestRecords = await loadSharedSetlists();
      const latestSelected = latestRecords.find((record) => record.id === selectedShared.id);
      if (!latestSelected) {
        setRecords(latestRecords);
        setEditing(false);
        setError('Tento setlist už mezitím není sdílený. Seznam byl obnoven.');
        return;
      }
      if (latestSelected.updated_at !== selectedShared.updated_at) {
        setRecords(latestRecords);
        setSelectedSharedId(latestSelected.id);
        setDraftName(latestSelected.name);
        setDraftSongIds(latestSelected.song_ids.filter((id) => shareableSongIds.has(id)));
        setError('Setlist mezitím upravil jiný člen. Načetli jsme jeho novější verzi; zkontrolujte změny a upravte ji znovu.');
        return;
      }
      await updateSharedSetlist(selectedShared.id, draftName, draftSongIds);
      setEditing(false);
      await refresh(selectedShared.id);
      setMessage(profile?.role === 'admin' && selectedShared.owner_id !== profile.id
        ? 'Administrátorská úprava sdíleného setlistu byla uložena.'
        : 'Sdílený setlist byl upraven.');
    } catch (caught) {
      setError(friendlyError(caught, 'Úpravy se nepodařilo uložit.'));
    } finally {
      setBusy('');
    }
  };

  const removeShared = async (record: SharedSetlist) => {
    setBusy('delete');
    setError('');
    try {
      await deleteSharedSetlist(record.id);
      setEditing(false);
      setConfirmDelete(false);
      await refresh();
      setMessage(record.owner_id === profile?.id ? 'Sdílení setlistu bylo zrušeno.' : 'Sdílený setlist byl administrátorem odstraněn.');
    } catch (caught) {
      setError(friendlyError(caught, 'Sdílený setlist se nepodařilo odstranit.'));
    } finally {
      setBusy('');
    }
  };

  const setLiveSong = async (record: SharedSetlist, songId: string | null) => {
    setBusy('live');
    setError('');
    try {
      await updateSharedSetlistLiveSong(record.id, songId);
      await refresh(record.id);
      setMessage(songId ? 'Aktuální píseň byla odeslána sledujícím členům.' : 'Živý režim byl ukončen.');
    } catch (caught) {
      setError(friendlyError(caught, 'Živý stav se nepodařilo změnit. Je možné, že serverová migrace ještě není nasazená.'));
    } finally {
      setBusy('');
    }
  };

  const addCandidates = useMemo(() => {
    const needle = normalizedSearch(songQuery);
    return shareableSongs.filter((song) => {
      if (draftSongIds.includes(song.id)) return false;
      return !needle || normalizedSearch(`${song.title} ${song.authors.join(' ')}`).includes(needle);
    }).slice(0, 30);
  }, [draftSongIds, shareableSongs, songQuery]);

  return <section className="shared-setlists" aria-labelledby="shared-setlists-heading">
    <header className="shared-setlists__header">
      <span><p className="eyebrow">Jen pro schválené účty</p><h2 id="shared-setlists-heading">Členské setlisty</h2><p>Setlist je viditelný pouze přihlášeným a schváleným členům. Texty písní se sem nekopírují.</p></span>
      {busy === 'loading' && <span className="loading-indicator" role="status"><i aria-hidden="true" />Načítám</span>}
    </header>

    {!approved && <p className="empty-state">Sdílení se zpřístupní po přihlášení a schválení účtu.</p>}
    {approved && !online && <p className="offline-note">Zobrazuje se poslední uložený stav sdílených setlistů. Nové změny a živé přepínání se obnoví po připojení; otevřená stažená píseň dál funguje offline.</p>}

    {approved && online && selectedLocal && <article className="share-current-card">
      <span><small>{existingShare ? 'Tento setlist je sdílený' : 'Sdílet vybraný setlist'}</small><strong>{selectedLocal.name}</strong><p>{selectedLocalShareableIds.length} členských písní{selectedLocal.songIds.length !== selectedLocalShareableIds.length ? ` · ${selectedLocal.songIds.length - selectedLocalShareableIds.length} neveřejných se nesdílí` : ''}</p></span>
      <div className="button-row"><button type="button" className="primary-button" disabled={Boolean(busy) || selectedLocalShareableIds.length === 0} onClick={() => void publishSelected()}>{busy === 'publish' ? 'Sdílím…' : existingShare ? 'Aktualizovat sdílenou verzi' : 'Sdílet členům'}</button>{existingShare && <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => { setSelectedSharedId(existingShare.id); setConfirmDelete(true); }}>Zrušit sdílení</button>}</div>
    </article>}

    {message && <p className="success-message" role="status">{message}</p>}
    {error && <p className="global-warning" role="alert">{error}</p>}

    {approved && online && !busy && records.length === 0 && <p className="empty-state">Zatím nikdo žádný setlist nesdílí.</p>}
    {records.length > 0 && <div className="shared-setlist-grid" role="list" aria-label="Sdílené setlisty">{records.map((record) => <button type="button" role="listitem" className={record.id === selectedShared?.id ? 'shared-setlist-card shared-setlist-card--active' : 'shared-setlist-card'} onClick={() => { setSelectedSharedId(record.id); setEditing(false); setConfirmDelete(false); }} key={record.id}><span><strong>{record.name}</strong><small>{record.owner_name}</small></span><span>{record.song_ids.length} ♫</span></button>)}</div>}

    {selectedShared && <article className="shared-setlist-detail">
      <header><span><p className="eyebrow">Sdílí {selectedShared.owner_name}</p><h3>{selectedShared.name}</h3><small>{selectedShared.song_ids.length} písní · aktualizováno {new Date(selectedShared.updated_at).toLocaleDateString('cs-CZ')}</small></span><span className="shared-setlist-statuses">{selectedShared.live_song_id && <span className="live-setlist-badge">● Živě</span>}{profile?.role === 'admin' && selectedShared.owner_id !== profile.id && <span className="admin-edit-badge">Správa administrátora</span>}</span></header>
      {missingSongCount > 0 && <p className="offline-note">{missingSongCount} písní z tohoto setlistu není ve vaší členské knihovně.</p>}
      <div className="button-row"><button type="button" className="primary-button" disabled={selectedShared.song_ids.every((id) => !songsById.has(id))} onClick={() => onCopyToMySetlists(selectedShared.name, selectedShared.song_ids.filter((id) => songsById.has(id)))}>Uložit kopii mezi moje setlisty</button>{selectedShared.live_song_id && <button type="button" className={followedLiveSetlistId === selectedShared.id ? 'secondary-button active' : 'secondary-button'} aria-pressed={followedLiveSetlistId === selectedShared.id} onClick={() => onFollowLive(selectedShared.id)}>{followedLiveSetlistId === selectedShared.id ? 'Sledujete živě' : 'Sledovat vedoucího'}</button>}{canManageSelected && <button type="button" className="secondary-button" onClick={startEditing}>Upravit sdílený setlist</button>}{canManageSelected && !selectedShared.live_song_id && <button type="button" className="secondary-button" disabled={!online || busy === 'live'} onClick={() => void setLiveSong(selectedShared, selectedShared.song_ids.find((id) => songsById.has(id)) ?? null)}>Spustit živý režim</button>}{canManageSelected && selectedShared.live_song_id && <button type="button" className="danger-button" disabled={!online || busy === 'live'} onClick={() => void setLiveSong(selectedShared, null)}>Ukončit živě</button>}</div>

      {!editing && <div className="shared-song-list">{selectedShared.song_ids.map((songId, index) => { const song = songsById.get(songId); const live = selectedShared.live_song_id === songId; return song ? <div className={live ? 'shared-live-song shared-live-song--current' : 'shared-live-song'} key={`${songId}-${index}`}><button type="button" onClick={() => onOpenSong(songId, selectedShared.song_ids)}><span className="order-number">{index + 1}</span><span><strong>{song.title}</strong><small>{song.authors.join(', ') || 'Autor neuveden'}{live ? ' · právě hraje' : ''}</small></span><span aria-hidden="true">›</span></button>{canManageSelected && selectedShared.live_song_id && <button type="button" className="live-song-send" disabled={!online || busy === 'live' || live} onClick={() => void setLiveSong(selectedShared, songId)}>{live ? 'Živě' : 'Vysílat'}</button>}</div> : null; })}</div>}

      {editing && <section className="shared-setlist-editor" aria-label="Úprava sdíleného setlistu">
        <label>Název sdíleného setlistu<input value={draftName} maxLength={100} onChange={(event) => setDraftName(event.target.value)} /></label>
        <div className="shared-song-list shared-song-list--editing">{draftSongIds.map((songId, index) => { const song = songsById.get(songId); return song ? <div key={`${songId}-${index}`}><span className="order-number">{index + 1}</span><strong>{song.title}</strong><button type="button" className="icon-button" aria-label={`Posunout ${song.title} nahoru`} disabled={index === 0} onClick={() => moveDraftSong(index, -1)}>↑</button><button type="button" className="icon-button" aria-label={`Posunout ${song.title} dolů`} disabled={index === draftSongIds.length - 1} onClick={() => moveDraftSong(index, 1)}>↓</button><button type="button" className="icon-button" aria-label={`Odebrat ${song.title}`} onClick={() => setDraftSongIds((current) => current.filter((_, songIndex) => songIndex !== index))}>×</button></div> : null; })}</div>
        <div className="shared-song-add"><label>Přidat další píseň<input type="search" value={songQuery} onChange={(event) => setSongQuery(event.target.value)} placeholder="Název nebo autor…" /></label>{songQuery.trim() && <div>{addCandidates.map((song) => <button type="button" className="secondary-button" onClick={() => { setDraftSongIds((current) => [...current, song.id]); setSongQuery(''); }} key={song.id}><span>{song.title}</span><small>{song.authors.join(', ')}</small></button>)}</div>}</div>
        <div className="button-row"><button type="button" className="primary-button" disabled={Boolean(busy) || !draftName.trim() || draftSongIds.length === 0} onClick={() => void saveSharedChanges()}>{busy === 'save' ? 'Ukládám…' : 'Uložit sdílené změny'}</button><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => setEditing(false)}>Zrušit úpravy</button><button type="button" className="danger-button" disabled={Boolean(busy)} onClick={() => setConfirmDelete(true)}>{selectedShared.owner_id === profile?.id ? 'Zrušit sdílení' : 'Odstranit sdílený setlist'}</button></div>
      </section>}

      {confirmDelete && canManageSelected && <div className="confirm-row" role="alert"><strong>{selectedShared.owner_id === profile?.id ? 'Opravdu zrušit sdílení?' : 'Opravdu administrátorsky odstranit tento setlist?'}</strong><span>Soukromá kopie vlastníka zůstane zachovaná.</span><div className="button-row"><button type="button" className="danger-button" disabled={Boolean(busy)} onClick={() => void removeShared(selectedShared)}>{busy === 'delete' ? 'Odstraňuji…' : 'Ano, odstranit sdílení'}</button><button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Zpět</button></div></div>}
    </article>}
  </section>;
}
