import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('neon/migrations/202608120004_corrections_devices_admin.sql', 'utf8').toLowerCase();

describe('Neon migrace oprav a zařízení', () => {
  it('neukládá celé texty ani ChordPro obsah písní', () => {
    expect(migration).toContain('create table if not exists public.song_corrections');
    expect(migration).toContain('original_value text');
    expect(migration).toContain('proposed_value text');
    expect(migration).not.toMatch(/lyrics|chordpro|song_content|data_base64/);
  });

  it('vynucuje RLS a nepovoluje přímý zápis aplikační roli', () => {
    expect(migration).toContain('alter table public.song_corrections force row level security');
    expect(migration).toContain('alter table public.user_devices force row level security');
    expect(migration).toContain('revoke all on public.song_corrections, public.user_devices from public, anonymous, authenticated');
    expect(migration).not.toMatch(/grant (insert|update|delete) on public\.(song_corrections|user_devices)/);
  });

  it('omezuje rozhodnutí, zařízení a účty na vlastníka nebo administrátora', () => {
    expect(migration).toContain('if not public.is_app_admin()');
    expect(migration).toContain('target_user_id <> public.current_app_profile_id() and not public.is_app_admin()');
    expect(migration).toContain('create or replace function public.set_account_status');
  });

  it('vede append-only audit každého rozhodnutí o opravě', () => {
    expect(migration).toContain("history = history || jsonb_build_array");
    expect(migration).toContain("'from', previous_status, 'to', decision");
  });
});
