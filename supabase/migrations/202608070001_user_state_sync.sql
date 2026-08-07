-- Soukromá synchronizace oblíbených, setlistů a nastavení mezi zařízeními.

begin;

create table if not exists public.user_app_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_app_state_object check (jsonb_typeof(state) = 'object'),
  constraint user_app_state_size check (octet_length(state::text) <= 250000)
);

alter table public.user_app_state enable row level security;

create policy user_app_state_read_own
on public.user_app_state for select to authenticated
using (
  user_id = (select auth.uid())
  and public.is_approved_member()
);

create policy user_app_state_insert_own
on public.user_app_state for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_approved_member()
);

create policy user_app_state_update_own
on public.user_app_state for update to authenticated
using (
  user_id = (select auth.uid())
  and public.is_approved_member()
)
with check (
  user_id = (select auth.uid())
  and public.is_approved_member()
);

revoke all on public.user_app_state from anon, authenticated;
grant select, insert, update on public.user_app_state to authenticated;

comment on table public.user_app_state is
  'Soukromý stav jednoho uživatele pro synchronizaci oblíbených, setlistů a nastavení. Texty písní se zde nikdy neukládají.';

commit;
