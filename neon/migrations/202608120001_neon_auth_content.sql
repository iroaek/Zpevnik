-- Čistý Neon cutover: Neon Auth identity mapping, chráněné obsahové balíčky
-- a soubory návrhů uložené v Postgres. Soubor neobsahuje tajné klíče ani obsah písní.

begin;

alter table public.profiles
  add column if not exists auth_user_id uuid;

create unique index if not exists profiles_auth_user_id_idx
  on public.profiles (auth_user_id)
  where auth_user_id is not null;

create table if not exists public.content_packages (
  scope text not null check (scope in ('members', 'admin')),
  version text not null check (char_length(version) between 1 and 128),
  manifest jsonb not null,
  package_bytes integer not null check (package_bytes > 0 and package_bytes <= 25000000),
  chunk_count integer not null check (chunk_count between 1 and 128),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint content_package_manifest_object check (jsonb_typeof(manifest) = 'object'),
  primary key (scope, version)
);

create unique index if not exists content_packages_one_active_scope_idx
  on public.content_packages (scope)
  where is_active = true;

create table if not exists public.content_package_chunks (
  scope text not null,
  version text not null,
  chunk_index integer not null check (chunk_index between 0 and 127),
  byte_size integer not null check (byte_size between 1 and 262144),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  data_base64 text not null check (char_length(data_base64) between 1 and 349528),
  primary key (scope, version, chunk_index),
  foreign key (scope, version) references public.content_packages(scope, version) on delete cascade
);

alter table public.song_submissions
  add column if not exists upload_complete boolean not null default true,
  add column if not exists file_sha256 text,
  add column if not exists file_chunk_count integer not null default 0;

do $$ begin
  alter table public.song_submissions
    add constraint song_submission_file_sha256_format
    check (file_sha256 is null or file_sha256 ~ '^[a-f0-9]{64}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.song_submissions
    add constraint song_submission_chunk_count_range
    check (file_chunk_count between 0 and 64);
exception when duplicate_object then null; end $$;

create table if not exists public.song_submission_files (
  submission_id uuid not null references public.song_submissions(id) on delete cascade,
  chunk_index integer not null check (chunk_index between 0 and 63),
  byte_size integer not null check (byte_size between 1 and 524288),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  data_base64 text not null check (char_length(data_base64) between 1 and 699052),
  created_at timestamptz not null default now(),
  primary key (submission_id, chunk_index)
);

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

create or replace function public.current_app_email_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from neon_auth."user" as auth_user
    where auth_user.id = public.current_app_user_id()
      and auth_user."emailVerified" = true
      and lower(auth_user.email) = public.current_app_email()
  );
$$;

create or replace function public.current_app_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = public.current_app_user_id()
  limit 1;
$$;

create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = public.current_app_profile_id() and status = 'approved'
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
    where id = public.current_app_profile_id() and status = 'approved' and role = 'admin'
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
    raise exception 'email claim required' using errcode = '42501';
  end if;
  if char_length(normalized_name) < 2 then normalized_name := 'Nový člen'; end if;

  select * into result
  from public.profiles
  where auth_user_id = current_id;
  if found then
    update neon_auth."user"
    set role = case when result.status = 'approved' then result.role::text else result.status::text end,
        banned = result.status in ('rejected', 'suspended'),
        "banReason" = case when result.status in ('rejected', 'suspended') then 'Přístup ke zpěvníku byl správcem pozastaven.' else null end,
        "updatedAt" = now()
    where id = current_id;
    return result;
  end if;

  -- Převzetí importovaného profilu podle e-mailu je dovoleno jen po skutečném
  -- ověření adresy v Neon Auth. Tím se zachová role, schválení i synchronizace.
  if public.current_app_email_verified() then
    update public.profiles
    set auth_user_id = current_id, updated_at = now()
    where lower(email) = current_email and auth_user_id is null
    returning * into result;
    if found then
      update neon_auth."user"
      set role = case when result.status = 'approved' then result.role::text else result.status::text end,
          banned = result.status in ('rejected', 'suspended'),
          "banReason" = case when result.status in ('rejected', 'suspended') then 'Přístup ke zpěvníku byl správcem pozastaven.' else null end,
          "updatedAt" = now()
      where id = current_id;
      return result;
    end if;
  end if;

  insert into public.profiles (id, auth_user_id, email, display_name, status, role)
  values (current_id, current_id, current_email, normalized_name, 'pending', 'member')
  on conflict (id) do nothing;

  select * into result
  from public.profiles
  where auth_user_id = current_id;
  update neon_auth."user"
  set role = 'pending', banned = false, "banReason" = null, "updatedAt" = now()
  where id = current_id;
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
  update public.profiles
  set last_seen_at = touched_at, updated_at = touched_at
  where id = public.current_app_profile_id();
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
  if target_user_id = public.current_app_profile_id() then raise exception 'administrator cannot review own account' using errcode = '22023'; end if;
  update public.profiles
  set status = decision::public.account_status,
      reviewed_at = now(),
      reviewed_by = public.current_app_profile_id(),
      updated_at = now()
  where id = target_user_id and status = 'pending';
  if not found then raise exception 'pending account not found' using errcode = 'P0002'; end if;
  update neon_auth."user" as auth_user
  set role = case when decision = 'approved' then profile.role::text else 'rejected' end,
      banned = decision = 'rejected',
      "banReason" = case when decision = 'rejected' then 'Žádost o přístup ke zpěvníku byla zamítnuta.' else null end,
      "updatedAt" = now()
  from public.profiles as profile
  where profile.id = target_user_id and auth_user.id = profile.auth_user_id;
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
      reviewed_by = public.current_app_profile_id()
  where id = target_submission_id and status = 'pending_review' and upload_complete = true;
  if not found then raise exception 'pending submission not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.complete_my_song_upload(target_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare expected_chunks integer;
declare expected_bytes integer;
declare actual_chunks integer;
declare actual_bytes integer;
begin
  select file_chunk_count, file_size into expected_chunks, expected_bytes
  from public.song_submissions
  where id = target_submission_id
    and user_id = public.current_app_profile_id()
    and kind = 'upload'
    and upload_complete = false;
  if not found then raise exception 'upload not found' using errcode = 'P0002'; end if;

  select count(*), coalesce(sum(byte_size), 0) into actual_chunks, actual_bytes
  from public.song_submission_files
  where submission_id = target_submission_id;
  if actual_chunks <> expected_chunks or actual_bytes <> expected_bytes then
    raise exception 'upload is incomplete' using errcode = '22000';
  end if;

  update public.song_submissions set upload_complete = true where id = target_submission_id;
end;
$$;

create or replace function public.abort_my_song_upload(target_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.song_submissions
  where id = target_submission_id
    and user_id = public.current_app_profile_id()
    and kind = 'upload'
    and upload_complete = false;
end;
$$;

create or replace function public.activate_content_package(target_scope text, target_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare expected_chunks integer;
declare expected_bytes integer;
declare actual_chunks integer;
declare actual_bytes integer;
declare minimum_index integer;
declare maximum_index integer;
begin
  if not public.is_app_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  select chunk_count, package_bytes into expected_chunks, expected_bytes
  from public.content_packages
  where scope = target_scope and version = target_version and is_active = false;
  if not found then raise exception 'content package revision not found' using errcode = 'P0002'; end if;

  select count(*), coalesce(sum(byte_size), 0), min(chunk_index), max(chunk_index)
  into actual_chunks, actual_bytes, minimum_index, maximum_index
  from public.content_package_chunks
  where scope = target_scope and version = target_version;
  if actual_chunks <> expected_chunks or actual_bytes <> expected_bytes
    or minimum_index <> 0 or maximum_index <> expected_chunks - 1 then
    raise exception 'content package revision is incomplete' using errcode = '22000';
  end if;

  update public.content_packages set is_active = false where scope = target_scope and is_active = true;
  update public.content_packages set is_active = true, updated_at = now()
  where scope = target_scope and version = target_version;
end;
$$;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.song_submissions enable row level security;
alter table public.song_submissions force row level security;
alter table public.song_submission_files enable row level security;
alter table public.song_submission_files force row level security;
alter table public.user_app_state enable row level security;
alter table public.user_app_state force row level security;
alter table public.offline_grant_audit enable row level security;
alter table public.offline_grant_audit force row level security;
alter table public.content_packages enable row level security;
alter table public.content_packages force row level security;
alter table public.content_package_chunks enable row level security;
alter table public.content_package_chunks force row level security;

drop policy if exists profiles_read_own_or_admin on public.profiles;
create policy profiles_read_own_or_admin on public.profiles for select to authenticated
using (id = public.current_app_profile_id() or public.is_app_admin());

drop policy if exists submissions_read_own_or_admin on public.song_submissions;
create policy submissions_read_own_or_admin on public.song_submissions for select to authenticated
using (
  user_id = public.current_app_profile_id()
  or (public.is_app_admin() and (kind = 'request' or upload_complete = true))
);

drop policy if exists submissions_create_approved_member on public.song_submissions;
create policy submissions_create_approved_member on public.song_submissions for insert to authenticated
with check (
  public.is_approved_member()
  and user_id = public.current_app_profile_id()
  and status = 'pending_review'
  and rights_status = 'requires_review'
  and (
    (kind = 'request' and upload_complete = true and file_size = 0 and file_chunk_count = 0)
    or (kind = 'upload' and upload_complete = false and file_size > 0 and file_chunk_count > 0)
  )
);

drop policy if exists submission_files_read_own_or_admin on public.song_submission_files;
create policy submission_files_read_own_or_admin on public.song_submission_files for select to authenticated
using (
  exists (
    select 1 from public.song_submissions as submission
    where submission.id = submission_id
      and (submission.user_id = public.current_app_profile_id() or (public.is_app_admin() and submission.upload_complete = true))
  )
);

drop policy if exists submission_files_create_own on public.song_submission_files;
create policy submission_files_create_own on public.song_submission_files for insert to authenticated
with check (
  exists (
    select 1 from public.song_submissions as submission
    where submission.id = submission_id
      and submission.user_id = public.current_app_profile_id()
      and submission.kind = 'upload'
      and submission.upload_complete = false
      and public.is_approved_member()
  )
);

drop policy if exists user_app_state_own on public.user_app_state;
create policy user_app_state_own on public.user_app_state for all to authenticated
using (user_id = public.current_app_profile_id() and public.is_approved_member())
with check (user_id = public.current_app_profile_id() and public.is_approved_member());

drop policy if exists offline_grant_audit_admin_read on public.offline_grant_audit;
create policy offline_grant_audit_admin_read on public.offline_grant_audit for select to authenticated
using (public.is_app_admin());

drop policy if exists content_packages_authorized_read on public.content_packages;
create policy content_packages_authorized_read on public.content_packages for select to authenticated
using (
  public.is_approved_member()
  and is_active = true
  and (scope = 'members' or (scope = 'admin' and public.is_app_admin()))
);

drop policy if exists content_packages_admin_write on public.content_packages;
create policy content_packages_admin_write on public.content_packages for all to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

drop policy if exists content_package_chunks_authorized_read on public.content_package_chunks;
create policy content_package_chunks_authorized_read on public.content_package_chunks for select to authenticated
using (
  public.is_approved_member()
  and exists (
    select 1 from public.content_packages as package
    where package.scope = content_package_chunks.scope
      and package.version = content_package_chunks.version
      and package.is_active = true
      and (package.scope = 'members' or (package.scope = 'admin' and public.is_app_admin()))
  )
);

drop policy if exists content_package_chunks_admin_write on public.content_package_chunks;
create policy content_package_chunks_admin_write on public.content_package_chunks for all to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

revoke all on public.content_packages, public.content_package_chunks, public.song_submission_files from public, anonymous, authenticated;
grant select, insert, update, delete on public.content_packages, public.content_package_chunks to authenticated;
grant select, insert on public.song_submission_files to authenticated;

revoke all on function public.current_app_email_verified(), public.current_app_profile_id() from public;
revoke all on function public.complete_my_song_upload(uuid), public.abort_my_song_upload(uuid), public.activate_content_package(text, text) from public;
grant execute on function public.current_app_email_verified(), public.current_app_profile_id() to authenticated;
grant execute on function public.complete_my_song_upload(uuid), public.abort_my_song_upload(uuid), public.activate_content_package(text, text) to authenticated;

comment on column public.profiles.auth_user_id is 'Neon Auth user ID; profile.id remains stable during legacy account activation.';
comment on table public.content_packages is 'Authorized private library payloads. RLS exposes members/admin scopes only to approved accounts.';
comment on table public.content_package_chunks is 'Base64 chunks of authorized packages; each chunk and the complete package have SHA-256 integrity metadata.';
comment on table public.song_submission_files is 'Chunked user-provided files awaiting rights and content review; never automatically published.';

commit;
