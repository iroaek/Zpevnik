import { useState } from 'react';
import type { PublicSetlist, Song } from '../domain/song';
import { fetchContent } from '../pwa/contentCache';
import { createSetlist, updateSetlistSongs, type UserState } from '../storage/database';
import { ChordSheet } from './ChordSheet';

interface SetlistsProps {
  songs: Song[];
  userState: UserState;
  onUserStateChange: React.Dispatch<React.SetStateAction<UserState>>;
  onOpenSong: (id: string) => void;
  publicSetlists: PublicSetlist[];
  onOpenPublicSetlist: (id: string) => void;
  catalogVersion: string;
}

export function Setlists({ songs, userState, onUserStateChange, onOpenSong, publicSetlists, onOpenPublicSetlist, catalogVersion }: SetlistsProps) {
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState(userState.setlists[0]?.id ?? '');
  const [printSources, setPrintSources] = useState<Record<string, string>>({});
  const [printMode, setPrintMode] = useState(false);
  const effectiveSelectedId = selectedId || userState.setlists[0]?.id || '';
  const selected = userState.setlists.find((setlist) => setlist.id === effectiveSelectedId);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onUserStateChange((current) => createSetlist(current, name));
    setName('');
  };

  const move = (index: number, direction: -1 | 1) => {
    if (!selected) return;
    const next = [...selected.songIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onUserStateChange((current) => updateSetlistSongs(current, selected.id, next));
  };

  const remove = (songId: string) => {
    if (!selected) return;
    onUserStateChange((current) => updateSetlistSongs(current, selected.id, selected.songIds.filter((id) => id !== songId)));
  };

  const preparePrint = async () => {
    if (!selected) return;
    const entries = await Promise.all(selected.songIds.map(async (id) => {
      const song = songs.find((candidate) => candidate.id === id);
      if (!song) return [id, ''] as const;
      try {
        const response = await fetchContent(song.chordProPath, 'songs', catalogVersion);
        return [id, response.ok ? await response.text() : ''] as const;
      } catch {
        return [id, ''] as const;
      }
    }));
    setPrintSources(Object.fromEntries(entries));
    setPrintMode(true);
  };

  return (
    <section className="setlists-page" aria-labelledby="setlists-heading">
      <div className="section-heading"><div><p className="eyebrow">Pořadí na večer</p><h1 id="setlists-heading">Setlisty</h1></div></div>
      {publicSetlists.length > 0 && <section className="public-setlists" aria-labelledby="public-setlists-heading"><div className="results-heading"><h2 id="public-setlists-heading">Veřejné setlisty</h2><span>Mají vlastní QR odkaz</span></div>{publicSetlists.map((setlist) => <button type="button" className="song-card" onClick={() => onOpenPublicSetlist(setlist.id)} key={setlist.id}><span className="song-card__main"><strong>{setlist.title}</strong><span>{setlist.description}</span></span><span className="song-card__meta">{setlist.songIds.length} ♫ <span aria-hidden="true">›</span></span></button>)}</section>}
      <div className="results-heading private-heading"><h2>Moje soukromé setlisty</h2><span>Jen v tomto zařízení</span></div>
      <form className="new-setlist" onSubmit={submit}><label>Název nového setlistu<input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Např. Sobota u ohně" /></label><button className="primary-button" type="submit">Vytvořit</button></form>
      {userState.setlists.length === 0 ? <p className="empty-state">Zatím nemáte žádný setlist.</p> : (
        <>
          <div className="setlist-tabs" role="tablist" aria-label="Setlisty">{userState.setlists.map((setlist) => <button type="button" role="tab" aria-selected={setlist.id === effectiveSelectedId} className={setlist.id === effectiveSelectedId ? 'chip chip--active' : 'chip'} onClick={() => { setSelectedId(setlist.id); setPrintMode(false); }} key={setlist.id}>{setlist.name}</button>)}</div>
          {selected && <div className="setlist-detail">
            <div className="results-heading"><h2>{selected.name}</h2><button type="button" className="secondary-button" disabled={selected.songIds.length === 0} onClick={preparePrint}>Náhled a tisk</button></div>
            {selected.songIds.map((songId, index) => {
              const song = songs.find((candidate) => candidate.id === songId);
              if (!song) return null;
              return <div className="setlist-row" key={`${songId}-${index}`}><span className="order-number">{index + 1}</span><button className="setlist-song" type="button" onClick={() => onOpenSong(songId)}>{song.title}</button><button type="button" className="icon-button" aria-label={`Posunout ${song.title} nahoru`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" className="icon-button" aria-label={`Posunout ${song.title} dolů`} disabled={index === selected.songIds.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" className="icon-button" aria-label={`Odebrat ${song.title}`} onClick={() => remove(songId)}>×</button></div>;
            })}
            {selected.songIds.length === 0 && <p className="empty-state">Písně přidáte z detailu skladby.</p>}
          </div>}
        </>
      )}
      {printMode && selected && <section className="setlist-print" aria-label="Tiskový náhled setlistu"><div className="print-preview-actions"><h2>Tiskový náhled: {selected.name}</h2><button type="button" className="primary-button" onClick={() => window.print()}>Vytisknout celý setlist</button><button type="button" className="secondary-button" onClick={() => setPrintMode(false)}>Zavřít náhled</button></div>{selected.songIds.map((id) => { const song = songs.find((candidate) => candidate.id === id); return song ? <article className="print-song" key={id}><h1>{song.title}</h1><p>{song.authors.join(', ')}</p>{printSources[id] ? <ChordSheet source={printSources[id]} notation={userState.settings.notation} fontSize={18} /> : <p>Obsah se nepodařilo načíst.</p>}</article> : null; })}</section>}
    </section>
  );
}
