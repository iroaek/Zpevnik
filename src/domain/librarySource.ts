import type { Song } from './song';

export function isDownloadedLibrarySong(song: Song): boolean {
  return song.personalOnly === true
    && song.sourceIdentifier.replace(/\\/g, '/').startsWith('songs_data/');
}
