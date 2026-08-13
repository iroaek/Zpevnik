import type { Song } from './song';

export interface LibrarySearchDocument {
  id: string;
  text: string;
}

export function normalizeLibrarySearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createLibrarySearchDocuments(songs: Song[]): LibrarySearchDocument[] {
  return songs.map((song) => ({
    id: song.id,
    text: normalizeLibrarySearch([
      song.title,
      ...song.alternativeTitles,
      ...song.authors,
      song.firstLine,
      ...song.tags,
      ...song.categories,
      song.originalKey ?? '',
    ].join(' ')),
  }));
}

export function searchLibraryDocuments(documents: LibrarySearchDocument[], query: string): string[] {
  const words = normalizeLibrarySearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return documents.map((document) => document.id);
  return documents.filter((document) => words.every((word) => document.text.includes(word))).map((document) => document.id);
}
