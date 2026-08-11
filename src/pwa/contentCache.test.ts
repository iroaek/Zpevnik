import { describe, expect, it } from 'vitest';
import { responseMatches } from './contentCache';

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

describe('integrita offline souborů', () => {
  it('přijme pouze správnou velikost a SHA-256', async () => {
    const text = 'Krátký syntetický obsah';
    const bytes = new TextEncoder().encode(text).byteLength;
    await expect(responseMatches(new Response(text), bytes, await sha256(text))).resolves.toBe(true);
  });

  it('odmítne poškozený obsah, chybnou velikost a prázdný soubor', async () => {
    const expected = await sha256('Původní syntetický obsah');
    await expect(responseMatches(new Response('Pozměněný obsah'), 17, expected)).resolves.toBe(false);
    await expect(responseMatches(new Response('Obsah'), 100)).resolves.toBe(false);
    await expect(responseMatches(new Response(''), 0)).resolves.toBe(false);
  });
});
