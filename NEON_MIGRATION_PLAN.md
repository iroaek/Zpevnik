# Plán migrace Supabase → Neon

**Produkční migrace se neprovádí.** Tento plán je určen pro budoucí staging a zachovává rollback na Supabase.

## 1. Read-only inventář

Exportovat verze PostgreSQL a rozšíření, schémata, tabulky, sekvence, indexy, constraints, triggery, functions/procedures, views/materialized views, RLS policies, GRANTy, RPC, publications/Realtime, cron, webhooky, Vault/secrets reference, Edge Functions, Auth providery, SMTP, Storage buckety/policies/objekty a velikosti. Samostatně inventarizovat `auth.*` a `storage.*`; do reportu nevkládat secrets.

## 2. Staging dump/restore

1. Vytvořit read-only zdrojové credentials a nový Neon staging projekt v odpovídajícím regionu/verzi.
2. `pg_dump --format=custom --no-owner --no-acl` přes **unpooled** připojení.
3. Uložit dump šifrovaně mimo Git; zaznamenat SHA‑256.
4. `pg_restore --list`, kompatibilita extensions a ruční mapování Supabase-specific objektů.
5. Obnovit do prázdné staging branch; nikdy ne do produkční branch.
6. Aplikovat cílové runtime/migration role a RLS, ne zdrojové service role.

Neon oficiálně doporučuje unpooled connection pro `pg_dump` a u větších dat samostatný dump/restore místo křehké pipe: [Neon migration docs](https://neon.com/docs/import/migrate-from-neon).

## 3. Validace

- počty řádků pro každou aplikační tabulku;
- schéma/indexy/constraints/triggery/functions přes katalogy;
- SHA‑256 kanonických exportů reprezentativních řádků;
- test všech RPC a `timestamptz` formátů;
- A/B/admin/pending/suspended RLS matice;
- runtime role bez `BYPASSRLS`, migration owner oddělený;
- pooled connection test: request B nikdy nezdědí `user_id` A;
- výkon kritických dotazů a connection cold start.

## 4. Auth jako samostatná migrace

Databázovou a auth migraci neslučovat. Možnosti v pořadí rizika:

1. ponechat Supabase Auth a mapovat stabilní Supabase UUID v BFF;
2. progresivní migrace identity při dalším přihlášení;
3. vynucený reset hesla;
4. přenos OAuth identity se znovusouhlasem podle providera.

Nepředpokládat přenos refresh tokenů, aktivních session, MFA nebo OAuth provider tokenů. Supabase umí přenést `auth` schéma mezi Supabase projekty, ale cílová kompatibilita jiné auth služby musí být doložena jejím oficiálním importem.

## 5. Storage a Functions

Neon PostgreSQL není náhradou privátního object storage. Dočasně ponechat Supabase Storage nebo vybrat privátní S3-compatible storage, kopírovat objekty server-to-server, ověřit velikosti/checksumy a až potom přepnout BFF. Edge Function `offline-grant` lze dočasně ponechat v Supabase nebo přesunout do samostatného API až po paralelním ověření podpisů.

## 6. Přechod a rollback

- nejprve dual-read ve stagingu a stínové porovnání bez vracení Neon dat uživateli;
- krátké read-only okno pro finální delta sync, nebo logical replication po samostatném testu;
- feature flag pro čtení z Neon, zápis stále do jednoho autoritativního systému;
- rollback přepne BFF zpět na Supabase a zachová zdroj beze změny;
- Supabase nesmazat minimálně po celou ověřovací/retention dobu;
- definovat RPO/RTO, vlastníka rozhodnutí a stop podmínky před cutoverem.

## Nevratné kroky zakázané v tomto patchi

Žádný `pg_dump` produkce, connection string, Neon projekt, DNS, dual-write, reset uživatelů, rotace JWT/secrets ani odstranění Supabase nebyly provedeny.
