-- Audit vydaných offline oprávnění. Migrace je připravena pro staging;
-- samotné vydávání provádí Edge Function s privátním ES256 klíčem v secrets.

begin;

create table if not exists public.offline_grant_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  key_id text not null check (char_length(key_id) between 1 and 120),
  device_hash text not null check (device_hash ~ '^[a-f0-9]{64}$'),
  content_package text not null check (content_package in ('members', 'admin')),
  content_version text not null check (char_length(content_version) between 1 and 128),
  issued_at timestamptz not null,
  valid_until timestamptz not null,
  created_at timestamptz not null default now(),
  constraint offline_grant_time_order check (valid_until > issued_at)
);

create index if not exists offline_grant_audit_user_issued_idx
on public.offline_grant_audit (user_id, issued_at desc);

alter table public.offline_grant_audit enable row level security;
alter table public.offline_grant_audit force row level security;

create policy offline_grant_audit_admin_read
on public.offline_grant_audit for select to authenticated
using (public.is_app_admin());

revoke all on public.offline_grant_audit from anon, authenticated;
grant select on public.offline_grant_audit to authenticated;

comment on table public.offline_grant_audit is
  'Metadata vydaných offline grantů bez tokenů, klíčů a textů písní. INSERT provádí pouze serverová service role.';

commit;
