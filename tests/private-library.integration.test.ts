// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PersonalLibrarySnapshot } from '../scripts/lib/personal-library.js';
import { applyMemberLibraryGrant, createPrivateLibraryBackup } from '../scripts/lib/private-library.js';

const inputSha256 = { 'songs_data/test.pdf': 'a'.repeat(64) };

function snapshot(): PersonalLibrarySnapshot {
  const song = {
    id: 'personal-synteticka-pisen',
    title: 'Syntetická píseň',
    sortTitle: 'Syntetická píseň',
    alternativeTitles: [],
    authors: ['Testovací autor'],
    lyricists: [],
    composers: [],
    language: 'cs',
    originalKey: 'C',
    timeSignature: null,
    tempo: null,
    capo: null,
    tags: ['syntetické'],
    categories: ['Test'],
    difficulty: 'unknown',
    firstLine: 'Vymyšlený řádek',
    chordProPath: '/synthetic.txt',
    contentBytes: 0,
    contentFormat: 'chordpro',
    personalOnly: true,
    chordsVerified: true,
    reviewFlags: [],
    scoreAssets: [],
    source: 'Syntetická testovací data',
    sourceIdentifier: 'fixture/synthetic',
    rightsStatus: 'requires_review',
    license: 'UNVERIFIED - synthetic fixture',
    attribution: 'Testovací autor',
    notes: 'Pouze test.',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
  };
  return {
    catalog: { schemaVersion: 3, version: 'synthetic-test', generatedAt: song.createdAt, songs: [song], publicSetlists: [] },
    summary: { sourceDirectory: 'fixture', songCount: 1, totalPages: 1, continuationCandidates: 0, exactDuplicateGroups: 0, inputSha256 },
    contentBySongId: new Map([[song.id, '[C]Vymyšlený řádek']]),
  };
}

describe('soukromé knihovní balíky', () => {
  it('ponechá neověřenou píseň pouze ve správcovském balíku', () => {
    const source = snapshot();
    const admin = createPrivateLibraryBackup(source, 'admin', '2026-08-06T00:00:00.000Z');
    const members = createPrivateLibraryBackup(source, 'members', '2026-08-06T00:00:00.000Z');

    expect(admin.personalSongs).toHaveLength(1);
    expect(admin.personalSongs[0].song.chordProPath).toBe('indexeddb:personal-synteticka-pisen');
    expect(members.personalSongs).toHaveLength(0);
    expect(admin.libraryManifest).toMatchObject({ schemaVersion: 1, scope: 'admin', songCount: 1 });
    expect(admin.libraryManifest.version).toMatch(/^[a-f0-9]{12}$/);
    expect(members.libraryManifest).toMatchObject({ scope: 'members', songCount: 0 });
  });

  it('zpřístupní členům jen přesně autorizovaný import a zachová atribuci', () => {
    const source = applyMemberLibraryGrant(snapshot(), {
      schemaVersion: 1,
      importDirectory: 'fixture',
      grantedAt: '2026-08-06T00:00:00.000Z',
      grantedBy: 'Oprávněný poskytovatel',
      authorization: 'Souhlasím se zpřístupněním schváleným uživatelům.',
      allowedAudience: 'approved_members',
      allowOfflineDownload: true,
      rightsStatus: 'licensed',
      license: 'Soukromé členské oprávnění; další šíření zakázáno.',
      inputSha256,
    });
    const members = createPrivateLibraryBackup(source, 'members', '2026-08-06T00:00:00.000Z');

    expect(members.personalSongs).toHaveLength(1);
    expect(members.personalSongs[0].song).toMatchObject({
      rightsStatus: 'licensed',
      attribution: 'Testovací autor',
      license: 'Soukromé členské oprávnění; další šíření zakázáno.',
    });
  });

  it('ani s platným oprávněním nezpřístupní členům píseň zablokovanou kontrolou akordů', () => {
    const source = snapshot();
    source.catalog.songs[0] = { ...source.catalog.songs[0], chordsVerified: false, reviewFlags: ['missing_chords'] };
    const granted = applyMemberLibraryGrant(source, {
      schemaVersion: 1,
      importDirectory: 'fixture',
      grantedAt: '2026-08-06T00:00:00.000Z',
      grantedBy: 'Oprávněný poskytovatel',
      authorization: 'Souhlasím se zpřístupněním schváleným uživatelům.',
      allowedAudience: 'approved_members',
      allowOfflineDownload: true,
      rightsStatus: 'licensed',
      license: 'Soukromé členské oprávnění; další šíření zakázáno.',
      inputSha256,
    });

    expect(createPrivateLibraryBackup(granted, 'members').personalSongs).toHaveLength(0);
  });

  it('uchová důvody kontroly a přitom zůstane čitelný ve starší PWA', () => {
    const source = snapshot();
    source.catalog.songs[0] = {
      ...source.catalog.songs[0],
      reviewFlags: ['possible_duplicate', 'missing_chords', 'malformed_chord_layout'],
    };

    const adminSong = createPrivateLibraryBackup(source, 'admin').personalSongs[0].song;

    expect(adminSong.reviewFlags).toEqual(['possible_duplicate']);
    expect(adminSong.tags).toEqual(expect.arrayContaining(['review:missing_chords', 'review:malformed_chord_layout']));
  });

  it('odmítne oprávnění pro jiné nebo změněné dokumenty', () => {
    expect(() => applyMemberLibraryGrant(snapshot(), {
      schemaVersion: 1,
      importDirectory: 'fixture',
      grantedAt: '2026-08-06T00:00:00.000Z',
      grantedBy: 'Oprávněný poskytovatel',
      authorization: 'Souhlasím se zpřístupněním schváleným uživatelům.',
      allowedAudience: 'approved_members',
      allowOfflineDownload: true,
      rightsStatus: 'licensed',
      license: 'Soukromé členské oprávnění; další šíření zakázáno.',
      inputSha256: { 'songs_data/test.pdf': 'b'.repeat(64) },
    })).toThrow(/Otisky vstupních dokumentů/);
  });
});
