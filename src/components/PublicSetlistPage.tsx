import { normalizeSharpSpelling } from '../domain/chords';
import type { PublicSetlist, Song } from '../domain/song';

export function PublicSetlistPage({ setlist, songs, onOpenSong, onBack }: { setlist: PublicSetlist; songs: Song[]; onOpenSong: (id: string) => void; onBack: () => void }) {
  return (
    <section className="public-setlist-page" aria-labelledby="public-setlist-heading">
      <button type="button" className="back-button" onClick={onBack}>‹ Zpět na setlisty</button>
      <p className="eyebrow">Veřejný setlist</p><h1 id="public-setlist-heading">{setlist.title}</h1><p className="lead">{setlist.description}</p>
      <div className="song-list">{setlist.songIds.map((songId, index) => { const song = songs.find((candidate) => candidate.id === songId); return song ? <button type="button" className="song-card" onClick={() => onOpenSong(song.id)} key={song.id}><span className="order-number">{index + 1}</span><span className="song-card__main"><strong>{song.title}</strong><span>{song.authors.join(', ') || 'Autor neuveden'}</span></span><span className="song-card__meta">{song.originalKey ? normalizeSharpSpelling(song.originalKey, 'czech') : '—'} <span aria-hidden="true">›</span></span></button> : null; })}</div>
      <footer className="rights-card"><strong>Původ veřejného setlistu</strong><span>{setlist.source}</span><span>{setlist.rightsStatus} · {setlist.license}</span><span>{setlist.attribution}</span></footer>
    </section>
  );
}
