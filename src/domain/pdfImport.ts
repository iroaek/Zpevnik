import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { convertLayoutTextToChordPro, looksLikeChordLine } from './layoutToChordPro';
import { readBlobBytes } from './readBlobBytes';
import { reconstructPdfLines, type PositionedTextItem } from './pdfLayout';
import type { ChordNotation } from './chords';
import type { Song } from './song';
import type { PersonalSongEntry } from '../storage/database';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfImportProgress {
  fileName: string;
  page: number;
  totalPages: number;
}

export interface PdfImportResult {
  entries: PersonalSongEntry[];
  pageCount: number;
  skippedPages: number;
}

export interface PdfImportOptions {
  sourceNotation: ChordNotation;
  chordsVerified: boolean;
}

const MAX_PDF_BYTES = 80 * 1024 * 1024;
const MAX_PDF_PAGES = 800;

function safeBaseName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').replace(/[{}\r\n]/g, ' ').trim() || 'PDF';
}

function slug(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'bez-nazvu';
}

function detectPageMetadata(lines: string[], fileName: string, pageNumber: number, notation: ChordNotation): { title: string; artist?: string } {
  const useful = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line && !/^\d{1,4}$/.test(line) && !/^(?:https?:\/\/|www\.)/i.test(line));
  const titleCandidate = useful.find(({ line }) => !looksLikeChordLine(line, notation));
  const title = titleCandidate?.line.slice(0, 120) || `${safeBaseName(fileName)} - strana ${pageNumber}`;
  const firstChordIndex = useful.find(({ line }) => looksLikeChordLine(line, notation))?.index ?? Number.POSITIVE_INFINITY;
  const artistCandidate = useful.find(({ line, index }) => index > (titleCandidate?.index ?? -1) && index < firstChordIndex && line.length <= 80 && !looksLikeChordLine(line, notation));
  return { title, artist: artistCandidate?.line };
}

function markDuplicateTitles(entries: PersonalSongEntry[]): void {
  const groups = new Map<string, PersonalSongEntry[]>();
  for (const entry of entries) {
    const key = entry.song.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const entry of group) entry.song.reviewFlags = ['possible_duplicate'];
  }
}

export async function importPdfFile(
  file: File,
  options: PdfImportOptions,
  onProgress: (progress: PdfImportProgress) => void,
): Promise<PdfImportResult> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error(`${file.name}: soubor není PDF.`);
  if (file.size <= 0) throw new Error(`${file.name}: soubor je prázdný.`);
  if (file.size > MAX_PDF_BYTES) throw new Error(`${file.name}: maximum je 80 MB na jeden soubor.`);

  const loadingTask = getDocument({ data: await readBlobBytes(file) });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  if (pageCount > MAX_PDF_PAGES) {
    await loadingTask.destroy();
    throw new Error(`${file.name}: maximum je ${MAX_PDF_PAGES} stran.`);
  }

  const entries: PersonalSongEntry[] = [];
  let skippedPages = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress({ fileName: file.name, page: pageNumber, totalPages: document.numPages });
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const items = textContent.items.filter((item): item is typeof item & PositionedTextItem => 'str' in item && typeof item.str === 'string');
      const lines = reconstructPdfLines(items);
      const layoutText = lines.join('\n').trim();
      page.cleanup();
      if (!layoutText) {
        skippedPages += 1;
        continue;
      }

      const metadata = detectPageMetadata(lines, file.name, pageNumber, options.sourceNotation);
      const converted = convertLayoutTextToChordPro(layoutText, { ...metadata, sourceNotation: options.sourceNotation });
      const reviewFlags: NonNullable<Song['reviewFlags']> = [];
      if (converted.chordCount === 0) reviewFlags.push('missing_chords');
      if (converted.containsUnknownGlyphs) reviewFlags.push('unrecognized_glyphs');
      if (converted.malformedChordTokens.length > 0) reviewFlags.push('malformed_chord_layout');
      const chordsVerified = options.chordsVerified && reviewFlags.length === 0;
      const now = new Date().toISOString();
      const id = `personal-upload-${slug(metadata.title)}-${crypto.randomUUID()}`;
      const song: Song = {
        id,
        title: metadata.title,
        sortTitle: metadata.title,
        alternativeTitles: [],
        authors: metadata.artist ? [metadata.artist] : [],
        lyricists: [],
        composers: [],
        language: 'und',
        originalKey: converted.originalKey,
        timeSignature: null,
        tempo: null,
        capo: null,
        tags: ['osobní import', 'PDF'],
        categories: ['Osobní import'],
        difficulty: 'unknown',
        firstLine: converted.firstLine,
        chordProPath: `indexeddb:${id}`,
        contentBytes: new TextEncoder().encode(converted.chordPro).byteLength,
        contentFormat: 'chordpro',
        personalOnly: true,
        chordsVerified,
        reviewFlags,
        scoreAssets: [],
        source: `Uživatelem nahrané PDF ${file.name}`,
        sourceIdentifier: `local-pdf:${file.name}#page=${pageNumber}`,
        rightsStatus: 'requires_review',
        license: 'PERSONAL-USE - user supplied; not for publication',
        attribution: metadata.artist || 'Autor neuveden',
        notes: chordsVerified
          ? 'Akordy označil uživatel jako zkontrolované a import neodhalil vady; metadata a práva zůstávají ke kontrole.'
          : `Automatický import vyžaduje kontrolu${converted.malformedChordTokens.length ? `; podezřelé akordy: ${converted.malformedChordTokens.join(', ')}` : ''}.`,
        createdAt: now,
        updatedAt: now,
      };
      entries.push({ song, content: converted.chordPro });
    }
  } finally {
    await loadingTask.destroy();
  }

  markDuplicateTitles(entries);
  return { entries, pageCount, skippedPages };
}
