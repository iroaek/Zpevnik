import path from 'node:path';
import { copyFile, writeFile } from 'node:fs/promises';

const dist = path.join(process.cwd(), 'dist');
await copyFile(path.join(dist, 'index.html'), path.join(dist, '404.html'));
await writeFile(path.join(dist, '.nojekyll'), '', 'utf8');
console.log('Vytvořen SPA fallback 404.html a .nojekyll.');
