-- Neon Postgres + Data API schema pro Český zpěvník.
-- Před spuštěním zapněte Neon Data API s ověřováním stávajícího JWT/JWKS.
-- Soubor neobsahuje žádné tajné klíče ani objektové úložiště.

begin;

do $$ begin
  create type public.account_status as enum ('pending', 'approved', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.app_role as enum ('member', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.song_submission_kind as enum ('request', 'upload');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.song_submission_status as enum ('pending_review', 'accepted_for_review', 'rejected', 'published');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key,
  email text not null check (char_length(email) between 3 and 254),
  display_name text not null check (char_length(trim(display_name)) between 2 and 60),
  status public.account_status not null default 'pending',
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  last_seen_at timestamptz,
  constraint profile_review_consistency check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or status <> 'pending'
  )
);

create unique index if not exists profiles_email_lower_idx on public.profiles (lower(email));
create index if not exists profiles_status_created_idx on public.profiles (status, created_at);
create index if not exists profiles_last_seen_idx on public.profiles (last_seen_at desc) where last_seen_at is not null;

create table if not exists public.song_submissions (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.song_submission_kind not null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  artist text not null default '' check (char_length(artist) <= 160),
  notes text not null default '' check (char_length(notes) <= 2000),
  file_path text,
  file_name text check (file_name is null or char_length(file_name) <= 255),
  file_type text check (file_type is null or char_length(file_type) <= 120),
  file_size integer not null default 0 check (file_size between 0 and 26214400),
  rights_status text not null default 'requires_review' check (rights_status = 'requires_review'),
  license text not null default 'UNVERIFIED - requires admin review',
  attribution text not null,
  status public.song_submission_status not null default 'pending_review',
  admin_note text not null default '' check (char_length(admin_note) <= 2000),
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  constraint upload_requires_file check (kind <> 'upload' or (file_path is not null and file_name is not null and file_size > 0))
);

create index if not exists song_submissions_user_created_idx on public.song_submissions (user_id, created_at desc);
create index if not exists song_submissions_status_created_idx on public.song_submissions (status, created_at);

create table if not exists public.user_app_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_app_state_object check (jsonb_typeof(state) = 'object'),
  constraint user_app_state_size check (octet_length(state::text) <= 250000)
);

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

create index if not exists offline_grant_audit_user_created_idx on public.offline_grant_audit (user_id, created_at desc);

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select nullif(auth.user_id()::text, '')::uuid; $$;

create or replace function public.current_app_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select lower(left(trim(coalesce(auth.session() ->> 'email', '')), 254)); $$;

create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = public.current_app_user_id() and status = 'approved'
  );
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = public.current_app_user_id() and status = 'approved' and role = 'admin'
  );
$$;

create or replace function public.ensure_my_profile(requested_email text, requested_display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_id uuid := public.current_app_user_id();
  current_email text := public.current_app_email();
  normalized_name text := left(trim(coalesce(requested_display_name, '')), 60);
  result public.profiles;
begin
  if current_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(current_email) < 3 then
    raise exception 'verified email claim required' using errcode = '42501';
  end if;
  if char_length(normalized_name) < 2 then normalized_name := 'Nový člen'; end if;
  insert into public.profiles (id, email, display_name, status, role)
  values (current_id, current_email, normalized_name, 'pending', 'member')
  on conflict (id) do nothing;
  select * into result from public.profiles where id = current_id;
  return result;
end;
$$;

create or replace function public.touch_my_presence()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare touched_at timestamptz := clock_timestamp();
begin
  update public.profiles set last_seen_at = touched_at where id = public.current_app_user_id();
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  return touched_at;
end;
$$;

create or replace function public.review_account(target_user_id uuid, decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  if decision not in ('approved', 'rejected') then raise exception 'unsupported account decision' using errcode = '22023'; end if;
  if target_user_id = public.current_app_user_id() then raise exception 'administrator cannot review own account' using errcode = '22023'; end if;
  update public.profiles
  set status = decision::public.account_status, reviewed_at = now(), reviewed_by = public.current_app_user_id(), updated_at = now()
  where id = target_user_id and status = 'pending';
  if not found then raise exception 'pending account not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.review_song_submission(target_submission_id uuid, decision text, note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  if decision not in ('accepted_for_review', 'rejected') then raise exception 'unsupported submission decision' using errcode = '22023'; end if;
  update public.song_submissions
  set status = decision::public.song_submission_status,
      admin_note = left(coalesce(note, ''), 2000),
      reviewed_at = now(),
      reviewed_by = public.current_app_user_id()
  where id = target_submission_id and status = 'pending_review';
  if not found then raise exception 'pending submission not found' using errcode = 'P0002'; end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.song_submissions enable row level security;
alter table public.user_app_state enable row level security;
alter table public.offline_grant_audit enable row level security;

drop policy if exists profiles_read_own_or_admin on public.profiles;
create policy profiles_read_own_or_admin on public.profiles for select to authenticated
using (id = public.current_app_user_id() or public.is_app_admin());

drop policy if exists submissions_read_own_or_admin on public.song_submissions;
create policy submissions_read_own_or_admin on public.song_submissions for select to authenticated
using (user_id = public.current_app_user_id() or public.is_app_admin());
drop policy if exists submissions_create_approved_member on public.song_submissions;
create policy submissions_create_approved_member on public.song_submissions for insert to authenticated
with check (
  public.is_approved_member()
  and user_id = public.current_app_user_id()
  and status = 'pending_review'
  and rights_status = 'requires_review'
);

drop policy if exists user_app_state_own on public.user_app_state;
create policy user_app_state_own on public.user_app_state for all to authenticated
using (user_id = public.current_app_user_id() and public.is_approved_member())
with check (user_id = public.current_app_user_id() and public.is_approved_member());

drop policy if exists offline_grant_audit_admin_read on public.offline_grant_audit;
create policy offline_grant_audit_admin_read on public.offline_grant_audit for select to authenticated
using (public.is_app_admin());

revoke all on public.profiles, public.song_submissions, public.user_app_state, public.offline_grant_audit from public, anonymous, authenticated;
grant select on public.profiles to authenticated;
grant select, insert on public.song_submissions to authenticated;
grant select, insert, update on public.user_app_state to authenticated;

revoke all on function public.current_app_user_id(), public.current_app_email(), public.is_approved_member(), public.is_app_admin() from public;
revoke all on function public.ensure_my_profile(text, text), public.touch_my_presence(), public.review_account(uuid, text), public.review_song_submission(uuid, text, text) from public;
grant execute on function public.current_app_user_id(), public.current_app_email(), public.is_approved_member(), public.is_app_admin() to authenticated;
grant execute on function public.ensure_my_profile(text, text), public.touch_my_presence(), public.review_account(uuid, text), public.review_song_submission(uuid, text, text) to authenticated;

comment on table public.user_app_state is 'Soukromý stav uživatele; texty písní se zde nikdy neukládají.';
comment on table public.offline_grant_audit is 'Audit vydaných grantů bez tokenů, podpisových klíčů a surového identifikátoru zařízení.';

commit;
