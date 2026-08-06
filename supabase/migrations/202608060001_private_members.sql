-- Soukromé účty, ruční schvalování a fronta písní.
-- Tento soubor spusťte v novém projektu Supabase jako jednu migraci.

begin;

create type public.account_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.app_role as enum ('member', 'admin');
create type public.song_submission_kind as enum ('request', 'upload');
create type public.song_submission_status as enum ('pending_review', 'accepted_for_review', 'rejected', 'published');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  display_name text not null check (char_length(trim(display_name)) between 2 and 60),
  status public.account_status not null default 'pending',
  role public.app_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  constraint profile_review_consistency check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or status <> 'pending'
  )
);

create unique index profiles_email_lower_idx on public.profiles (lower(email));
create index profiles_status_created_idx on public.profiles (status, created_at);

create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'approved'
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
    where id = (select auth.uid()) and status = 'approved' and role = 'admin'
  );
$$;

revoke all on function public.is_approved_member() from public;
revoke all on function public.is_app_admin() from public;
grant execute on function public.is_approved_member() to authenticated;
grant execute on function public.is_app_admin() to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if char_length(requested_name) < 2 then
    requested_name := split_part(new.email, '@', 1);
  end if;
  insert into public.profiles (id, email, display_name)
  values (new.id, lower(new.email), left(requested_name, 60));
  return new;
end;
$$;

create trigger create_profile_after_signup
after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

create or replace function public.review_account(target_user_id uuid, decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'unsupported account decision' using errcode = '22023';
  end if;
  if target_user_id = (select auth.uid()) then
    raise exception 'administrator cannot review their own account' using errcode = '22023';
  end if;
  update public.profiles
  set status = decision::public.account_status,
      reviewed_at = now(),
      reviewed_by = (select auth.uid()),
      updated_at = now()
  where id = target_user_id and status = 'pending';
  if not found then
    raise exception 'pending account not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.review_account(uuid, text) from public;
grant execute on function public.review_account(uuid, text) to authenticated;

create table public.song_submissions (
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
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint upload_requires_file check (kind <> 'upload' or (file_path is not null and file_name is not null and file_size > 0))
);

create index song_submissions_user_created_idx on public.song_submissions (user_id, created_at desc);
create index song_submissions_status_created_idx on public.song_submissions (status, created_at);

create or replace function public.review_song_submission(target_submission_id uuid, decision text, note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if decision not in ('accepted_for_review', 'rejected') then
    raise exception 'unsupported submission decision' using errcode = '22023';
  end if;
  update public.song_submissions
  set status = decision::public.song_submission_status,
      admin_note = left(coalesce(note, ''), 2000),
      reviewed_at = now(),
      reviewed_by = (select auth.uid())
  where id = target_submission_id and status = 'pending_review';
  if not found then
    raise exception 'pending submission not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.review_song_submission(uuid, text, text) from public;
grant execute on function public.review_song_submission(uuid, text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.song_submissions enable row level security;

create policy profiles_read_own
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy profiles_admin_read_all
on public.profiles for select to authenticated
using (public.is_app_admin());

create policy submissions_read_own
on public.song_submissions for select to authenticated
using (user_id = (select auth.uid()));

create policy submissions_admin_read_all
on public.song_submissions for select to authenticated
using (public.is_app_admin());

create policy submissions_create_approved_member
on public.song_submissions for insert to authenticated
with check (
  public.is_approved_member()
  and user_id = (select auth.uid())
  and status = 'pending_review'
  and rights_status = 'requires_review'
);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.song_submissions from anon, authenticated;
grant select, insert on public.song_submissions to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('song-library', 'song-library', false, 52428800, array['application/json']),
  ('song-submissions', 'song-submissions', false, 26214400, array['application/pdf', 'text/plain', 'application/octet-stream'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy approved_members_download_library
on storage.objects for select to authenticated
using (
  bucket_id = 'song-library'
  and (
    ((storage.foldername(name))[1] = 'members' and public.is_approved_member())
    or ((storage.foldername(name))[1] = 'admin' and public.is_app_admin())
  )
);

create policy approved_members_upload_submission
on storage.objects for insert to authenticated
with check (
  bucket_id = 'song-submissions'
  and public.is_approved_member()
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy owners_and_admins_read_submission
on storage.objects for select to authenticated
using (
  bucket_id = 'song-submissions'
  and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_app_admin())
);

create policy owner_cleanup_failed_submission
on storage.objects for delete to authenticated
using (
  bucket_id = 'song-submissions'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

comment on table public.profiles is 'Server-authoritative account status. Client code cannot grant roles or approval.';
comment on table public.song_submissions is 'Every submitted song starts as requires_review and is never published automatically.';

commit;
