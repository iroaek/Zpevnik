-- Přehled registrovaných uživatelů a bezpečný odhad online aktivity pro administrátora.

begin;

alter table public.profiles
add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_idx
on public.profiles (last_seen_at desc)
where last_seen_at is not null;

create or replace function public.touch_my_presence()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  touched_at timestamptz := clock_timestamp();
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update public.profiles
  set last_seen_at = touched_at
  where id = (select auth.uid());

  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  return touched_at;
end;
$$;

revoke all on function public.touch_my_presence() from public;
grant execute on function public.touch_my_presence() to authenticated;

comment on column public.profiles.last_seen_at is
  'Poslední aktivita přihlášeného uživatele; administrace považuje za online poslední dvě minuty.';
comment on function public.touch_my_presence() is
  'Aktualizuje výhradně aktivitu právě přihlášeného uživatele.';

commit;
