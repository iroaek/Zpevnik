import { neonDataApiUrl } from './neonClient';

export const neonDataApiConfigured = Boolean(neonDataApiUrl);

export class NeonDataApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'NeonDataApiError';
  }
}

interface NeonRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, string>;
  body?: unknown;
  prefer?: string;
  baseUrl?: string;
}

function endpoint(path: string, query?: Record<string, string>, baseUrl = neonDataApiUrl): URL {
  if (!baseUrl) throw new NeonDataApiError('Neon Data API není nakonfigurované.', 503, 'neon_not_configured');
  if (!/^[a-z0-9_/-]+$/i.test(path)) throw new NeonDataApiError('Neplatná cesta Neon Data API.', 400, 'invalid_path');
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  return url;
}

function errorDetails(value: unknown): { message: string; code?: string } {
  if (!value || typeof value !== 'object') return { message: 'Neon Data API požadavek selhal.' };
  const record = value as Record<string, unknown>;
  return {
    message: typeof record.message === 'string' ? record.message : 'Neon Data API požadavek selhal.',
    code: typeof record.code === 'string' ? record.code : undefined,
  };
}

export async function neonDataRequest<T>(path: string, accessToken: string, options: NeonRequestOptions = {}): Promise<T> {
  if (!accessToken) throw new NeonDataApiError('Pro Neon Data API je nutné přihlášení.', 401, 'missing_access_token');
  const response = await fetch(endpoint(path, options.query, options.baseUrl), {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    let parsed: unknown = null;
    try { parsed = await response.json(); } catch { /* Odpověď bez JSON těla. */ }
    const details = errorDetails(parsed);
    throw new NeonDataApiError(details.message, response.status, details.code);
  }
  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function neonSelect<T>(table: string, accessToken: string, query: Record<string, string>): Promise<T[]> {
  return neonDataRequest<T[]>(table, accessToken, { query });
}

export function neonInsert<T>(table: string, accessToken: string, row: unknown): Promise<T[]> {
  return neonDataRequest<T[]>(table, accessToken, {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
  });
}

export function neonUpsert(table: string, accessToken: string, row: unknown, onConflict: string): Promise<null> {
  return neonDataRequest<null>(table, accessToken, {
    method: 'POST',
    query: { on_conflict: onConflict },
    body: row,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

export function neonRpc<T>(functionName: string, accessToken: string, body: Record<string, unknown> = {}): Promise<T> {
  return neonDataRequest<T>(`rpc/${functionName}`, accessToken, { method: 'POST', body });
}
