import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const handler = readFileSync('supabase/functions/offline-grant/index.ts', 'utf8');
const client = readFileSync('src/auth/secureAccess.ts', 'utf8');

describe('Neon vydávání offline oprávnění', () => {
  it('ověří Supabase relaci, ale čte autoritativní profil z Neonu', () => {
    expect(handler).toContain("Deno.env.get('DATA_BACKEND') === 'neon'");
    expect(handler).toContain("Deno.env.get('NEON_DATABASE_URL')");
    expect(handler).toContain('caller.auth.getUser()');
    expect(handler).toContain('from public.profiles');
    expect(handler).toContain('where id = ${userData.user.id}::uuid');
  });

  it('nikdy nevydá grant neschválenému nebo zablokovanému účtu', () => {
    expect(handler).toContain("profile.status === 'suspended' || profile.status === 'rejected'");
    expect(handler).toContain("profile.status !== 'approved'");
    expect(client).toContain("(data as { code?: unknown }).code === 'account_revoked'");
    expect(client).toContain("? 'account_revoked'");
  });

  it('zapisuje do Neonu pouze hash zařízení a neukládá token', () => {
    expect(handler).toContain('insert into public.offline_grant_audit');
    expect(handler).toContain('(user_id, key_id, device_hash, content_package, content_version, issued_at, valid_until)');
    expect(handler).toContain('const deviceHash = await sha256(deviceId)');
    const auditInsert = handler.match(/insert into public\.offline_grant_audit[\s\S]*?`;\n/)?.[0] ?? '';
    expect(auditInsert).not.toContain('token');
  });
});
