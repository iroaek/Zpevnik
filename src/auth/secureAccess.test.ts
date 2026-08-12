import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { databaseTimestampSchema, secureProfileSchema } from './secureAccess';

describe('časové údaje z Neon Data API', () => {
  it('přijme PostgreSQL timestamptz s časovým posunem a mikrosekundami', () => {
    const createdAt = '2026-08-06T14:18:44.123456+00:00';
    const reviewedAt = '2026-08-06T14:20:01.987654+02:00';

    expect(databaseTimestampSchema.parse(createdAt)).toBe(createdAt);
    expect(secureProfileSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'spravce@example.test',
      display_name: 'Správce',
      status: 'approved',
      role: 'admin',
      created_at: createdAt,
      reviewed_at: reviewedAt,
      last_seen_at: createdAt,
    })).toMatchObject({ created_at: createdAt, reviewed_at: reviewedAt, last_seen_at: createdAt });
  });

  it('nadále přijme čas v UTC zakončený Z', () => {
    expect(databaseTimestampSchema.parse('2026-08-06T14:18:44.123Z')).toBe('2026-08-06T14:18:44.123Z');
  });
});
