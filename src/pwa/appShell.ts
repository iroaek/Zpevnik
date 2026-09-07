import { resolvePublicPath } from './paths';

export interface AppShellInspection {
  status: 'verified' | 'missing' | 'unverified';
  checkedAt: string;
  missing: number;
}

/** Read only: verify this build's shell in Workbox precache, never fetch to pass a check. */
export async function inspectAppShell(): Promise<AppShellInspection> {
  const checkedAt = new Date().toISOString();
  const unknown: AppShellInspection = { status: 'unverified', checkedAt, missing: 0 };
  if (!navigator.serviceWorker?.controller || !globalThis.caches || !crypto.subtle) return unknown;
  try {
    const names = (await caches.keys()).filter((name) => name.includes('precache'));
    const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
    for (const name of names.reverse()) {
      const cache = await caches.open(name);
      const match = (path: string) => cache.match(resolvePublicPath(path), { ignoreSearch: true });
      const inventory = await match('app-shell.json');
      if (!inventory?.ok) continue;
      const data: unknown = await inventory.json();
      if (!data || typeof data !== 'object' || !('resources' in data) || !Array.isArray(data.resources) || !data.resources.length) continue;
      const resources = data.resources as Array<{ path: string; sha256: string }>;
      if (resources.some((item) => typeof item.path !== 'string' || typeof item.sha256 !== 'string' || item.path.includes('..') || item.path.startsWith('/') || item.path.includes(':'))) continue;
      if (entry && !resources.some((item) => new URL(resolvePublicPath(item.path), location.href).href === entry.src)) continue;
      const results = await Promise.all(resources.map(async (item) => {
        const response = await match(item.path);
        if (!response?.ok) return false;
        const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
        return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('') === item.sha256;
      }));
      const missing = results.filter((ok) => !ok).length;
      return { status: missing ? 'missing' : 'verified', checkedAt, missing };
    }
    return unknown;
  } catch { return unknown; }
}
