import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { inspectAppShell } from './appShell';

afterEach(() => { vi.unstubAllGlobals(); document.querySelectorAll('script').forEach(node => node.remove()); });
describe('ověření lokální aplikace', () => {
  async function fixture(missing = false, corrupt = false) {
    const body = new TextEncoder().encode('synthetic app');
    const hash = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', body)), byte => byte.toString(16).padStart(2, '0')).join('');
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
    const match = vi.fn(async (url: string) => url.endsWith('app-shell.json')
      ? new Response(JSON.stringify({ resources: [{ path: 'synthetic.js', sha256: hash }] }))
      : missing ? undefined : new Response(corrupt ? 'altered' : body));
    vi.stubGlobal('caches', { keys: async () => ['workbox-precache-test'], open: async () => ({ match }) });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    return fetch;
  }
  it('bez kontrolované cache neslibuje připravenost', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
    expect((await inspectAppShell()).status).toBe('unverified');
  });
  it('ověří skutečné bajty bez stahování ze sítě', async () => {
    const fetch = await fixture();
    expect(await inspectAppShell()).toMatchObject({ status: 'verified', missing: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([[true, false], [false, true]])('odhalí chybějící nebo změněný soubor (%s, %s)', async (missing, corrupt) => {
    await fixture(missing, corrupt);
    expect(await inspectAppShell()).toMatchObject({ status: 'missing', missing: 1 });
  });
  it('odmítne inventář jiné verze než aktuální vstupní skript', async () => {
    await fixture();
    const script = document.createElement('script'); script.type = 'module'; script.src = '/different.js'; document.head.append(script);
    expect((await inspectAppShell()).status).toBe('unverified');
  });
});
