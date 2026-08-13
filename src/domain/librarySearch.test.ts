import { describe, expect, it } from 'vitest';
import { createLibrarySearchDocuments, normalizeLibrarySearch, searchLibraryDocuments } from './librarySearch';
import type { Song } from './song';

const song = (id: string, title: string, author: string, firstLine = ''): Song => ({
  id,
  title,
  sortTitle: title,
  alternativeTitles: [],
  authors: [author],
  lyricists: [],
  composers: [],
  language: 'cs',
  categories: [],
  tags: [],
  firstLine,
  originalKey: null,
  capo: null,
  tempo: null,
  timeSignature: null,
  difficulty: 'unknown',
  contentFormat: 'chordpro',
  chordsVerified: false,
  chordProPath: `/songs/${id}.pro`,
  scoreAssets: [],
  source: 'synthetic test',
  sourceIdentifier: `test/${id}`,
  rightsStatus: 'public_domain',
  license: 'CC0-1.0',
  attribution: 'Synthetic test',
  personalOnly: false,
  contentBytes: 10,
  notes: '',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
});

describe('vyhledávací index knihovny', () => {
  it('ignoruje diakritiku a hledá všechna zadaná slova', () => {
    const documents = createLibrarySearchDocuments([
      song('one', 'Červená řeka', 'Jan Novák', 'Když slunce zapadá'),
      song('two', 'Modrý den', 'Petr Malý'),
    ]);

    expect(normalizeLibrarySearch('  ČEŘVENÁ  ')).toBe('cervena');
    expect(searchLibraryDocuments(documents, 'cervena novak')).toEqual(['one']);
    expect(searchLibraryDocuments(documents, 'slunce')).toEqual(['one']);
  });
});
