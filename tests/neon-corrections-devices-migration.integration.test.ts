import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('neon/migrations/202608120004_corrections_devices_admin.sql', 'utf8').toLowerCase();
const secureClient = readFileSync('src/auth/secureAccess.ts', 'utf8');

describe('Neon migrace oprav a zařízení', () => {
  it('používá formát kompatibilní s Neon migračním parserem', () => {
    expect(migration).not.toContain('$$');
    expect(migration).not.toMatch(/^\s*do\s/m);
    expect(migration).not.toContain('language plpgsql');
    expect(migration).not.toMatch(/^\s*--.*;/m);
    const functionBodies = [...migration.matchAll(/as '\n([\s\S]*?)\n';/g)].map((match) => match[1]);
    expect(functionBodies).toHaveLength(5);
    expect(functionBodies.every((body) => !body.includes(';'))).toBe(true);
  });

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
    expect(migration).toContain('and public.is_app_admin()');
    expect(migration).toContain('(target_user_id = public.current_app_profile_id() or public.is_app_admin())');
    expect(migration).toContain('create or replace function public.set_account_status');
  });

  it('klient odmítne prázdný nebo neúspěšný výsledek privilegovaného RPC', () => {
    expect(secureClient).toContain("neonRpc<boolean>('set_account_status'");
    expect(secureClient).toContain("neonRpc<boolean>('register_my_device'");
    expect(secureClient).toContain("neonRpc<boolean>('revoke_device'");
    expect(secureClient).toContain("neonRpc<boolean>('review_song_correction'");
    expect(secureClient.match(/!== true/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('vede append-only audit každého rozhodnutí o opravě', () => {
    expect(migration).toContain("history = history || jsonb_build_array");
    expect(migration).toContain("''from'', status, ''to'', decision");
  });
});
