import { getPersonalSongContent, loadContentPackage, loadPersonalSongs, removeDownloadedLibrarySongs } from '../storage/database';
import type { SongRepository } from './contracts';

export const localSongRepository: SongRepository = {
  async getLocalSongs(userId) {
    return loadPersonalSongs(userId);
  },
  async getLocalSong(id, userId) {
    return (await loadPersonalSongs(userId)).find((song) => song.id === id) ?? null;
  },
  async getLocalContentVersion(userId) {
    return (await loadContentPackage(userId))?.manifest.version ?? null;
  },
  async removeProtectedContent(userId) {
    return removeDownloadedLibrarySongs(userId);
  },
};

// Keep content access explicit so future SQLite adapters do not have to mimic
// IndexedDB URL conventions.
export async function getLocalSongText(songId: string): Promise<string | null> {
  return getPersonalSongContent(songId);
}
