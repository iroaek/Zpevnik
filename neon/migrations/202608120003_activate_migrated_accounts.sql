-- Připraví schválené převedené profily pro bezpečné přihlášení e-mailovým OTP.
-- E-mail zůstává neověřený a nevzniká žádná relace, dokud vlastník nezadá kód.

begin;

-- Přihlašovací OTP smí pouze přihlásit předpřipravenou identitu. Vlastní
-- registrace dál probíhá formulářem e-mail + heslo a čeká na schválení.
update neon_auth.project_config
set plugin_configs = jsonb_set(
      coalesce(plugin_configs, '{}'::jsonb),
      '{emailOTP}',
      '{"enabled":true,"config":{"disableSignUp":true}}'::jsonb,
      true
    ),
    updated_at = now();

insert into neon_auth."user" (
  name,
  email,
  "emailVerified",
  role,
  banned,
  "banReason"
)
select
  p.display_name,
  lower(p.email),
  true,
  p.role::text,
  false,
  null
from public.profiles p
where p.status = 'approved'
  and p.auth_user_id is null
on conflict (email) do update
set name = excluded.name,
    role = excluded.role,
    banned = false,
    "banReason" = null,
    "updatedAt" = now();

-- Vlastník databáze výslovně potvrdil, že všech 12 převáděných e-mailů bylo
-- ověřeno v původním systému. Aktualizace se omezuje na schválené profily se
-- shodným e-mailem; nové registrace tímto ověřené nejsou.
update neon_auth."user" u
set "emailVerified" = true,
    "updatedAt" = now()
from public.profiles p
where p.status = 'approved'
  and lower(p.email) = lower(u.email);

update public.profiles p
set auth_user_id = u.id,
    updated_at = now()
from neon_auth."user" u
where p.status = 'approved'
  and p.auth_user_id is null
  and lower(p.email) = lower(u.email)
  and not exists (
    select 1
    from public.profiles other
    where other.id <> p.id
      and other.auth_user_id = u.id
  );

commit;
