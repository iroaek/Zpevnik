import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isValidChordSymbol } from '../src/domain/chords.js';

interface LibraryEntry {
  song: {
    id: string;
    title: string;
    originalKey: string | null;
    chordsVerified?: boolean;
    reviewFlags?: string[];
  };
  content: string;
}

interface LibraryPackage {
  libraryScope: 'admin' | 'members';
  libraryManifest: { version: string; songCount: number };
  personalSongs: LibraryEntry[];
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function fold(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').replace(/[^a-z0-9]+/g, '');
}

function body(value: string): string {
  return value.split('\n')
    .filter((line) => !/^\s*\{(?:title|artist|chord_notation)\s*:/i.test(line))
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validChord(value: string): boolean {
  return isValidChordSymbol(value, 'czech') || isValidChordSymbol(value, 'international');
}

function auditLibrary(library: LibraryPackage) {
  const titleGroups = new Map<string, string[]>();
  const exactGroups = new Map<string, string[]>();
  const suspiciousSongs = new Set<string>();
  let chordTokens = 0;
  let invalidChordLikeTokens = 0;
  let annotationTokens = 0;
  let cisSpellings = 0;
  let standaloneChordLines = 0;
  let literalEscapes = 0;
  let songsWithoutChords = 0;

  for (const entry of library.personalSongs) {
    const titleKey = fold(entry.song.title);
    titleGroups.set(titleKey, [...(titleGroups.get(titleKey) ?? []), entry.song.id]);
    const normalizedBody = body(entry.content);
    if (normalizedBody.length >= 80) {
      const key = `${titleKey}:${createHash('sha256').update(normalizedBody).digest('hex')}`;
      exactGroups.set(key, [...(exactGroups.get(key) ?? []), entry.song.id]);
    }
    const tokens = [...entry.content.matchAll(/\[([^\]\n[]{1,64})\]/g)].map((match) => match[1].trim());
    const chords = tokens.filter(validChord);
    chordTokens += chords.length;
    annotationTokens += tokens.length - chords.length;
    if (chords.length === 0) songsWithoutChords += 1;
    if (/\\+u(?:00a0|2007|202f)|\\+x(?:a0)/i.test(entry.content)) {
      literalEscapes += 1;
      suspiciousSongs.add(entry.song.id);
    }
    const cisCount = chords.filter((token) => /^Cis|\/Cis$/.test(token)).length
      + (entry.song.originalKey && /^Cis(?:$|[^a-z])/i.test(entry.song.originalKey) ? 1 : 0);
    cisSpellings += cisCount;
    if (cisCount) suspiciousSongs.add(entry.song.id);
    const malformed = tokens.filter((token) => !validChord(token) && /^(?:[A-H](?:is|es|[#b])?)(?:\d|m|min|mi|maj|dim|aug|sus|add|no|[-+#b/()−°ø])/i.test(token));
    invalidChordLikeTokens += malformed.length;
    if (malformed.length) suspiciousSongs.add(entry.song.id);
    standaloneChordLines += entry.content.split('\n').filter((line) => {
      const candidates = [...line.matchAll(/\[([^\]\n[]{1,64})\]/g)].map((match) => match[1].trim());
      if (!candidates.length || candidates.some((candidate) => !validChord(candidate))) return false;
      return line.replace(/\[([^\]\n[]{1,64})\]/g, '').trim() === '';
    }).length;
  }

  const duplicateTitleGroups = [...titleGroups.values()].filter((ids) => ids.length > 1);
  const exactDuplicateGroups = [...exactGroups.values()].filter((ids) => ids.length > 1);
  return {
    scope: library.libraryScope,
    version: library.libraryManifest.version,
    songs: library.personalSongs.length,
    chordTokens,
    cisSpellings,
    invalidChordLikeTokens,
    annotationTokens,
    standaloneChordLines,
    literalEscapes,
    songsWithoutChords,
    exactDuplicateGroups: exactDuplicateGroups.length,
    exactDuplicateExcess: exactDuplicateGroups.reduce((sum, ids) => sum + ids.length - 1, 0),
    remainingSameTitleGroups: duplicateTitleGroups.length,
    requiresManualReview: [...suspiciousSongs].sort(),
    status: cisSpellings === 0 && invalidChordLikeTokens === 0 && literalEscapes === 0 && exactDuplicateGroups.length === 0 ? 'passed' : 'review_required',
  };
}

const adminPath = resolve(argument('--admin', 'tmp/private-library/admin-library.json'));
const memberPath = resolve(argument('--members', 'tmp/private-library/member-library.json'));
const outputPath = resolve(argument('--output', 'tmp/private-library/library-quality-report.json'));
const [admin, members] = await Promise.all([
  readFile(adminPath, 'utf8').then((value) => JSON.parse(value) as LibraryPackage),
  readFile(memberPath, 'utf8').then((value) => JSON.parse(value) as LibraryPackage),
]);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  libraries: [auditLibrary(admin), auditLibrary(members)],
  policy: 'Automaticky byly odstraněny pouze přesné duplicity stejného názvu a obsahu; nejednoznačné varianty zůstávají k ruční kontrole.',
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
