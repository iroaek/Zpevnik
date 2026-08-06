// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPersonalLibrary, findLatestPersonalImport } from '../scripts/lib/personal-library.js';

const temporaryDirectories: string[] = [];

function createImport(root: string, name: string): string {
  const directory = join(root, name);
  const pages = join(directory, 'requires-review', 'pages');
  mkdirSync(pages, { recursive: true });
  writeFileSync(join(pages, 'synteticka-strana.txt'), 'C   G\nVymyšlená testovací věta', 'utf8');
  writeFileSync(join(pages, 'synteticke-pokracovani.txt'), 'Ami\nDruhá vymyšlená věta', 'utf8');
  writeFileSync(join(directory, 'manual-review.json'), JSON.stringify({
    records: [
      {
        id: 'synteticka-strana-p001',
        title: 'Syntetická strana',
        artist: 'Testovací autor',
        source: 'Uživatelem dodaný syntetický test',
        sourceIdentifier: 'fixture.pdf#page=1',
        rightsStatus: 'requires_review',
        license: 'UNVERIFIED - synthetic fixture',
        attribution: 'Testovací autor',
        status: 'requires_manual_review',
        pageType: 'song_start',
        draftPath: 'requires-review/pages/synteticka-strana.txt',
        duplicateGroups: ['exact-0001'],
        chordsVerified: true,
      },
      {
        id: 'pokracovani-p002',
        title: 'Pokračování',
        source: 'Uživatelem dodaný syntetický test',
        sourceIdentifier: 'fixture.pdf#page=2',
        rightsStatus: 'requires_review',
        license: 'UNVERIFIED - synthetic fixture',
        attribution: 'Test',
        status: 'requires_manual_review',
        pageType: 'continuation_candidate',
        parentCandidate: 'fixture.pdf#page=1',
        draftPath: 'requires-review/pages/synteticke-pokracovani.txt',
      },
    ],
  }), 'utf8');
  writeFileSync(join(directory, 'import-report.json'), JSON.stringify({
    createdAt: '2026-08-06T00:00:00.000Z',
    totals: { pages: 2, songStarts: 1, continuationCandidates: 1, exactDuplicateGroups: 1 },
  }), 'utf8');
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('osobní knihovna z PDF importu', () => {
  it('vybere nejnovější import a ponechá pokračování i duplicity ke kontrole', () => {
    const root = mkdtempSync(join(tmpdir(), 'zpevnik-personal-test-'));
    temporaryDirectories.push(root);
    createImport(root, 'import-2026-08-05T00-00-00Z-pdf-songbooks');
    const latest = createImport(root, 'import-2026-08-06T00-00-00Z-pdf-songbooks');

    expect(findLatestPersonalImport(root)).toBe(latest);
    const snapshot = buildPersonalLibrary(latest);
    expect(snapshot.catalog.songs).toHaveLength(1);
    expect(snapshot.catalog.songs[0]).toMatchObject({
      id: 'personal-synteticka-strana-p001',
      title: 'Syntetická strana',
      personalOnly: true,
      contentFormat: 'chordpro',
      chordsVerified: true,
      rightsStatus: 'requires_review',
      reviewFlags: ['possible_duplicate'],
    });
    expect(snapshot.summary).toMatchObject({ songCount: 1, totalPages: 2, continuationCandidates: 1, exactDuplicateGroups: 1 });
    expect(snapshot.contentBySongId.get('personal-synteticka-strana-p001')).toContain('[C]Vymy[G]šlená testovací věta');
    expect(snapshot.contentBySongId.get('personal-synteticka-strana-p001')).toContain('[Ami]Druhá vymyšlená věta');
  }, 20_000);

  it('neoznačí import jako ověřený, když chybí akordy nebo obsahuje neznámý znak', () => {
    const root = mkdtempSync(join(tmpdir(), 'zpevnik-personal-test-'));
    temporaryDirectories.push(root);
    const latest = createImport(root, 'import-2026-08-06T00-00-00Z-song-documents');
    writeFileSync(join(latest, 'requires-review', 'pages', 'synteticka-strana.txt'), 'Pouze vymyšlený text s � znakem', 'utf8');
    writeFileSync(join(latest, 'requires-review', 'pages', 'synteticke-pokracovani.txt'), 'Druhá vymyšlená věta', 'utf8');

    const snapshot = buildPersonalLibrary(latest);
    expect(snapshot.catalog.songs[0]).toMatchObject({
      chordsVerified: false,
      reviewFlags: expect.arrayContaining(['missing_chords', 'unrecognized_glyphs']),
    });
  });

  it('upřednostní novější společný import PDF a DOCX', () => {
    const root = mkdtempSync(join(tmpdir(), 'zpevnik-personal-test-'));
    temporaryDirectories.push(root);
    createImport(root, 'import-2026-08-06T00-00-00Z-pdf-songbooks');
    const latest = createImport(root, 'import-2026-08-06T01-00-00Z-song-documents');

    expect(findLatestPersonalImport(root)).toBe(latest);
  });
});
