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
});
