import path from 'node:path';
import { loadEnv } from 'vite';

export function getPublicBaseUrl(root = process.cwd()): URL {
  const environment = loadEnv('production', root, '');
  const configured = process.env.VITE_PUBLIC_BASE_URL || process.env.CF_PAGES_URL || environment.VITE_PUBLIC_BASE_URL || 'https://zpevnik.example.invalid/';
  const url = new URL(configured);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_PUBLIC_BASE_URL musí být čistá HTTP(S) adresa bez přihlašovacích údajů, parametrů a fragmentu.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

export function basePathFromUrl(url: URL): string {
  return path.posix.normalize(`/${url.pathname}/`).replace(/\/{2,}/g, '/');
}
