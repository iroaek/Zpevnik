import { createHash } from 'node:crypto';
import path from 'node:path';
import { cp, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { metadataList, metadataValue, parseChordPro } from '../src/domain/chordpro.js';
import { catalogSchema, isPublishable, publicSetlistSchema, scoreAssetSchema, songSchema, type PublicSetlist, type ScoreAsset, type Song } from '../src/domain/song.js';

const root = process.cwd();
const sourceSongs = path.join(root, 'data', 'songs');
const scoreRoot = path.join(root, 'data', 'scores');
const publicSetlistRoot = path.join(root, 'data', 'setlists');
const publicContent = path.join(root, 'public', 'content');
const generatedFile = path.join(root, 'src', 'generated', 'catalog.json');
const generatedManifest = path.join(publicContent, '.generated-files.json');

async function existingFiles(directory: string, extension?: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && (!extension || path.extname(entry.name).toLowerCase() === extension))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

async function scoreAssetsFor(songId: string): Promise<ScoreAsset[]> {
  const directory = path.join(scoreRoot, songId);
  const metadataPath = path.join(directory, 'score-metadata.json');
  const files = (await existingFiles(directory)).filter((file) => ['.musicxml', '.mxl'].includes(path.extname(file).toLowerCase()));
  if (files.length === 0) return [];
  let metadata: Record<string, Omit<ScoreAsset, 'path' | 'format' | 'instrument' | 'byteSize'>> = {};
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as typeof metadata;
  } catch {
    throw new Error(`${directory}: notové soubory nemají platný score-metadata.json.`);
  }
  return Promise.all(files.map(async (file) => {
    const filename = path.basename(file);
    const basename = path.basename(file, path.extname(file)).toLowerCase();
    const instrument = ['melody', 'violin', 'cello'].includes(basename) ? basename : 'other';
    const fileInfo = await stat(file);
    return scoreAssetSchema.parse({
      instrument,
      format: path.extname(file).toLowerCase() === '.mxl' ? 'mxl' : 'musicxml',
      path: `content/scores/${songId}/${filename}`,
      ...(metadata[filename] ?? {}),
      byteSize: fileInfo.size,
    });
  }));
}

async function songFromChordPro(file: string): Promise<Song> {
  const source = await readFile(file, 'utf8');
  const parsed = parseChordPro(source);
  const info = await stat(file);
  const id = metadataValue(parsed.metadata, 'id') || path.basename(file, path.extname(file));
  const title = metadataValue(parsed.metadata, 'title', 't');
  const numberOrNull = (value: string) => value && Number.isFinite(Number(value)) ? Number(value) : null;
  const song = songSchema.parse({
    id,
    title,
    sortTitle: metadataValue(parsed.metadata, 'sort_title') || title,
    alternativeTitles: metadataList(parsed.metadata, 'alternative_title', 'alternative_titles'),
    authors: metadataList(parsed.metadata, 'author', 'authors'),
    lyricists: metadataList(parsed.metadata, 'lyricist', 'lyricists'),
    composers: metadataList(parsed.metadata, 'composer', 'composers'),
    language: metadataValue(parsed.metadata, 'language') || 'cs',
    originalKey: metadataValue(parsed.metadata, 'key') || null,
    timeSignature: metadataValue(parsed.metadata, 'time', 'time_signature') || null,
    tempo: numberOrNull(metadataValue(parsed.metadata, 'tempo')),
    capo: numberOrNull(metadataValue(parsed.metadata, 'capo')),
    tags: metadataList(parsed.metadata, 'tag', 'tags'),
    categories: metadataList(parsed.metadata, 'category', 'categories'),
    difficulty: metadataValue(parsed.metadata, 'difficulty') || 'unknown',
    firstLine: metadataValue(parsed.metadata, 'first_line') || parsed.firstLine,
    chordProPath: `content/songs/${id}.cho`,
    contentBytes: Buffer.byteLength(source, 'utf8'),
    scoreAssets: await scoreAssetsFor(id),
    source: metadataValue(parsed.metadata, 'source'),
    sourceIdentifier: metadataValue(parsed.metadata, 'source_identifier') || `data/songs/${path.basename(file)}`,
    rightsStatus: metadataValue(parsed.metadata, 'rights_status') || 'unknown',
    license: metadataValue(parsed.metadata, 'license'),
    attribution: metadataValue(parsed.metadata, 'attribution'),
    notes: metadataValue(parsed.metadata, 'notes'),
    createdAt: new Date(metadataValue(parsed.metadata, 'created_at') || info.birthtime).toISOString(),
    updatedAt: new Date(metadataValue(parsed.metadata, 'updated_at') || info.mtime).toISOString(),
  });
  if (!isPublishable(song)) throw new Error(`${file}: záznam není publikovatelný (source/rightsStatus/license).`);
  return song;
}

const songFiles = await existingFiles(sourceSongs, '.cho');
const songs = (await Promise.all(songFiles.map(songFromChordPro))).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle, 'cs'));
const duplicateIds = songs.filter((song, index) => songs.findIndex((candidate) => candidate.id === song.id) !== index);
if (duplicateIds.length) throw new Error(`Duplicitní ID: ${duplicateIds.map((song) => song.id).join(', ')}`);

const setlistFiles = await existingFiles(publicSetlistRoot, '.json');
const publicSetlists: PublicSetlist[] = await Promise.all(setlistFiles.map(async (file) => {
  const setlist = publicSetlistSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  if (['unknown', 'requires_review'].includes(setlist.rightsStatus)) throw new Error(`${file}: veřejný setlist nemá vyjasněná práva.`);
  const missingSongs = setlist.songIds.filter((songId) => !songs.some((song) => song.id === songId));
  if (missingSongs.length) throw new Error(`${file}: neznámá ID písní ${missingSongs.join(', ')}.`);
  return setlist;
}));

const version = createHash('sha256')
  .update(JSON.stringify({ songs, publicSetlists }))
  .digest('hex')
  .slice(0, 12);

const catalog = catalogSchema.parse({ schemaVersion: 3, version, generatedAt: new Date().toISOString(), songs, publicSetlists });
const resolvedContent = path.resolve(publicContent);
const expectedContent = path.resolve(root, 'public', 'content');
if (resolvedContent !== expectedContent || !resolvedContent.startsWith(path.resolve(root) + path.sep)) {
  throw new Error('Odmítnuto nebezpečné umístění generovaného obsahu.');
}
try {
  const previousFiles = JSON.parse(await readFile(generatedManifest, 'utf8')) as unknown;
  if (!Array.isArray(previousFiles) || previousFiles.some((file) => typeof file !== 'string')) throw new Error('Neplatný manifest dříve generovaných souborů.');
  for (const relativeFile of previousFiles as string[]) {
    const absoluteFile = path.resolve(publicContent, relativeFile);
    if (!absoluteFile.startsWith(resolvedContent + path.sep)) throw new Error(`Nebezpečná cesta v manifestu: ${relativeFile}`);
    try { await unlink(absoluteFile); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
await mkdir(path.join(publicContent, 'songs'), { recursive: true });
await mkdir(path.join(publicContent, 'scores'), { recursive: true });
await mkdir(path.dirname(generatedFile), { recursive: true });

const generatedFiles: string[] = ['catalog.json'];
for (const song of songs) {
  const sourceFile = songFiles.find((file) => path.basename(file, '.cho') === song.id);
  if (!sourceFile) throw new Error(`Chybí zdrojový ChordPro pro ${song.id}.`);
  await cp(sourceFile, path.join(publicContent, 'songs', `${song.id}.cho`));
  generatedFiles.push(`songs/${song.id}.cho`);
  for (const asset of song.scoreAssets) {
    const sourceAsset = path.join(scoreRoot, song.id, path.basename(asset.path));
    const destination = path.join(publicContent, 'scores', song.id, path.basename(asset.path));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(sourceAsset, destination);
    generatedFiles.push(`scores/${song.id}/${path.basename(asset.path)}`);
  }
}
const json = `${JSON.stringify(catalog, null, 2)}\n`;
await writeFile(generatedFile, json, 'utf8');
await writeFile(path.join(publicContent, 'catalog.json'), json, 'utf8');
await writeFile(generatedManifest, `${JSON.stringify(generatedFiles, null, 2)}\n`, 'utf8');
console.log(`Vygenerován katalog: ${songs.length} písní.`);
