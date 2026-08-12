import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('neon/migrations/202608120002_shared_setlists.sql', 'utf8').toLowerCase();

describe('Neon migrace členských setlistů', () => {
  it('ukládá pouze identifikátory písní a zapíná vynucené RLS', () => {
    expect(migration).toContain('create table if not exists public.shared_setlists');
    expect(migration).toContain('song_ids jsonb not null');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('force row level security');
    expect(migration).not.toMatch(/lyrics|chordpro|song_content|data_base64/);
  });

  it('zpřístupní seznam jen schváleným členům', () => {
    expect(migration).toContain('create or replace function public.list_shared_setlists()');
    expect(migration).toContain('where public.is_approved_member()');
    expect(migration).toContain('profile.status = \'approved\'');
  });

  it('dovolí úpravu a odstranění vlastníkovi nebo administrátorovi', () => {
    expect(migration).toContain('owner_id = public.current_app_profile_id() or public.is_app_admin()');
    expect(migration).toContain('create or replace function public.update_shared_setlist');
    expect(migration).toContain('create or replace function public.delete_shared_setlist');
  });

  it('nepovolí přímý zápis do tabulky aplikační roli', () => {
    expect(migration).toContain('revoke all on public.shared_setlists from public, anonymous, authenticated');
    expect(migration).toContain('grant select on public.shared_setlists to authenticated');
    expect(migration).not.toContain('grant insert on public.shared_setlists');
  });
});
