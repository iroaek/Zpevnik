import { describe, expect, it } from 'vitest';
import { friendlyError } from './friendlyError';

describe('uživatelské chybové hlášky', () => {
  it('přeloží technickou síťovou chybu do češtiny', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/Server je momentálně nedostupný/);
  });

  it('nesdělí uživateli surový databázový detail', () => {
    const message = friendlyError('{"code":"42501","details":"private"}', 'Bezpečná náhradní hláška.');
    expect(message).toMatch(/nemáte oprávnění/);
    expect(message).not.toContain('42501');
    expect(message).not.toContain('private');
  });
});
