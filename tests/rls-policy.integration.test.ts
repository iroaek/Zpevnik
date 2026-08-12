// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve('neon/migrations/202608120001_neon_auth_content.sql'), 'utf8');

describe('statický audit Neon PostgreSQL RLS', () => {
  it('anonymous nemá grant na profily, stav, balíčky ani soubory', () => {
    expect(migration).toContain('revoke all on public.content_packages, public.content_package_chunks, public.song_submission_files from public, anonymous, authenticated');
    expect(migration).toContain('alter table public.content_packages force row level security');
    expect(migration).toContain('alter table public.content_package_chunks force row level security');
    expect(migration).toContain('alter table public.song_submission_files force row level security');
  });

  it('uživatel A čte a zapisuje pouze data svého stabilního profilu', () => {
    expect(migration).toMatch(/user_app_state_own[\s\S]*using \(user_id = public\.current_app_profile_id\(\)/);
    expect(migration).toMatch(/user_app_state_own[\s\S]*with check \(user_id = public\.current_app_profile_id\(\)/);
    expect(migration).toMatch(/submissions_create_approved_member[\s\S]*user_id = public\.current_app_profile_id\(\)/);
  });

  it('neschválený účet nezíská členský obsah', () => {
    expect(migration).toContain('public.is_approved_member()');
    expect(migration).toMatch(/content_packages_authorized_read[\s\S]*public\.is_approved_member\(\)/);
    expect(migration).toMatch(/content_package_chunks_authorized_read[\s\S]*public\.is_approved_member\(\)/);
  });

  it('admin oprávnění je odvozené serverově a klient nedostává databázové tajemství', () => {
    expect(migration).toContain('public.is_app_admin()');
    expect(migration).toContain("status = 'approved' and role = 'admin'");
    expect(migration).not.toMatch(/service_role|database_url|private_key|private_jwk/i);
  });
});
