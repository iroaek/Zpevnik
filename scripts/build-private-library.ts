import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildPersonalLibrary, findLatestPersonalImport } from './lib/personal-library.js';
import { applyMemberLibraryGrant, createPrivateLibraryBackup, type PrivateLibraryScope } from './lib/private-library.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const outputArgument = argument('--output');
const scopeArgument = argument('--scope') ?? 'admin';
if (!outputArgument || (scopeArgument !== 'admin' && scopeArgument !== 'members')) {
  throw new Error('Použití: --scope <admin|members> --output <soubor.json>');
}

const projectRoot = process.cwd();
const importDirectory = findLatestPersonalImport(resolve(projectRoot, 'data', 'normalized'));
if (!importDirectory) throw new Error('Nebyl nalezen dokončený osobní import.');

const scope = scopeArgument as PrivateLibraryScope;
let snapshot = buildPersonalLibrary(importDirectory);
if (scope === 'members') {
  const grantPath = resolve(projectRoot, argument('--grant') ?? 'data/licenses/member-library-grant.json');
  const grant = JSON.parse(await readFile(grantPath, 'utf8')) as unknown;
  snapshot = applyMemberLibraryGrant(snapshot, grant);
}
const backup = createPrivateLibraryBackup(snapshot, scope);
const outputPath = resolve(projectRoot, outputArgument);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(backup)}\n`, 'utf8');
console.log(`Vytvořen soukromý ${scope} balík: ${backup.personalSongs.length} písní (${outputPath}).`);
