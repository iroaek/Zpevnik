-- Strukturované opravy písní, správa zařízení a hromadná správa účtů.
-- Texty písní se sem neukládají; návrh obsahuje pouze krátkou původní a navrženou hodnotu.

begin;

do $$ begin
  create type public.song_correction_status as enum ('pending', 'accepted', 'rejected', 'rolled_back');
exception when duplicate_object then null; end $$;

create table if not exists public.song_corrections (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id text not null check (char_length(song_id) between 1 and 200),
  song_title text not null check (char_length(trim(song_title)) between 1 and 160),
  original_value text not null default '' check (char_length(original_value) <= 160),
  proposed_value text not null default '' check (char_length(proposed_value) <= 160),
  note text not null default '' check (char_length(note) between 1 and 2000),
  status public.song_correction_status not null default 'pending',
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
as $$
  insert into public.song_corrections (id, user_id, song_id, song_title, original_value, proposed_value, note)
  select target_id,
         public.current_app_profile_id(),
         trim(target_song_id),
         trim(target_song_title),
         left(trim(coalesce(target_original_value, '')), 160),
         left(trim(coalesce(target_proposed_value, '')), 160),
         left(trim(target_note), 2000)
  where public.is_approved_member()
    and target_id is not null
    and char_length(trim(coalesce(target_song_id, ''))) between 1 and 200
    and char_length(trim(coalesce(target_song_title, ''))) between 1 and 160
    and char_length(trim(coalesce(target_note, ''))) between 1 and 2000
  returning public.song_corrections.id
$$;

create or replace function public.review_song_correction(
  target_correction_id uuid,
  decision text,
  note text default '',
  edited_proposed_value text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_status public.song_correction_status;
begin
  if not public.is_app_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  if decision not in ('accepted', 'rejected', 'pending') then raise exception 'unsupported correction decision' using errcode = '22023'; end if;
  select status into previous_status from public.song_corrections where id = target_correction_id for update;
  if previous_status is null then raise exception 'correction not found' using errcode = 'P0002'; end if;
  update public.song_corrections
  set status = case when decision = 'pending' and previous_status <> 'pending' then 'rolled_back'::public.song_correction_status else decision::public.song_correction_status end,
      proposed_value = case when edited_proposed_value is null then proposed_value else left(trim(edited_proposed_value), 160) end,
      admin_note = left(coalesce(note, ''), 2000),
      reviewed_at = now(),
      reviewed_by = public.current_app_profile_id(),
      updated_at = now(),
      history = history || jsonb_build_array(jsonb_build_object(
        'at', now(), 'by', public.current_app_profile_id(), 'from', previous_status, 'to', decision,
        'note', left(coalesce(note, ''), 2000)
      ))
  where id = target_correction_id;
end;
$$;

create or replace function public.register_my_device(target_device_id uuid, target_label text, target_platform text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_profile uuid := public.current_app_profile_id();
begin
  if not public.is_approved_member() then raise exception 'approved account required' using errcode = '42501'; end if;
  if exists (select 1 from public.user_devices where user_id = current_profile and device_id = target_device_id and revoked_at is not null) then
    raise exception 'device access revoked' using errcode = '42501';
  end if;
  insert into public.user_devices (user_id, device_id, label, platform)
  values (current_profile, target_device_id, left(trim(target_label), 80), left(trim(coalesce(target_platform, '')), 120))
  on conflict (user_id, device_id) do update
  set label = excluded.label, platform = excluded.platform, last_seen_at = now();
end;
$$;

create or replace function public.revoke_device(target_user_id uuid, target_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id <> public.current_app_profile_id() and not public.is_app_admin() then
    raise exception 'device owner or administrator required' using errcode = '42501';
  end if;
  update public.user_devices
  set revoked_at = now(), revoked_by = public.current_app_profile_id()
  where user_id = target_user_id and device_id = target_device_id and revoked_at is null;
  if not found then raise exception 'active device not found' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.set_account_status(target_user_id uuid, desired_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then raise exception 'administrator access required' using errcode = '42501'; end if;
  if target_user_id = public.current_app_profile_id() then raise exception 'administrator cannot change own status' using errcode = '22023'; end if;
  if desired_status not in ('approved', 'rejected', 'suspended') then raise exception 'unsupported account status' using errcode = '22023'; end if;
  update public.profiles
  set status = desired_status::public.account_status,
      reviewed_at = now(), reviewed_by = public.current_app_profile_id(), updated_at = now()
  where id = target_user_id;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
end;
$$;

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

comment on table public.song_corrections is 'Krátké návrhy oprav bez celých textů písní; každé rozhodnutí má auditní historii.';
comment on table public.user_devices is 'Technické identifikátory zařízení pro správu budoucího offline přístupu.';

commit;
