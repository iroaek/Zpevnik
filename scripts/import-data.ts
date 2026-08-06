import path from 'node:path';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { importPaths } from './lib/importer.js';

const root = process.cwd();
const inputRoot = path.join(root, 'data', 'import');
const normalizedRoot = path.join(root, 'data', 'normalized');

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  }));
  return nested.flat().filter((file) => path.basename(file) !== '.gitkeep');
}

const files = await walk(inputRoot);
const result = await importPaths(files);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(normalizedRoot, `import-${stamp}`);
await mkdir(output, { recursive: true });

const safeRecords = result.records.map(({ chordPro, ...record }) => ({ ...record, hasChordPro: Boolean(chordPro) }));
await writeFile(path.join(output, 'import-report.json'), `${JSON.stringify({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  inputFiles: files.map((file) => path.relative(root, file).replace(/\\/g, '/')),
  totals: {
    files: files.length,
    publishable: result.records.filter((record) => record.status === 'publishable').length,
    manualReview: result.records.filter((record) => record.status === 'requires_manual_review').length + result.scoreCandidates.length,
    rejected: result.records.filter((record) => record.status === 'rejected').length,
  },
  records: safeRecords,
  scoreCandidates: result.scoreCandidates.map(({ bytes, ...candidate }) => ({ ...candidate, byteLength: bytes.byteLength })),
  issues: result.issues,
}, null, 2)}\n`, 'utf8');

await writeFile(path.join(output, 'audit-log.jsonl'), result.records.map((record) => JSON.stringify({
  timestamp: new Date().toISOString(),
  originFile: record.originFile,
  recordId: record.id,
  status: record.status,
  transformations: record.transformations,
})).join('\n') + (result.records.length ? '\n' : ''), 'utf8');

await writeFile(path.join(output, 'manual-review.json'), `${JSON.stringify({
  records: safeRecords.filter((record) => record.status !== 'publishable'),
  scores: result.scoreCandidates.map(({ bytes, ...candidate }) => ({ ...candidate, byteLength: bytes.byteLength })),
}, null, 2)}\n`, 'utf8');

const publishable = result.records.filter((record) => record.status === 'publishable' && record.song && record.chordPro);
await mkdir(path.join(output, 'publishable', 'songs'), { recursive: true });
for (const record of publishable) {
  await writeFile(path.join(output, 'publishable', 'songs', `${record.id}.cho`), record.chordPro!, 'utf8');
}

console.log(`Import dokončen: ${files.length} souborů, ${publishable.length} publikovatelných, ${result.issues.length} hlášení.`);
console.log(`Výstup: ${path.relative(root, output)}`);
