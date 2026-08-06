import { catalogSchema, type Catalog } from '../domain/song';
import { resolvePublicPath } from './paths';

const CACHE_PREFIX = 'zpevnik-content-v2';
const CATALOG_CACHE = `${CACHE_PREFIX}-catalog`;
const META_CACHE = `${CACHE_PREFIX}-meta`;

export type ContentKind = 'songs' | 'scores';

export interface DownloadProgress {
  completed: number;
  total: number;
  downloadedBytes: number;
  estimatedBytes: number;
  currentLabel: string;
}

export interface OfflineContentStats {
  supported: boolean;
  serviceWorkerActive: boolean;
  catalogCached: boolean;
  downloadedSongs: number;
  totalSongs: number;
  downloadedScores: number;
  totalScores: number;
  bytes: number;
  allSongsVerified: boolean;
  allScoresVerified: boolean;
  lastUpdated: string | null;
}

export class OfflineContentMissingError extends Error {
  constructor(public readonly resourceType: ContentKind) {
    super(resourceType === 'scores'
      ? 'Tento notový part ještě není stažený. Připojte se k internetu nebo jej stáhněte v Offline obsahu.'
      : 'Tato píseň ještě není stažená. Připojte se k internetu nebo stáhněte celý zpěvník.');
  }
}

function cacheName(kind: ContentKind, version: string): string {
  return `${CACHE_PREFIX}-${kind}-${version.replace(/[^a-z0-9_-]/gi, '')}`;
}

function cacheAvailable(): boolean {
  return typeof window !== 'undefined' && 'caches' in window;
}

async function markUpdated(): Promise<void> {
  if (!cacheAvailable()) return;
  const cache = await caches.open(META_CACHE);
  await cache.put(resolvePublicPath('offline-metadata.json'), new Response(JSON.stringify({ updatedAt: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } }));
}

export async function cacheCatalog(catalog: Catalog): Promise<void> {
  if (!cacheAvailable()) return;
  const validated = catalogSchema.parse(catalog);
  const cache = await caches.open(CATALOG_CACHE);
  await cache.put(resolvePublicPath('content/catalog.json'), new Response(JSON.stringify(validated), { headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  await markUpdated();
}

export async function loadLatestCatalog(fallback: Catalog): Promise<Catalog> {
  if (!cacheAvailable()) return fallback;
  const url = resolvePublicPath('content/catalog.json');
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Katalog HTTP ${response.status}`);
    const parsed = catalogSchema.parse(await response.clone().json());
    await cacheCatalog(parsed);
    return parsed;
  } catch {
    try {
      const cached = await (await caches.open(CATALOG_CACHE)).match(url);
      return cached ? catalogSchema.parse(await cached.json()) : fallback;
    } catch {
      return fallback;
    }
  }
}

export async function fetchContent(relativePath: string, kind: ContentKind, version: string, signal?: AbortSignal): Promise<Response> {
  const url = resolvePublicPath(relativePath);
  if (!cacheAvailable()) return fetch(url, { signal });
  const cache = await caches.open(cacheName(kind, version));
  const cached = await cache.match(url);
  if (cached) return cached.clone();
  if (!navigator.onLine) throw new OfflineContentMissingError(kind);
  let response: Response;
  try {
    response = await fetch(url, { signal, cache: 'no-store' });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OfflineContentMissingError(kind);
  }
  if (!response.ok) throw new Error(`Soubor se nepodařilo stáhnout (${response.status}).`);
  await cache.put(url, response.clone());
  await markUpdated();
  return response;
}

async function downloadItems(
  items: Array<{ path: string; label: string; bytes: number }>,
  kind: ContentKind,
  version: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  if (!cacheAvailable()) throw new Error('Tento prohlížeč nepodporuje úložiště offline obsahu.');
  const cache = await caches.open(cacheName(kind, version));
  const estimatedBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  let downloadedBytes = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const url = resolvePublicPath(item.path);
    let response = await cache.match(url);
    if (!response) {
      if (!navigator.onLine) throw new OfflineContentMissingError(kind);
      let networkResponse: Response;
      try {
        networkResponse = await fetch(url, { cache: 'no-store' });
      } catch {
        throw new OfflineContentMissingError(kind);
      }
      if (!networkResponse.ok) throw new Error(`${item.label}: HTTP ${networkResponse.status}`);
      await cache.put(url, networkResponse.clone());
      response = await cache.match(url);
    }
    if (!response || !response.ok) throw new Error(`${item.label}: uložení do cache se nepodařilo ověřit.`);
    const actualBytes = (await response.clone().arrayBuffer()).byteLength;
    if (actualBytes === 0) throw new Error(`${item.label}: stažený soubor je prázdný.`);
    downloadedBytes += actualBytes;
    onProgress({ completed: index + 1, total: items.length, downloadedBytes, estimatedBytes, currentLabel: item.label });
  }
  await markUpdated();
}

export async function downloadAllSongs(catalog: Catalog, onProgress: (progress: DownloadProgress) => void): Promise<void> {
  await cacheCatalog(catalog);
  await downloadItems(catalog.songs.map((song) => ({ path: song.chordProPath, label: song.title, bytes: song.contentBytes })), 'songs', catalog.version, onProgress);
}

export async function downloadAllScores(catalog: Catalog, onProgress: (progress: DownloadProgress) => void): Promise<void> {
  const items = catalog.songs.flatMap((song) => song.scoreAssets.map((asset) => ({ path: asset.path, label: `${song.title} – ${asset.instrument}`, bytes: asset.byteSize })));
  const estimatedBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  onProgress({ completed: 0, total: items.length, downloadedBytes: 0, estimatedBytes, currentLabel: 'Připravuji vykreslování not…' });
  await import('opensheetmusicdisplay');
  if (items.some((item) => item.path.toLowerCase().endsWith('.mxl'))) await import('jszip');
  await downloadItems(items, 'scores', catalog.version, onProgress);
}

async function countCached(cache: Cache, urls: string[]): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  for (const url of urls) {
    const response = await cache.match(url);
    if (!response) continue;
    const size = (await response.clone().arrayBuffer()).byteLength;
    if (size > 0) {
      count += 1;
      bytes += size;
    }
  }
  return { count, bytes };
}

export async function inspectOfflineContent(catalog: Catalog): Promise<OfflineContentStats> {
  const totalScores = catalog.songs.reduce((sum, song) => sum + song.scoreAssets.length, 0);
  if (!cacheAvailable()) return { supported: false, serviceWorkerActive: false, catalogCached: false, downloadedSongs: 0, totalSongs: catalog.songs.length, downloadedScores: 0, totalScores, bytes: 0, allSongsVerified: false, allScoresVerified: false, lastUpdated: null };
  const songCache = await caches.open(cacheName('songs', catalog.version));
  const scoreCache = await caches.open(cacheName('scores', catalog.version));
  const songStats = await countCached(songCache, catalog.songs.map((song) => resolvePublicPath(song.chordProPath)));
  const scoreStats = await countCached(scoreCache, catalog.songs.flatMap((song) => song.scoreAssets.map((asset) => resolvePublicPath(asset.path))));
  const catalogCached = Boolean(await (await caches.open(CATALOG_CACHE)).match(resolvePublicPath('content/catalog.json')));
  let lastUpdated: string | null;
  try {
    const response = await (await caches.open(META_CACHE)).match(resolvePublicPath('offline-metadata.json'));
    lastUpdated = response ? String((await response.json() as { updatedAt?: string }).updatedAt ?? '') || null : null;
  } catch {
    lastUpdated = null;
  }
  const serviceWorkerActive = Boolean(navigator.serviceWorker?.controller);
  return {
    supported: true,
    serviceWorkerActive,
    catalogCached,
    downloadedSongs: songStats.count,
    totalSongs: catalog.songs.length,
    downloadedScores: scoreStats.count,
    totalScores,
    bytes: songStats.bytes + scoreStats.bytes,
    allSongsVerified: serviceWorkerActive && catalogCached && songStats.count === catalog.songs.length,
    allScoresVerified: totalScores > 0 && scoreStats.count === totalScores,
    lastUpdated,
  };
}

export async function removeScores(catalog: Catalog): Promise<void> {
  if (!cacheAvailable()) return;
  await caches.delete(cacheName('scores', catalog.version));
  await markUpdated();
}

export async function removeAllOfflineContent(): Promise<void> {
  if (!cacheAvailable()) return;
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
}
