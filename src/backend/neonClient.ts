import { BetterAuthVanillaAdapter, createClient } from '@neondatabase/neon-js';

interface PendingNeonAuthJwt {
  token: string;
  userId: string;
}

let pendingNeonAuthJwt: PendingNeonAuthJwt | null = null;

function responseUserId(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('user' in data)) return null;
  const user = (data as { user?: unknown }).user;
  if (!user || typeof user !== 'object' || !('id' in user)) return null;
  return typeof (user as { id?: unknown }).id === 'string' ? (user as { id: string }).id : null;
}

const neonAuthAdapter = BetterAuthVanillaAdapter({
  fetchOptions: {
    onSuccess(context) {
      const path = new URL(context.request.url).pathname;
      if (!path.endsWith('/sign-in/email') && !path.endsWith('/sign-in/email-otp')) return;
      const token = context.response.headers.get('set-auth-jwt');
      const userId = responseUserId(context.data);
      if (token && userId) pendingNeonAuthJwt = { token, userId };
    },
  },
});

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
      auth: { url: neonAuthUrl, adapter: neonAuthAdapter },
      dataApi: { url: neonDataApiUrl },
    })
  : null;

export function clearPendingNeonAuthJwt(): void {
  pendingNeonAuthJwt = null;
}

export function consumePendingNeonAuthJwt(userId: string): string | null {
  const pending = pendingNeonAuthJwt;
  pendingNeonAuthJwt = null;
  return pending?.userId === userId ? pending.token : null;
}

export function requireNeonClient(): NonNullable<typeof neonClient> {
  if (!neonClient) throw new Error('Neon Auth nebo Neon Data API nejsou nakonfigurované.');
  return neonClient;
}
