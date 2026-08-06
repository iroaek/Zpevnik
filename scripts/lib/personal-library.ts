import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { convertLayoutTextToChordPro } from '../../src/domain/layoutToChordPro.js';

export const PERSONAL_LIBRARY_ROUTE = '/__personal_library';

interface ReviewRecord {
  id: string;
  title: string;
  artist?: string;
  source: string;
  sourceIdentifier: string;
  rightsStatus: 'requires_review';
  license: string;
  attribution: string;
  status: string;
  pageType: 'song_start' | 'continuation_candidate' | 'blank';
  draftPath: string;
  duplicateGroups?: string[];
  chordsVerified?: boolean;
}

interface ManualReviewFile {
  records: ReviewRecord[];
}

interface ImportReport {
  createdAt: string;
  inputSha256?: Record<string, string>;
  totals?: {
    pages?: number;
    songStarts?: number;
    continuationCandidates?: number;
    exactDuplicateGroups?: number;
  };
}

export interface PersonalLibrarySnapshot {
  catalog: {
    schemaVersion: 3;
    version: string;
    generatedAt: string;
    songs: Array<Record<string, unknown>>;
    publicSetlists: never[];
  };
  summary: {
    sourceDirectory: string;
    songCount: number;
    totalPages: number;
    continuationCandidates: number;
    exactDuplicateGroups: number;
    inputSha256: Record<string, string>;
  };
  contentBySongId: Map<string, string>;
}

function isInside(parent: string, candidate: string): boolean {
  const normalizedParent = `${resolve(parent)}${sep}`.toLocaleLowerCase();
  const normalizedCandidate = resolve(candidate).toLocaleLowerCase();
  return normalizedCandidate.startsWith(normalizedParent);
}

export function findLatestPersonalImport(normalizedRoot: string): string | null {
  if (!existsSync(normalizedRoot)) return null;
  const candidates = readdirSync(normalizedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /-(?:pdf-songbooks|song-documents)$/.test(entry.name))
    .map((entry) => resolve(normalizedRoot, entry.name))
    .filter((directory) => existsSync(resolve(directory, 'manual-review.json')))
    .sort((left, right) => right.localeCompare(left));
  return candidates[0] ?? null;
}

export function buildPersonalLibrary(importDirectory: string): PersonalLibrarySnapshot {
  const reviewPath = resolve(importDirectory, 'manual-review.json');
  const reportPath = resolve(importDirectory, 'import-report.json');
  const review = JSON.parse(readFileSync(reviewPath, 'utf8')) as ManualReviewFile;
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ImportReport;
  const generatedAt = new Date(report.createdAt).toISOString();
  const contentBySongId = new Map<string, string>();

  const songs = review.records
    .filter((record) => record.pageType === 'song_start' && record.rightsStatus === 'requires_review')
    .map((record) => {
      const id = `personal-${record.id}`;
      const contentPath = resolve(importDirectory, record.draftPath);
      if (!isInside(importDirectory, contentPath) || !existsSync(contentPath)) {
        throw new Error(`Neplatná cesta osobního obsahu: ${record.draftPath}`);
      }
      const converted = convertLayoutTextToChordPro(readFileSync(contentPath, 'utf8'), {
        title: record.title.trim() || 'Bez názvu',
        artist: record.artist?.trim(),
        sourceNotation: 'czech',
      });
      contentBySongId.set(id, converted.chordPro);
      return {
        id,
        title: record.title.trim() || 'Bez názvu',
        sortTitle: record.title.trim() || 'Bez názvu',
        alternativeTitles: [],
        authors: record.artist?.trim() ? [record.artist.trim()] : [],
        lyricists: [],
        composers: [],
        language: 'und',
        originalKey: converted.originalKey,
        timeSignature: null,
        tempo: null,
        capo: null,
        tags: ['osobní import', 'ke kontrole'],
        categories: ['Osobní koncept'],
        difficulty: 'unknown',
        firstLine: converted.firstLine,
        chordProPath: `${PERSONAL_LIBRARY_ROUTE}/content/${id}.txt`,
        contentBytes: Buffer.byteLength(converted.chordPro, 'utf8'),
        contentFormat: 'chordpro',
        personalOnly: true,
        chordsVerified: record.chordsVerified === true,
        reviewFlags: record.duplicateGroups?.length ? ['possible_duplicate'] : [],
        scoreAssets: [],
        source: record.source,
        sourceIdentifier: record.sourceIdentifier,
        rightsStatus: record.rightsStatus,
        license: record.license,
        attribution: record.attribution || 'Autor neuveden',
        notes: 'Akordy byly převedeny z uživatelem dodaného dokumentu a označeny uživatelem jako zkontrolované; metadata a práva zůstávají ke kontrole.',
        createdAt: generatedAt,
        updatedAt: generatedAt,
      };
    })
    .sort((left, right) => left.sortTitle.localeCompare(right.sortTitle, 'cs'));

  return {
    catalog: {
      schemaVersion: 3,
      version: `personal-${importDirectory.split(/[\\/]/).at(-1) ?? 'import'}`,
      generatedAt,
      songs,
      publicSetlists: [],
    },
    summary: {
      sourceDirectory: importDirectory.split(/[\\/]/).at(-1) ?? importDirectory,
      songCount: songs.length,
      totalPages: report.totals?.pages ?? review.records.length,
      continuationCandidates: report.totals?.continuationCandidates ?? 0,
      exactDuplicateGroups: report.totals?.exactDuplicateGroups ?? 0,
      inputSha256: report.inputSha256 ?? {},
    },
    contentBySongId,
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(body));
}

export function personalLibraryPlugin(projectRoot = process.cwd(), enabled = true): Plugin {
  return {
    name: 'personal-library-dev-only',
    apply: 'serve',
    configureServer(server) {
      let cached: { importDirectory: string; reviewMtime: number; snapshot: PersonalLibrarySnapshot } | null = null;
      const getSnapshot = (): PersonalLibrarySnapshot | null => {
        const normalizedRoot = resolve(projectRoot, 'data', 'normalized');
        const importDirectory = findLatestPersonalImport(normalizedRoot);
        if (!importDirectory) return null;
        const reviewMtime = statSync(resolve(importDirectory, 'manual-review.json')).mtimeMs;
        if (cached?.importDirectory === importDirectory && cached.reviewMtime === reviewMtime) return cached.snapshot;
        const snapshot = buildPersonalLibrary(importDirectory);
        cached = { importDirectory, reviewMtime, snapshot };
        return snapshot;
      };

      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (!pathname.startsWith(PERSONAL_LIBRARY_ROUTE)) {
          next();
          return;
        }
        if (!enabled) {
          sendJson(response, 404, { error: 'Osobní katalog počítače není v mobilním síťovém režimu zpřístupněný.' });
          return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          sendJson(response, 405, { error: 'Method not allowed' });
          return;
        }

        try {
          const snapshot = getSnapshot();
          if (!snapshot) {
            sendJson(response, 404, { error: 'Osobní import nebyl nalezen.' });
            return;
          }
          if (pathname === `${PERSONAL_LIBRARY_ROUTE}/catalog.json`) {
            sendJson(response, 200, { ...snapshot.catalog, personalSummary: snapshot.summary });
            return;
          }

          const match = pathname.match(new RegExp(`^${PERSONAL_LIBRARY_ROUTE}/content/(personal-[a-z0-9-]+)\\.txt$`));
          const content = match ? snapshot.contentBySongId.get(match[1]) : undefined;
          if (!content) {
            sendJson(response, 404, { error: 'Osobní píseň nebyla nalezena.' });
            return;
          }
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          response.end(request.method === 'HEAD' ? undefined : content);
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : 'Osobní katalog se nepodařilo načíst.' });
        }
      });
    },
  };
}
