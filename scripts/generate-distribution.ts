import path from 'node:path';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { catalogSchema } from '../src/domain/song.js';
import { basePathFromUrl, getPublicBaseUrl } from './lib/public-base.js';

const root = process.cwd();
const publicRoot = path.join(root, 'public');
const qrRoot = path.join(publicRoot, 'qr');
const generatedRoot = path.join(root, 'src', 'generated');
const publicBase = getPublicBaseUrl(root);
const basePath = basePathFromUrl(publicBase);
const catalog = catalogSchema.parse(JSON.parse(await readFile(path.join(generatedRoot, 'catalog.json'), 'utf8')));

const resolvedQrRoot = path.resolve(qrRoot);
if (!resolvedQrRoot.startsWith(path.resolve(publicRoot) + path.sep)) throw new Error('Nebezpečné umístění QR výstupu.');
await mkdir(resolvedQrRoot, { recursive: true });
const qrManifestPath = path.join(resolvedQrRoot, '.generated-files.json');
try {
  const previousFiles = JSON.parse(await readFile(qrManifestPath, 'utf8')) as unknown;
  if (!Array.isArray(previousFiles) || !previousFiles.every((file) => typeof file === 'string')) throw new Error('Neplatný manifest dříve generovaných QR souborů.');
  for (const file of previousFiles) {
    const target = path.resolve(resolvedQrRoot, file);
    if (!target.startsWith(`${resolvedQrRoot}${path.sep}`)) throw new Error(`Nebezpečná cesta v QR manifestu: ${file}`);
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const generatedQrFiles: string[] = [];

function canonical(relative = ''): string {
  return new URL(relative.replace(/^\//, ''), publicBase).toString();
}

async function generateQr(name: string, url: string): Promise<void> {
  const options = { errorCorrectionLevel: 'M' as const, margin: 4, width: 1024, color: { dark: '#34251fff', light: '#fffaf1ff' } };
  await QRCode.toFile(path.join(qrRoot, `${name}.svg`), url, { ...options, type: 'svg' });
  await QRCode.toFile(path.join(qrRoot, `${name}.png`), url, { ...options, type: 'png' });
  generatedQrFiles.push(`${name}.svg`, `${name}.png`);
}

await generateQr('hlavni', canonical());
await generateQr('offline', canonical('offline'));
await generateQr('instalace', canonical('install'));
for (const song of catalog.songs) await generateQr(`pisen-${song.id}`, canonical(`songs/${song.id}`));
for (const setlist of catalog.publicSetlists) await generateQr(`setlist-${setlist.id}`, canonical(`setlists/${setlist.id}`));

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const publicUrls = [canonical(), canonical('offline'), canonical('install'), canonical('help'), ...catalog.songs.map((song) => canonical(`songs/${song.id}`)), ...catalog.publicSetlists.map((setlist) => canonical(`setlists/${setlist.id}`))];
await writeFile(path.join(publicRoot, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicUrls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n')}\n</urlset>\n`, 'utf8');
await writeFile(path.join(publicRoot, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${canonical('sitemap.xml')}\n`, 'utf8');

const fallbackTarget = `${basePath}index.html`.replace(/\/{2,}/g, '/');
await writeFile(path.join(publicRoot, '_redirects'), `/* ${fallbackTarget} 200\n`, 'utf8');
await writeFile(path.join(publicRoot, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/content/catalog.json
  Cache-Control: no-cache

/sw.js
  Cache-Control: no-cache

/manifest.webmanifest
  Cache-Control: no-cache
`, 'utf8');

await writeFile(path.join(qrRoot, 'index.html'), `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>QR – Český zpěvník</title><style>
@page{size:A4 portrait;margin:16mm}*{box-sizing:border-box}body{font-family:system-ui,sans-serif;color:#34251f;margin:0}main{min-height:260mm;display:grid;place-items:center;text-align:center;border:2px solid #7a321f;padding:16mm}h1{font-family:Georgia,serif;font-size:30pt;margin:0}img{width:105mm;height:105mm;margin:10mm}.steps{font-size:15pt;line-height:1.5;max-width:155mm}.offline{font-weight:700;color:#7a321f}.url{font-family:ui-monospace,monospace;font-size:10pt;overflow-wrap:anywhere}@media screen{body{background:#eee;padding:24px}main{max-width:210mm;margin:auto;background:white;box-shadow:0 10px 35px #0002}}
</style></head><body><main><div><h1>Český digitální zpěvník</h1><p>Naskenujte fotoaparátem telefonu</p><img src="hlavni.svg" alt="QR kód hlavní stránky"><p class="steps">1. Otevřete odkaz · 2. Vyberte píseň · 3. Zpívejte</p><p class="offline">Zpěvník lze předem stáhnout a používat bez internetu.</p><p class="url">${escapeXml(canonical())}</p></div></main></body></html>`, 'utf8');
generatedQrFiles.push('index.html');
await writeFile(qrManifestPath, `${JSON.stringify(generatedQrFiles, null, 2)}\n`, 'utf8');

await mkdir(generatedRoot, { recursive: true });
await writeFile(path.join(generatedRoot, 'distribution.json'), `${JSON.stringify({ publicBaseUrl: publicBase.toString(), basePath, generatedAt: new Date().toISOString(), qrCodes: 3 + catalog.songs.length + catalog.publicSetlists.length }, null, 2)}\n`, 'utf8');
console.log(`Distribuční aktiva: ${publicBase} (${3 + catalog.songs.length + catalog.publicSetlists.length} QR kódů).`);
