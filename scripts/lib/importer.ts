import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse as parseCsv } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { z } from 'zod';
import { parseChordPro, sanitizeImportedText } from '../../src/domain/chordpro.js';
import { RIGHTS_STATUSES, songSchema, type Song } from '../../src/domain/song.js';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 100 * 1024 * 1024;

export type ImportStatus = 'publishable' | 'requires_manual_review' | 'rejected';

export interface ImportIssue {
  severity: 'info' | 'warning' | 'error';
  code: string;
  file: string;
  message: string;
  recordId?: string;
}

export interface ImportedRecord {
  id: string;
  originFile: string;
  detectedEncoding: 'utf-8' | 'windows-1250' | 'binary';
  status: ImportStatus;
  song: Song | null;
  chordPro: string | null;
  transformations: string[];
}

export interface ImportResult {
  records: ImportedRecord[];
  scoreCandidates: Array<{
    originFile: string;
    format: 'musicxml' | 'mxl';
    suggestedSongId: string;
    status: 'requires_manual_review';
    bytes: Uint8Array;
  }>;
  issues: ImportIssue[];
}

interface VirtualFile {
  name: string;
  bytes: Uint8Array;
}

const looseRowSchema = z.record(z.string(), z.unknown());

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function pick(row: Record<string, unknown>, ...names: string[]): string {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]/g, ''), value]));
  for (const name of names) {
    const value = normalized.get(name.toLowerCase().replace(/[\s_-]/g, ''));
    if (value !== undefined && asString(value)) return asString(value);
  }
  return '';
}

function list(value: string): string[] {
  return value.split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
}

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'neznamy-zaznam';
}

export function normalizeForDuplicate(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(ch|the|a)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function decodeText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1250' } {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return { text: sanitizeImportedText(decoder.decode(bytes)), encoding: 'utf-8' };
  } catch {
    return { text: sanitizeImportedText(iconv.decode(Buffer.from(bytes), 'windows-1250')), encoding: 'windows-1250' };
  }
}

function isoDate(value: string, fallback: string): string {
  const parsed = new Date(value || fallback);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed.toISOString();
}

function normalizeRights(value: string): Song['rightsStatus'] {
  const normalized = value.toLowerCase().replace(/[\s-]/g, '_');
  return RIGHTS_STATUSES.includes(normalized as Song['rightsStatus'])
    ? normalized as Song['rightsStatus']
    : 'unknown';
}

function rowToRecord(rowInput: Record<string, unknown>, originFile: string, chordProOverride?: string): ImportedRecord {
  const row = looseRowSchema.parse(rowInput);
  const now = new Date(0).toISOString();
  const title = pick(row, 'title', 'nazev', 'název');
  const authors = list(pick(row, 'authors', 'author', 'autori', 'autor'));
  const id = slugify(pick(row, 'id', 'songId') || title);
  const rightsStatus = normalizeRights(pick(row, 'rightsStatus', 'rights_status', 'stavPrav'));
  const source = pick(row, 'source', 'zdroj');
  const license = pick(row, 'license', 'licence');
  const attribution = pick(row, 'attribution', 'atribuce') || source;
  const rawContent = chordProOverride ?? pick(row, 'chordPro', 'chordpro', 'content', 'obsah', 'lyrics', 'text');
  const chordPro = rawContent ? sanitizeImportedText(rawContent) : null;
  const parsedContent = chordPro ? parseChordPro(chordPro) : null;
  const candidate: Song = {
    id,
    title,
    sortTitle: pick(row, 'sortTitle', 'sort_title') || title,
    alternativeTitles: list(pick(row, 'alternativeTitles', 'alternative_titles', 'alternativniNazvy')),
    authors,
    lyricists: list(pick(row, 'lyricists', 'textari')),
    composers: list(pick(row, 'composers', 'skladatele')),
    language: pick(row, 'language', 'jazyk') || 'cs',
    originalKey: pick(row, 'originalKey', 'original_key', 'key', 'tonina') || null,
    timeSignature: pick(row, 'timeSignature', 'time_signature', 'takt') || null,
    tempo: Number(pick(row, 'tempo')) || null,
    capo: Number.isFinite(Number(pick(row, 'capo'))) && pick(row, 'capo') ? Number(pick(row, 'capo')) : null,
    tags: list(pick(row, 'tags', 'stitky')),
    categories: list(pick(row, 'categories', 'category', 'kategorie')),
    difficulty: (['easy', 'medium', 'hard', 'unknown'].includes(pick(row, 'difficulty', 'obtiznost'))
      ? pick(row, 'difficulty', 'obtiznost') : 'unknown') as Song['difficulty'],
    firstLine: pick(row, 'firstLine', 'first_line', 'prvniRadek') || parsedContent?.firstLine || '',
    chordProPath: `/content/songs/${id}.cho`,
    contentBytes: chordPro ? new TextEncoder().encode(chordPro).byteLength : 0,
    scoreAssets: [],
    source,
    sourceIdentifier: pick(row, 'sourceIdentifier', 'source_identifier') || `${originFile}#${id}`,
    rightsStatus,
    license,
    attribution,
    notes: pick(row, 'notes', 'poznamky'),
    createdAt: isoDate(pick(row, 'createdAt', 'created_at'), now),
    updatedAt: isoDate(pick(row, 'updatedAt', 'updated_at'), now),
  };

  const validation = songSchema.safeParse(candidate);
  const missingLegal = !source || !pick(row, 'rightsStatus', 'rights_status', 'stavPrav');
  const status: ImportStatus = missingLegal || rightsStatus === 'unknown' || rightsStatus === 'requires_review'
    ? 'rejected'
    : (!validation.success || !chordPro ? 'requires_manual_review' : 'publishable');
  return {
    id,
    originFile,
    detectedEncoding: 'utf-8',
    status,
    song: validation.success ? validation.data : null,
    chordPro,
    transformations: ['normalizace názvů polí', 'normalizace Unicode NFC', 'validace schématu v1'],
  };
}

function chordProMetadataToRow(source: string): Record<string, unknown> {
  const parsed = parseChordPro(source);
  const first = (...keys: string[]) => keys.map((key) => parsed.metadata[key]?.[0]).find(Boolean) ?? '';
  const joined = (...keys: string[]) => keys.flatMap((key) => parsed.metadata[key] ?? []).join(';');
  return {
    id: first('id'),
    title: first('title', 't'),
    sortTitle: first('sort_title'),
    alternativeTitles: joined('alternative_title', 'alternative_titles'),
    authors: joined('author', 'authors'),
    lyricists: joined('lyricist', 'lyricists'),
    composers: joined('composer', 'composers'),
    language: first('language'),
    originalKey: first('key'),
    timeSignature: first('time', 'time_signature'),
    tempo: first('tempo'),
    capo: first('capo'),
    tags: joined('tag', 'tags'),
    categories: joined('category', 'categories'),
    difficulty: first('difficulty'),
    firstLine: first('first_line') || parsed.firstLine,
    source: first('source'),
    sourceIdentifier: first('source_identifier'),
    rightsStatus: first('rights_status'),
    license: first('license'),
    attribution: first('attribution'),
    notes: first('notes'),
    createdAt: first('created_at'),
    updatedAt: first('updated_at'),
  };
}

function looksLikeChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const chord = /^[A-H](?:#|b|is|es)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-H](?:#|b|is|es)?)?$/i;
  return tokens.filter((token) => chord.test(token)).length / tokens.length >= 0.75;
}

export function proposeChordProFromPlainText(source: string): string {
  const lines = sanitizeImportedText(source).split('\n');
  const output = ['{title: NÁZEV VYŽADUJE DOPLNĚNÍ}', '{rights_status: requires_review}', '{source: VYŽADUJE DOPLNĚNÍ}', ''];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (looksLikeChordLine(line) && lines[index + 1]?.trim()) {
      output.push(`{comment: Původní akordový řádek – umístění vyžaduje ruční kontrolu: ${line.trim()}}`);
    } else {
      output.push(line);
    }
  }
  return output.join('\n');
}

function issuesForRecord(record: ImportedRecord): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!record.song) {
    issues.push({ severity: 'error', code: 'INVALID_SCHEMA', file: record.originFile, recordId: record.id, message: 'Záznam neodpovídá povinnému schématu.' });
  }
  if (!record.song?.source || ['unknown', 'requires_review'].includes(record.song?.rightsStatus ?? 'unknown')) {
    issues.push({ severity: 'error', code: 'MISSING_RIGHTS', file: record.originFile, recordId: record.id, message: 'Záznam nebude publikován bez source a platného rightsStatus.' });
  }
  if (!record.chordPro) {
    issues.push({ severity: 'warning', code: 'MISSING_CONTENT', file: record.originFile, recordId: record.id, message: 'Záznam neobsahuje ChordPro obsah.' });
  }
  return issues;
}

async function rowsFromXlsx(bytes: Uint8Array): Promise<Record<string, unknown>[]> {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: false });
  const asArray = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : (Array.isArray(value) ? value : [value]);
  const textOf = (value: unknown): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(textOf).join('');
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return textOf(record['#text'] ?? record.t ?? record.r ?? '');
    }
    return '';
  };
  let worksheetPath = 'xl/worksheets/sheet1.xml';
  const workbookFile = archive.file('xl/workbook.xml');
  const relationshipsFile = archive.file('xl/_rels/workbook.xml.rels');
  if (workbookFile && relationshipsFile) {
    const workbook = parser.parse(await workbookFile.async('string')) as { workbook?: { sheets?: { sheet?: { '@_r:id'?: string } | Array<{ '@_r:id'?: string }> } } };
    const relationships = parser.parse(await relationshipsFile.async('string')) as { Relationships?: { Relationship?: { '@_Id'?: string; '@_Target'?: string } | Array<{ '@_Id'?: string; '@_Target'?: string }> } };
    const relationshipId = asArray(workbook.workbook?.sheets?.sheet)[0]?.['@_r:id'];
    const target = asArray(relationships.Relationships?.Relationship).find((relationship) => relationship['@_Id'] === relationshipId)?.['@_Target'];
    if (target) worksheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
  }
  const worksheetFile = archive.file(worksheetPath);
  if (!worksheetFile) throw new Error('XLSX neobsahuje deklarovaný první pracovní list.');
  let sharedStrings: string[] = [];
  const sharedFile = archive.file('xl/sharedStrings.xml');
  if (sharedFile) {
    const sharedXml = parser.parse(await sharedFile.async('string')) as { sst?: { si?: unknown | unknown[] } };
    sharedStrings = asArray(sharedXml.sst?.si).map(textOf);
  }
  type Cell = { '@_r'?: string; '@_t'?: string; v?: unknown; is?: unknown };
  type SheetRow = { c?: Cell | Cell[] };
  const sheetXml = parser.parse(await worksheetFile.async('string')) as { worksheet?: { sheetData?: { row?: SheetRow | SheetRow[] } } };
  const table = asArray(sheetXml.worksheet?.sheetData?.row).map((row) => {
    const values: string[] = [];
    for (const cell of asArray(row.c)) {
      const letters = (cell['@_r'] ?? 'A').match(/[A-Z]+/i)?.[0].toUpperCase() ?? 'A';
      const column = [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      const type = cell['@_t'];
      const raw = type === 'inlineStr' ? textOf(cell.is) : textOf(cell.v);
      values[column] = type === 's' ? (sharedStrings[Number(raw)] ?? '') : (type === 'b' ? (raw === '1' ? 'true' : 'false') : raw);
    }
    return values;
  });
  const headers = (table.shift() ?? []).map(asString);
  return table.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

async function rowsFromSqlite(bytes: Uint8Array): Promise<Record<string, unknown>[]> {
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const database = new SQL.Database(bytes);
  try {
    const tableResult = database.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const table = tableResult[0]?.values.map((value) => String(value[0])).find((name) => /song|pisen|pisne/i.test(name));
    if (!table) return [];
    const safeTable = table.replace(/"/g, '""');
    const result = database.exec(`SELECT * FROM "${safeTable}"`)[0];
    return result?.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]]))) ?? [];
  } finally {
    database.close();
  }
}

async function processVirtualFile(file: VirtualFile, result: ImportResult): Promise<void> {
  if (file.bytes.byteLength > MAX_FILE_BYTES) {
    result.issues.push({ severity: 'error', code: 'FILE_TOO_LARGE', file: file.name, message: 'Soubor překračuje bezpečnostní limit 50 MB.' });
    return;
  }
  const extension = path.extname(file.name).toLowerCase();
  if (extension === '.zip') {
    const archive = await JSZip.loadAsync(file.bytes, { checkCRC32: true });
    let total = 0;
    for (const entry of Object.values(archive.files)) {
      if (entry.dir || entry.name.includes('..') || path.isAbsolute(entry.name)) continue;
      const bytes = await entry.async('uint8array');
      total += bytes.byteLength;
      if (bytes.byteLength > MAX_ARCHIVE_ENTRY_BYTES || total > MAX_ARCHIVE_TOTAL_BYTES) {
        result.issues.push({ severity: 'error', code: 'ARCHIVE_LIMIT', file: `${file.name}!${entry.name}`, message: 'ZIP překročil bezpečnostní limit.' });
        break;
      }
      await processVirtualFile({ name: `${file.name}!${entry.name}`, bytes }, result);
    }
    return;
  }
  if (extension === '.musicxml' || extension === '.xml' || extension === '.mxl') {
    result.scoreCandidates.push({
      originFile: file.name,
      format: extension === '.mxl' ? 'mxl' : 'musicxml',
      suggestedSongId: slugify(path.basename(path.dirname(file.name)) || path.basename(file.name, extension)),
      status: 'requires_manual_review',
      bytes: file.bytes,
    });
    result.issues.push({ severity: 'warning', code: 'SCORE_NEEDS_LINK', file: file.name, message: 'Notový soubor vyžaduje ruční přiřazení k písni a ověření práv.' });
    return;
  }

  let rows: Record<string, unknown>[];
  let encoding: ImportedRecord['detectedEncoding'] = 'binary';
  if (extension === '.cho' || extension === '.chordpro' || extension === '.pro') {
    const decoded = decodeText(file.bytes);
    encoding = decoded.encoding;
    const row = chordProMetadataToRow(decoded.text);
    const record = rowToRecord(row, file.name, decoded.text);
    record.detectedEncoding = encoding;
    result.records.push(record);
    result.issues.push(...issuesForRecord(record));
    return;
  }
  if (extension === '.txt') {
    const decoded = decodeText(file.bytes);
    const proposal = proposeChordProFromPlainText(decoded.text);
    const record = rowToRecord(chordProMetadataToRow(proposal), file.name, proposal);
    record.detectedEncoding = decoded.encoding;
    record.status = 'requires_manual_review';
    record.transformations.push('návrh převodu oddělených akordových řádků bez automatického zarovnání');
    result.records.push(record);
    result.issues.push({ severity: 'warning', code: 'PLAIN_TEXT_REVIEW', file: file.name, recordId: record.id, message: 'Návrh ChordPro vyžaduje ruční kontrolu umístění akordů.' });
    return;
  }
  if (extension === '.csv') {
    const decoded = decodeText(file.bytes);
    encoding = decoded.encoding;
    rows = parseCsv(decoded.text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Record<string, unknown>[];
  } else if (extension === '.json') {
    const decoded = decodeText(file.bytes);
    encoding = decoded.encoding;
    const json = JSON.parse(decoded.text) as unknown;
    rows = Array.isArray(json) ? json as Record<string, unknown>[] : ((json as { songs?: Record<string, unknown>[] }).songs ?? [json as Record<string, unknown>]);
  } else if (extension === '.xlsx') {
    rows = await rowsFromXlsx(file.bytes);
  } else if (extension === '.sqlite' || extension === '.sqlite3' || extension === '.db') {
    rows = await rowsFromSqlite(file.bytes);
  } else {
    result.issues.push({ severity: 'info', code: 'UNSUPPORTED_FILE', file: file.name, message: 'Soubor byl přeskočen: nepodporovaný formát.' });
    return;
  }

  for (const row of rows) {
    const record = rowToRecord(row, file.name);
    record.detectedEncoding = encoding;
    result.records.push(record);
    result.issues.push(...issuesForRecord(record));
  }
}

function markDuplicates(result: ImportResult): void {
  const groups = new Map<string, ImportedRecord[]>();
  for (const record of result.records) {
    if (!record.song) continue;
    const signature = `${normalizeForDuplicate(record.song.title)}:${record.song.authors.map(normalizeForDuplicate).sort().join(',')}`;
    groups.set(signature, [...(groups.get(signature) ?? []), record]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const record of group) record.status = 'requires_manual_review';
    result.issues.push({
      severity: 'warning',
      code: 'PROBABLE_DUPLICATE',
      file: group.map((record) => record.originFile).join(', '),
      message: `Pravděpodobná duplicita (${group.map((record) => record.id).join(', ')}) nebyla automaticky sloučena.`,
    });
  }
}

export async function importFiles(files: VirtualFile[]): Promise<ImportResult> {
  const result: ImportResult = { records: [], scoreCandidates: [], issues: [] };
  for (const file of files) {
    try {
      await processVirtualFile(file, result);
    } catch (error) {
      result.issues.push({
        severity: 'error',
        code: 'CORRUPTED_INPUT',
        file: file.name,
        message: error instanceof Error ? error.message : 'Poškozený nebo nečitelný vstup.',
      });
    }
  }
  markDuplicates(result);
  return result;
}

export async function importPaths(filePaths: string[]): Promise<ImportResult> {
  const files = await Promise.all(filePaths.map(async (filePath) => ({ name: filePath, bytes: new Uint8Array(await readFile(filePath)) })));
  return importFiles(files);
}
