// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const members = readFileSync(resolve('supabase/migrations/202608060001_private_members.sql'), 'utf8');
const state = readFileSync(resolve('supabase/migrations/202608070001_user_state_sync.sql'), 'utf8');
const grants = readFileSync(resolve('supabase/migrations/202608110001_offline_grant_audit.sql'), 'utf8');

describe('statický audit PostgreSQL RLS', () => {
  it('anonymous nemá grant na chráněné tabulky ani privátní storage', () => {
    expect(members).toContain('revoke all on public.profiles from anon, authenticated');
    expect(members).toContain('revoke all on public.song_submissions from anon, authenticated');
    expect(members).toContain("('song-library', 'song-library', false");
    expect(state).toContain('revoke all on public.user_app_state from anon, authenticated');
  });

  it('uživatel A čte a zapisuje pouze svůj stav a nemůže nastavit user_id uživatele B', () => {
    expect(state).toContain('user_id = (select auth.uid())');
    expect(state).toMatch(/for update to authenticated[\s\S]*?using \([\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?with check \([\s\S]*?user_id = \(select auth\.uid\(\)\)/);
    expect(members).toContain('user_id = (select auth.uid())');
    expect(members).toContain('with check (\n  public.is_approved_member()');
  });

  it('neschválený nebo vypršený účet nezíská členský obsah', () => {
    expect(members).toContain("where id = (select auth.uid()) and status = 'approved'");
    expect(members).toContain("(storage.foldername(name))[1] = 'members' and public.is_approved_member()");
    expect(state).toContain('public.is_approved_member()');
  });

  it('admin přístup je serverově odvozený a není přidělen běžnému klientovi', () => {
    expect(members).toContain("status = 'approved' and role = 'admin'");
    expect(members).toContain('if not public.is_app_admin() then');
    expect(members).not.toMatch(/service_role[^\n]*VITE_/i);
  });

  it('audit offline grantů vynucuje RLS a neukládá token ani privátní klíč', () => {
    expect(grants).toContain('alter table public.offline_grant_audit force row level security');
    expect(grants).toContain('using (public.is_app_admin())');
    expect(grants).toContain('device_hash');
    expect(grants).not.toMatch(/token\s+text|private_key|private_jwk/i);
  });
});
