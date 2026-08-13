-- Živý režim členských setlistů. Přenáší pouze ID aktuální písně, nikdy text ani akordy.

alter table public.shared_setlists add column if not exists live_song_id text;
alter table public.shared_setlists add column if not exists live_started_at timestamptz;
alter table public.shared_setlists add column if not exists live_updated_at timestamptz;
alter table public.shared_setlists add column if not exists live_by uuid references public.profiles(id) on delete set null;

alter table public.shared_setlists drop constraint if exists shared_setlists_live_song_member;
alter table public.shared_setlists
  add constraint shared_setlists_live_song_member
  check (live_song_id is null or song_ids ? live_song_id);

drop function if exists public.list_shared_setlists();
create function public.list_shared_setlists()
returns table (
  id uuid,
  owner_id uuid,
  owner_name text,
  source_setlist_id text,
  name text,
  song_ids jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  live_song_id text,
  live_started_at timestamptz,
  live_updated_at timestamptz,
  live_by uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select shared.id,
         shared.owner_id,
         profile.display_name,
         shared.source_setlist_id,
         shared.name,
         shared.song_ids,
         shared.created_at,
         shared.updated_at,
         shared.live_song_id,
         shared.live_started_at,
         shared.live_updated_at,
         shared.live_by
  from public.shared_setlists as shared
  join public.profiles as profile on profile.id = shared.owner_id
  where public.is_approved_member()
    and profile.status = 'approved'
  order by coalesce(shared.live_updated_at, shared.updated_at) desc, shared.name asc
$$;

create or replace function public.set_shared_setlist_live_song(
  target_shared_setlist_id uuid,
  target_song_id text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with changed as (
    update public.shared_setlists
  set live_song_id = nullif(trim(coalesce(target_song_id, '')), ''),
      live_started_at = case when live_song_id is null and nullif(trim(coalesce(target_song_id, '')), '') is not null then now() else live_started_at end,
      live_updated_at = now(),
      live_by = public.current_app_profile_id()
  where id = target_shared_setlist_id
    and public.is_approved_member()
    and (owner_id = public.current_app_profile_id() or public.is_app_admin())
    and (nullif(trim(coalesce(target_song_id, '')), '') is null or song_ids ? trim(target_song_id))
    returning 1
  )
  select exists(select 1 from changed)
$$;

-- Při odebrání právě hrané písně se živý stav bezpečně zastaví.
create or replace function public.update_shared_setlist(
  target_shared_setlist_id uuid,
  target_name text,
  target_song_ids jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.shared_setlists
  set name = trim(target_name),
      song_ids = target_song_ids,
      live_song_id = case when live_song_id is not null and target_song_ids ? live_song_id then live_song_id else null end,
      live_updated_at = case when live_song_id is not null and not (target_song_ids ? live_song_id) then now() else live_updated_at end,
      updated_at = now()
  where id = target_shared_setlist_id
    and public.is_approved_member()
    and char_length(trim(coalesce(target_name, ''))) between 1 and 100
    and public.valid_shared_setlist_song_ids(target_song_ids)
    and (owner_id = public.current_app_profile_id() or public.is_app_admin())
$$;

revoke all on function public.list_shared_setlists() from public;
revoke all on function public.set_shared_setlist_live_song(uuid, text) from public;
grant execute on function public.list_shared_setlists() to authenticated;
grant execute on function public.set_shared_setlist_live_song(uuid, text) to authenticated;

comment on column public.shared_setlists.live_song_id is 'ID právě hrané písně bez textu a akordů.';
