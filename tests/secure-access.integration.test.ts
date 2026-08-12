// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const base = readFileSync(resolve('neon/migrations/202608110001_application_schema.sql'), 'utf8');
const cutover = readFileSync(resolve('neon/migrations/202608120001_neon_auth_content.sql'), 'utf8');

describe('Neon serverová pravidla soukromého přístupu', () => {
  it('nový účet zůstane čekající a starý profil převezme jen ověřený Neon e-mail', () => {
    expect(base).toContain("status public.account_status not null default 'pending'");
    expect(cutover).toContain('public.current_app_email_verified()');
    expect(cutover).toContain('where lower(email) = current_email and auth_user_id is null');
    expect(cutover).toContain("values (current_id, current_id, current_email, normalized_name, 'pending', 'member')");
    expect(cutover).toContain('if not public.is_app_admin() then');
  });

  it('ukládá soukromé balíčky i jejich části výhradně do Neonu pod RLS', () => {
    expect(cutover).toContain('create table if not exists public.content_packages');
    expect(cutover).toContain('create table if not exists public.content_package_chunks');
    expect(cutover).toContain("scope in ('members', 'admin')");
    expect(cutover).toContain('content_packages_authorized_read');
    expect(cutover).not.toContain('storage.objects');
  });

  it('každý návrh zůstává ke kontrole a soubor se aktivuje až po všech částech', () => {
    expect(base).toContain("rights_status text not null default 'requires_review'");
    expect(base).toContain("status public.song_submission_status not null default 'pending_review'");
    expect(cutover).toContain('complete_my_song_upload');
    expect(cutover).toContain('actual_chunks <> expected_chunks or actual_bytes <> expected_bytes');
    expect(cutover).not.toContain("decision not in ('published'");
  });

  it('online aktivitu i synchronizaci váže na stabilní profil přihlášeného Neon uživatele', () => {
    expect(cutover).toContain('public.current_app_profile_id()');
    expect(cutover).toContain('where id = public.current_app_profile_id()');
    expect(cutover).toMatch(/user_app_state_own[\s\S]*user_id = public\.current_app_profile_id\(\)/);
    expect(cutover).not.toContain('song_content');
  });
});
