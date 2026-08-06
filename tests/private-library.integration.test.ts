// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PersonalLibrarySnapshot } from '../scripts/lib/personal-library.js';
import { createPrivateLibraryBackup } from '../scripts/lib/private-library.js';

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
    summary: { sourceDirectory: 'fixture', songCount: 1, totalPages: 1, continuationCandidates: 0, exactDuplicateGroups: 0 },
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
  });
});
