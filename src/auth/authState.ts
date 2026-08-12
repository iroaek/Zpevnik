export type AuthState =
  | { status: 'checking' }
  | { status: 'authenticated-online'; userId: string }
  | {
      status: 'authenticated-offline';
      userId: string;
      offlineValidUntil: string;
      contentVersion: string;
    }
  | { status: 'offline-access-expired'; expiredAt?: string }
  | { status: 'unauthenticated'; reason?: string };

export type AuthFailureKind =
  | 'network'
  | 'timeout'
  | 'server-unavailable'
  | 'session-invalid'
  | 'access-forbidden'
  | 'access-revoked'
  | 'unknown';

export interface AuthFailure {
  kind: AuthFailureKind;
  status?: number;
  code?: string;
  message: string;
}

interface ErrorLike {
  name?: string;
  message?: string;
  status?: number;
  statusCode?: number;
  code?: unknown;
}

const NETWORK_PATTERNS = [
  'failed to fetch',
  'fetch failed',
  'network request failed',
  'networkerror',
  'load failed',
  'internet connection',
  'dns',
  'econnrefused',
  'enotfound',
  'connection reset',
];

export function classifyAuthError(error: unknown): AuthFailure {
  const candidate = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike;
  const message = candidate.message || (typeof error === 'string' ? error : 'Neznámá chyba ověření účtu.');
  const normalized = message.toLowerCase();
  const status = candidate.status ?? candidate.statusCode;
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : undefined;

  if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError' || normalized.includes('timeout') || normalized.includes('timed out')) {
    return { kind: 'timeout', status, code, message };
  }
  if (status === 0 || NETWORK_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return { kind: 'network', status, code, message };
  }
  if (typeof status === 'number' && status >= 500) {
    return { kind: 'server-unavailable', status, code, message };
  }
  if (normalized.includes('authentication required') || normalized.includes('email claim required')) {
    return { kind: 'session-invalid', status, code, message };
  }
  if (code === 'account_revoked' || code === 'account_suspended' || normalized.includes('explicit access revoked')) {
    return { kind: 'access-revoked', status, code, message };
  }
  if (status === 401 || code === 'session_not_found' || code === 'refresh_token_not_found' || code === 'refresh_token_already_used') {
    return { kind: 'session-invalid', status, code, message };
  }
  if (status === 403) return { kind: 'access-forbidden', status, code, message };
  return { kind: 'unknown', status, code, message };
}

export function isTemporaryAuthFailure(failure: AuthFailure): boolean {
  return failure.kind === 'network'
    || failure.kind === 'timeout'
    || failure.kind === 'server-unavailable'
    || failure.kind === 'session-invalid'
    || failure.kind === 'access-forbidden';
}

export interface OfflineGrantSummary {
  userId: string;
  offlineValidUntil: string;
  contentVersion: string;
}

export function offlineAuthState(grant: OfflineGrantSummary, now = Date.now()): AuthState {
  const expiresAt = Date.parse(grant.offlineValidUntil);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { status: 'offline-access-expired', expiredAt: grant.offlineValidUntil };
  }
  return {
    status: 'authenticated-offline',
    userId: grant.userId,
    offlineValidUntil: grant.offlineValidUntil,
    contentVersion: grant.contentVersion,
  };
}

export function resolveAuthFailure(failure: AuthFailure, grant: OfflineGrantSummary | null, now = Date.now()): AuthState {
  if (failure.kind === 'access-revoked') return { status: 'unauthenticated', reason: 'Přístup byl serverem výslovně zrušen.' };
  if (grant && isTemporaryAuthFailure(failure)) return offlineAuthState(grant, now);
  if (grant) {
    const fallback = offlineAuthState(grant, now);
    if (fallback.status === 'offline-access-expired') return fallback;
  }
  return { status: 'unauthenticated', reason: failure.message };
}
