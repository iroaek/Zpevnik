import { useEffect, useMemo, useRef, useState } from 'react';
import { loadSharedSetlists, type SecureProfile, type SharedSetlist } from '../auth/secureAccess';
import type { Song } from '../domain/song';
import { Icon } from '../ui/Icon';

const LIVE_CACHE_KEY = 'zpevnik-live-setlist-cache-v1';

function cacheLiveRecord(record: SharedSetlist): void {
  try { localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify(record)); } catch { /* Offline fallback je volitelný. */ }
}

function loadCachedLiveRecord(id: string): SharedSetlist | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY) ?? 'null') as SharedSetlist | null;
    return parsed?.id === id ? parsed : null;
  } catch {
    return null;
  }
}

export function LiveSetlistFollower({ setlistId, profile, online, songs, onOpenSong, onStop }: {
  setlistId: string;
  profile: SecureProfile | null;
  online: boolean;
  songs: Song[];
  onOpenSong: (id: string, sequence?: string[]) => void;
  onStop: () => void;
}) {
  const [record, setRecord] = useState<SharedSetlist | null>(() => loadCachedLiveRecord(setlistId));
  const [error, setError] = useState('');
  const lastOpenedSong = useRef(record?.live_song_id ?? '');
  const openRef = useRef(onOpenSong);
  const songIds = useMemo(() => new Set(songs.map((song) => song.id)), [songs]);

  useEffect(() => {
    openRef.current = onOpenSong;
  }, [onOpenSong]);

  useEffect(() => {
    if (!online || profile?.status !== 'approved') return;
    let active = true;
    const refresh = async () => {
      try {
        const next = (await loadSharedSetlists()).find((candidate) => candidate.id === setlistId) ?? null;
        if (!active) return;
        if (!next) {
          setError('Sledovaný setlist už není sdílený.');
          return;
        }
        setRecord(next);
        cacheLiveRecord(next);
        setError('');
        if (next.live_song_id && next.live_song_id !== lastOpenedSong.current && songIds.has(next.live_song_id)) {
          lastOpenedSong.current = next.live_song_id;
          openRef.current(next.live_song_id, next.song_ids);
        }
      } catch {
        if (active) setError('Živý stav se nyní nepodařilo obnovit. Poslední píseň zůstává otevřená offline.');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [online, profile?.status, setlistId, songIds]);

  return <aside className={`live-follow-banner ${online ? '' : 'live-follow-banner--offline'}`} role="status" aria-live="polite"><Icon name="music" /><span><small>{online ? 'Sledujete vedoucího' : 'Offline fallback'}</small><strong>{record?.name ?? 'Živý setlist'}</strong><em>{record?.live_song_id ? songs.find((song) => song.id === record.live_song_id)?.title ?? 'Aktuální píseň není stažená' : 'Čekám na spuštění písně'}</em>{error && <b>{error}</b>}</span><button type="button" className="secondary-button" onClick={onStop}>Přestat sledovat</button></aside>;
}
