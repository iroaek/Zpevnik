create table if not exists public.song_corrections (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id text not null check (char_length(song_id) between 1 and 200),
  song_title text not null check (char_length(trim(song_title)) between 1 and 160),
  original_value text not null default '' check (char_length(original_value) <= 160),
  proposed_value text not null default '' check (char_length(proposed_value) <= 160),
  note text not null default '' check (char_length(note) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'rolled_back')),
  admin_note text not null default '' check (char_length(admin_note) <= 2000),
  history jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array' and octet_length(history::text) <= 30000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id)
);

create index if not exists song_corrections_status_created_idx on public.song_corrections (status, created_at desc);
create index if not exists song_corrections_song_idx on public.song_corrections (song_id, created_at desc);

create table if not exists public.user_devices (
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  label text not null check (char_length(trim(label)) between 1 and 80),
  platform text not null default '' check (char_length(platform) <= 120),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  primary key (user_id, device_id)
);

create index if not exists user_devices_last_seen_idx on public.user_devices (last_seen_at desc);

create or replace function public.submit_my_song_correction(
  target_id uuid,
  target_song_id text,
  target_song_title text,
  target_original_value text,
  target_proposed_value text,
  target_note text
)
returns uuid
language sql
security definer
set search_path = ''
as '
  insert into public.song_corrections (id, user_id, song_id, song_title, original_value, proposed_value, note)
  select target_id,
         public.current_app_profile_id(),
         trim(target_song_id),
         trim(target_song_title),
         left(trim(coalesce(target_original_value, '''')), 160),
         left(trim(coalesce(target_proposed_value, '''')), 160),
         left(trim(target_note), 2000)
  where public.is_approved_member()
    and target_id is not null
    and char_length(trim(coalesce(target_song_id, ''''))) between 1 and 200
    and char_length(trim(coalesce(target_song_title, ''''))) between 1 and 160
    and char_length(trim(coalesce(target_note, ''''))) between 1 and 2000
  returning public.song_corrections.id
';

create or replace function public.review_song_correction(
  target_correction_id uuid,
  decision text,
  note text default '',
  edited_proposed_value text default null
)
returns boolean
language sql
security definer
set search_path = ''
as '
  with updated as (
    update public.song_corrections
    set status = case when decision = ''pending'' and status <> ''pending'' then ''rolled_back'' else decision end,
      proposed_value = case when edited_proposed_value is null then proposed_value else left(trim(edited_proposed_value), 160) end,
      admin_note = left(coalesce(note, ''''), 2000),
      reviewed_at = now(),
      reviewed_by = public.current_app_profile_id(),
      updated_at = now(),
      history = history || jsonb_build_array(jsonb_build_object(
        ''at'', now(), ''by'', public.current_app_profile_id(), ''from'', status, ''to'', decision,
        ''note'', left(coalesce(note, ''''), 2000)
      ))
    where id = target_correction_id
      and public.is_app_admin()
      and decision in (''accepted'', ''rejected'', ''pending'')
    returning 1
  )
  select exists (select 1 from updated)
';

create or replace function public.register_my_device(target_device_id uuid, target_label text, target_platform text default '')
returns boolean
language sql
security definer
set search_path = ''
as '
  with registered as (
    insert into public.user_devices (user_id, device_id, label, platform)
    select public.current_app_profile_id(), target_device_id, left(trim(target_label), 80), left(trim(coalesce(target_platform, '''')), 120)
    where public.is_approved_member()
      and target_device_id is not null
      and char_length(trim(coalesce(target_label, ''''))) between 1 and 80
      and not exists (
        select 1 from public.user_devices
        where user_id = public.current_app_profile_id() and device_id = target_device_id and revoked_at is not null
      )
    on conflict (user_id, device_id) do update
    set label = excluded.label, platform = excluded.platform, last_seen_at = now()
    where public.user_devices.revoked_at is null
    returning 1
  )
  select exists (select 1 from registered)
';

create or replace function public.revoke_device(target_user_id uuid, target_device_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as '
  with revoked as (
    update public.user_devices
    set revoked_at = now(), revoked_by = public.current_app_profile_id()
    where user_id = target_user_id
      and device_id = target_device_id
      and revoked_at is null
      and (target_user_id = public.current_app_profile_id() or public.is_app_admin())
    returning 1
  )
  select exists (select 1 from revoked)
';

create or replace function public.set_account_status(target_user_id uuid, desired_status text)
returns boolean
language sql
security definer
set search_path = ''
as '
  with changed as (
    update public.profiles
    set status = desired_status::public.account_status,
      reviewed_at = now(), reviewed_by = public.current_app_profile_id(), updated_at = now()
    where id = target_user_id
      and target_user_id <> public.current_app_profile_id()
      and public.is_app_admin()
      and desired_status in (''approved'', ''rejected'', ''suspended'')
    returning 1
  )
  select exists (select 1 from changed)
';

alter table public.song_corrections enable row level security;
alter table public.song_corrections force row level security;
alter table public.user_devices enable row level security;
alter table public.user_devices force row level security;

drop policy if exists song_corrections_read_own_or_admin on public.song_corrections;
create policy song_corrections_read_own_or_admin on public.song_corrections for select to authenticated
using (user_id = public.current_app_profile_id() or public.is_app_admin());

drop policy if exists user_devices_read_own_or_admin on public.user_devices;
create policy user_devices_read_own_or_admin on public.user_devices for select to authenticated
using (user_id = public.current_app_profile_id() or public.is_app_admin());

revoke all on public.song_corrections, public.user_devices from public, anonymous, authenticated;
grant select on public.song_corrections, public.user_devices to authenticated;

revoke all on function public.submit_my_song_correction(uuid, text, text, text, text, text) from public;
revoke all on function public.review_song_correction(uuid, text, text, text) from public;
revoke all on function public.register_my_device(uuid, text, text) from public;
revoke all on function public.revoke_device(uuid, uuid) from public;
revoke all on function public.set_account_status(uuid, text) from public;
grant execute on function public.submit_my_song_correction(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.review_song_correction(uuid, text, text, text) to authenticated;
grant execute on function public.register_my_device(uuid, text, text) to authenticated;
grant execute on function public.revoke_device(uuid, uuid) to authenticated;
grant execute on function public.set_account_status(uuid, text) to authenticated;
