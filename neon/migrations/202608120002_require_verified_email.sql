-- Neon Auth smí propojit nebo vytvořit aplikační profil až po ověření e-mailu.
-- Chrání migraci původních profilů před předčasnou relací po registraci.

begin;

-- Better Auth ověřuje callback URL proti této konfiguraci. Původně prázdný
-- seznam mohl odmítnout úspěšné přihlášení až po správném zadání hesla.
update neon_auth.project_config
set trusted_origins = (
      select jsonb_agg(origin order by origin)
      from (
        select distinct jsonb_array_elements_text(
          coalesce(trusted_origins, '[]'::jsonb) || '["https://iroaek.github.io"]'::jsonb
        ) as origin
      ) trusted
    ),
    updated_at = now();

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
  if not public.current_app_email_verified() then
    raise exception 'verified email required' using errcode = '42501';
  end if;
  if char_length(normalized_name) < 2 then normalized_name := 'Nový člen'; end if;

  select * into result from public.profiles where auth_user_id = current_id;
  if found then
    update neon_auth."user"
    set role = case when result.status = 'approved' then result.role::text else result.status::text end,
        banned = result.status in ('rejected', 'suspended'),
        "banReason" = case when result.status in ('rejected', 'suspended') then 'Přístup ke zpěvníku byl správcem pozastaven.' else null end,
        "updatedAt" = now()
    where id = current_id;
    return result;
  end if;

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

  insert into public.profiles (id, auth_user_id, email, display_name, status, role)
  values (current_id, current_id, current_email, normalized_name, 'pending', 'member')
  on conflict (id) do nothing;
  select * into result from public.profiles where auth_user_id = current_id;
  update neon_auth."user"
  set role = 'pending', banned = false, "banReason" = null, "updatedAt" = now()
  where id = current_id;
  return result;
end;
$$;

commit;
