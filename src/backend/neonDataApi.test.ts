import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeonDataApiError, neonDataRequest } from './neonDataApi';

describe('Neon Data API klient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posílá pouze uživatelský bearer token a parametrizovaný dotaz', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '1' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await neonDataRequest('profiles', 'public-user-jwt', { query: { id: 'eq.1', select: 'id' }, baseUrl: 'https://example.neon.tech/rest/v1' });

    const [url, request] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toMatch(/\/profiles$/);
    expect(url.searchParams.get('id')).toBe('eq.1');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer public-user-jwt' });
    expect(JSON.stringify(request)).not.toMatch(/DATABASE_URL|postgresql:\/\//i);
  });

  it('odmítne chybějící token ještě před síťovým požadavkem', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(neonDataRequest('profiles', '', { baseUrl: 'https://example.neon.tech/rest/v1' })).rejects.toMatchObject({ status: 401 } satisfies Partial<NeonDataApiError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('zachová bezpečný HTTP status a databázový kód chyby', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'forbidden', code: '42501' }), { status: 403 })));
    await expect(neonDataRequest('profiles', 'token', { baseUrl: 'https://example.neon.tech/rest/v1' })).rejects.toMatchObject({ status: 403, code: '42501' } satisfies Partial<NeonDataApiError>);
  });

  it.each([
    ['text/plain', 'text/plain; charset=utf-8'],
    ['vendor JSON', 'application/vnd.pgrst.array+json'],
    ['velká písmena MIME', 'Application/JSON; charset=utf-8'],
    ['chybějící Content-Type', undefined],
  ])('přijme platné JSON tělo při %s', async (_label, contentType) => {
    const rows = [{ id: 'synthetic-profile' }];
    // Byte body prevents Response from adding its default text/plain header.
    const response = new Response(new TextEncoder().encode(JSON.stringify(rows)), {
      status: 200,
      headers: contentType ? { 'Content-Type': contentType } : {},
    });
    if (!contentType) expect(response.headers.has('content-type')).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(neonDataRequest('profiles', 'token', { baseUrl: 'https://example.neon.tech/rest/v1' })).resolves.toEqual(rows);
  });

  it.each([200, 201, 204])('přijme úspěšnou odpověď %i bez těla a bez Content-Type', async (status) => {
    const response = new Response(null, { status });
    expect(response.headers.has('content-type')).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(neonDataRequest('user_app_state', 'token', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { state: {} },
      baseUrl: 'https://example.neon.tech/rest/v1',
    })).resolves.toBeNull();
  });

  it.each([
    ['HTML', '<!doctype html><html><body>Syntetická odpověď</body></html>', 'text/html'],
    ['HTML s chybnou JSON hlavičkou', '<html>Syntetická odpověď</html>', 'application/json'],
    ['vadné JSON', '{"id":', 'application/json'],
  ])('odmítne %s bezpečnou chybou klienta', async (_label, body, contentType) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Type': contentType },
    })));

    const result = neonDataRequest('profiles', 'token', { baseUrl: 'https://example.neon.tech/rest/v1' });
    await expect(result).rejects.toBeInstanceOf(NeonDataApiError);
    await expect(result).rejects.toMatchObject({
      status: 200,
      code: 'api_not_json',
      message: 'Neon Data API nevrátilo JSON.',
    } satisfies Partial<NeonDataApiError>);
  });
});
