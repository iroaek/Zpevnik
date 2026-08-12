-- Sdílené setlisty viditelné pouze schváleným členům.
-- Vlastník spravuje svůj setlist a administrátor může upravit nebo odstranit každý sdílený setlist.

create or replace function public.valid_shared_setlist_song_ids(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(value) <> 'array' then false
    when jsonb_array_length(value) < 1 or jsonb_array_length(value) > 500 then false
    else not exists (
      select 1
      from jsonb_array_elements(value) as item
      where jsonb_typeof(item) <> 'string'
        or char_length(item #>> '{}') < 1
        or char_length(item #>> '{}') > 200
    )
  end
$$;

create table if not exists public.shared_setlists (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_setlist_id text not null check (char_length(trim(source_setlist_id)) between 1 and 120),
  name text not null check (char_length(trim(name)) between 1 and 100),
  song_ids jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_setlists_owner_source_unique unique (owner_id, source_setlist_id),
  constraint shared_setlists_song_ids_valid check (public.valid_shared_setlist_song_ids(song_ids))
);

create index if not exists shared_setlists_updated_idx
  on public.shared_setlists (updated_at desc);

create or replace function public.list_shared_setlists()
returns table (
  id uuid,
  owner_id uuid,
  owner_name text,
  source_setlist_id text,
  name text,
  song_ids jsonb,
  created_at timestamptz,
  updated_at timestamptz
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
         shared.updated_at
  from public.shared_setlists as shared
  join public.profiles as profile on profile.id = shared.owner_id
  where public.is_approved_member()
    and profile.status = 'approved'
  order by shared.updated_at desc, shared.name asc
$$;

create or replace function public.publish_my_setlist(
  target_id uuid,
  target_source_setlist_id text,
  target_name text,
  target_song_ids jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.shared_setlists (id, owner_id, source_setlist_id, name, song_ids)
  select target_id,
         public.current_app_profile_id(),
         trim(target_source_setlist_id),
         trim(target_name),
         target_song_ids
  where public.is_approved_member()
    and target_id is not null
    and char_length(trim(coalesce(target_source_setlist_id, ''))) between 1 and 120
    and char_length(trim(coalesce(target_name, ''))) between 1 and 100
    and public.valid_shared_setlist_song_ids(target_song_ids)
  on conflict (owner_id, source_setlist_id) do update
  set name = excluded.name,
      song_ids = excluded.song_ids,
      updated_at = now()
  returning public.shared_setlists.id
$$;

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
  set name = trim(target_name), song_ids = target_song_ids, updated_at = now()
  where id = target_shared_setlist_id
    and public.is_approved_member()
    and char_length(trim(coalesce(target_name, ''))) between 1 and 100
    and public.valid_shared_setlist_song_ids(target_song_ids)
    and (owner_id = public.current_app_profile_id() or public.is_app_admin())
$$;

create or replace function public.delete_shared_setlist(target_shared_setlist_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.shared_setlists
  where id = target_shared_setlist_id
    and public.is_approved_member()
    and (owner_id = public.current_app_profile_id() or public.is_app_admin())
$$;

alter table public.shared_setlists enable row level security;
alter table public.shared_setlists force row level security;

drop policy if exists shared_setlists_approved_read on public.shared_setlists;
create policy shared_setlists_approved_read on public.shared_setlists for select to authenticated
using (public.is_approved_member());

revoke all on public.shared_setlists from public, anonymous, authenticated;
grant select on public.shared_setlists to authenticated;

revoke all on function public.valid_shared_setlist_song_ids(jsonb) from public;
revoke all on function public.list_shared_setlists() from public;
revoke all on function public.publish_my_setlist(uuid, text, text, jsonb) from public;
revoke all on function public.update_shared_setlist(uuid, text, jsonb) from public;
revoke all on function public.delete_shared_setlist(uuid) from public;
grant execute on function public.list_shared_setlists() to authenticated;
grant execute on function public.publish_my_setlist(uuid, text, text, jsonb) to authenticated;
grant execute on function public.update_shared_setlist(uuid, text, jsonb) to authenticated;
grant execute on function public.delete_shared_setlist(uuid) to authenticated;

comment on table public.shared_setlists is 'Setlisty sdílené pouze mezi schválenými členy a neobsahují texty ani akordy písní.';
