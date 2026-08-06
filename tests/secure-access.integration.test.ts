// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve('supabase/migrations/202608060001_private_members.sql'), 'utf8');

describe('serverová pravidla soukromého přístupu', () => {
  it('vytváří účet jako čekající a schválení dovolí jen serverově ověřenému administrátorovi', () => {
    expect(migration).toContain("status public.account_status not null default 'pending'");
    expect(migration).toContain('if not public.is_app_admin() then');
    expect(migration).toContain("if target_user_id = (select auth.uid()) then");
    expect(migration).toContain('revoke all on function public.review_account(uuid, text) from public');
  });

  it('má privátní buckety a členské stahování podmíněné schválením', () => {
    expect(migration).toContain("('song-library', 'song-library', false");
    expect(migration).toContain("('song-submissions', 'song-submissions', false");
    expect(migration).toContain("(storage.foldername(name))[1] = 'members' and public.is_approved_member()");
  });

  it('každý uživatelský návrh ponechá ke kontrole a nikdy jej automaticky nepublikuje', () => {
    expect(migration).toContain("rights_status text not null default 'requires_review'");
    expect(migration).toContain("status public.song_submission_status not null default 'pending_review'");
    expect(migration).toContain("decision not in ('accepted_for_review', 'rejected')");
    expect(migration).not.toContain("decision not in ('published'");
  });
});
