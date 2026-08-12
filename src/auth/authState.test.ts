import { describe, expect, it } from 'vitest';
import { classifyAuthError, offlineAuthState, resolveAuthFailure, type OfflineGrantSummary } from './authState';

const now = Date.parse('2026-08-11T12:00:00.000Z');
const validGrant: OfflineGrantSummary = {
  userId: '11111111-1111-4111-8111-111111111111',
  offlineValidUntil: '2026-09-10T12:00:00.000Z',
  contentVersion: 'abc123def456',
};

describe('auth stavový automat', () => {
  it.each([
    ['fetch network error', new TypeError('Failed to fetch'), 'network'],
    ['DNS-like chyba', new Error('getaddrinfo ENOTFOUND auth.example'), 'network'],
    ['timeout', new DOMException('Timed out', 'AbortError'), 'timeout'],
    ['HTTP 500', { status: 500, message: 'Internal server error' }, 'server-unavailable'],
    ['HTTP 503', { status: 503, message: 'Service unavailable' }, 'server-unavailable'],
    ['HTTP 401', { status: 401, message: 'JWT expired' }, 'session-invalid'],
    ['chybějící přihlášení z Data API', { status: 400, message: 'authentication required' }, 'session-invalid'],
    ['HTTP 403', { status: 403, message: 'Forbidden' }, 'access-forbidden'],
    ['explicitní revokace', { status: 403, code: 'account_revoked', message: 'explicit access revoked' }, 'access-revoked'],
  ])('rozliší %s', (_label, error, kind) => {
    expect(classifyAuthError(error).kind).toBe(kind);
  });

  it.each([
    ['network', new TypeError('Failed to fetch')],
    ['timeout', new DOMException('Timeout', 'AbortError')],
    ['HTTP 500', { status: 500, message: 'Server error' }],
    ['HTTP 503', { status: 503, message: 'Unavailable' }],
    ['vypršená online session bez potvrzené revokace', { status: 401, message: 'JWT expired' }],
    ['HTTP 403 bez potvrzené revokace', { status: 403, message: 'Forbidden' }],
  ])('při %s zachová platný offline přístup', (_label, error) => {
    expect(resolveAuthFailure(classifyAuthError(error), validGrant, now)).toMatchObject({
      status: 'authenticated-offline',
      userId: validGrant.userId,
    });
  });

  it('platný online výsledek má explicitní online stav', () => {
    expect({ status: 'authenticated-online', userId: validGrant.userId }).toMatchObject({ status: 'authenticated-online' });
  });

  it('platný grant povolí offline cold start', () => {
    expect(offlineAuthState(validGrant, now)).toMatchObject({ status: 'authenticated-offline' });
  });

  it('vypršený grant přístup odmítne', () => {
    expect(offlineAuthState({ ...validGrant, offlineValidUntil: '2026-08-10T00:00:00.000Z' }, now)).toMatchObject({ status: 'offline-access-expired' });
  });

  it('explicitní revokace nepoužije ani dosud platný grant', () => {
    const state = resolveAuthFailure(classifyAuthError({ status: 403, code: 'account_revoked', message: 'explicit access revoked' }), validGrant, now);
    expect(state.status).toBe('unauthenticated');
  });

  it('ruční logout reprezentuje stav bez oprávnění', () => {
    expect({ status: 'unauthenticated', reason: 'manual-sign-out' }).toMatchObject({ status: 'unauthenticated' });
  });

  it('obnovení internetu může přejít zpět do online stavu', () => {
    const offline = offlineAuthState(validGrant, now);
    expect(offline.status).toBe('authenticated-offline');
    expect({ status: 'authenticated-online', userId: validGrant.userId }).toMatchObject({ status: 'authenticated-online' });
  });

  it('bez grantu síťová chyba nesmí předstírat oprávnění', () => {
    expect(resolveAuthFailure(classifyAuthError(new TypeError('Failed to fetch')), null, now).status).toBe('unauthenticated');
  });
});
