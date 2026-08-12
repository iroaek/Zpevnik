import { createClient } from '@neondatabase/neon-js';

export const neonAuthUrl = import.meta.env.VITE_NEON_AUTH_URL?.trim().replace(/\/+$/, '') ?? '';
export const neonDataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL?.trim().replace(/\/+$/, '') ?? '';
export const neonClientConfigured = Boolean(neonAuthUrl && neonDataApiUrl);

export const neonAuthIssuer = (() => {
  try {
    return neonAuthUrl ? new URL(neonAuthUrl).origin : '';
  } catch {
    return '';
  }
})();

export const neonAuthJwksUrl = neonAuthUrl ? `${neonAuthUrl}/.well-known/jwks.json` : '';

export const neonClient = neonClientConfigured
  ? createClient({
      auth: { url: neonAuthUrl },
      dataApi: { url: neonDataApiUrl },
    })
  : null;

export function requireNeonClient(): NonNullable<typeof neonClient> {
  if (!neonClient) throw new Error('Neon Auth nebo Neon Data API nejsou nakonfigurované.');
  return neonClient;
}
