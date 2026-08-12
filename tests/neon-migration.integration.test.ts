import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('neon/migrations/202608110001_application_schema.sql', 'utf8').toLowerCase();

describe('Neon schéma a RLS', () => {
  it('nepřenáší Supabase auth ani storage schéma', () => {
    expect(migration).not.toContain('references auth.users');
    expect(migration).not.toContain('storage.objects');
    expect(migration).not.toContain('storage.buckets');
  });

  it('odvozuje identitu z Neon Data API JWT a vynucuje RLS', () => {
    expect(migration).toContain('auth.user_id()');
    expect(migration).toContain("nullif(auth.user_id()::text, '')::uuid");
    expect(migration).toMatch(/current_app_user_id\(\)[\s\S]*security definer/);
    expect(migration).toMatch(/current_app_email\(\)[\s\S]*security definer/);
    for (const table of ['profiles', 'song_submissions', 'user_app_state', 'offline_grant_audit']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).not.toContain('grant insert on public.offline_grant_audit');
  });

  it('nedovolí klientovi přidělit schválení ani administrátorskou roli', () => {
    expect(migration).toContain("auth.session() ->> 'email'");
    expect(migration).toContain("values (current_id, current_email, normalized_name, 'pending', 'member')");
    expect(migration).toContain('administrator access required');
    expect(migration).not.toContain('grant insert on public.profiles to authenticated');
  });

  it('odděluje stav uživatelů a návrhy pomocí current_app_user_id', () => {
    expect(migration).toMatch(/user_app_state_own[\s\S]*user_id = public\.current_app_user_id\(\)/);
    expect(migration).toMatch(/submissions_create_approved_member[\s\S]*public\.is_approved_member\(\)/);
    expect(migration).toContain("rights_status = 'requires_review'");
  });

  it('audituje offline grant bez tokenu a surového identifikátoru zařízení', () => {
    expect(migration).toContain('device_hash text not null');
    expect(migration).toContain('content_package text not null');
    expect(migration).not.toContain('device_id text not null');
    expect(migration).not.toContain('grant insert on public.offline_grant_audit');
  });
});
