# Plán migrace Supabase → Neon

**Produkční fáze 1 byla provedena 12. 8. 2026.** Aplikační tabulky, profily a synchronizační stavy jsou v Neonu; Supabase Auth, privátní Storage a Edge Function `offline-grant` zůstávají v Supabase. Okamžitý rollback zachovává `VITE_DATA_BACKEND=supabase`.

Produkční kontrola potvrdila 12 profilů a 6 synchronizačních stavů se shodnými kontrolními otisky zdroje a cíle. Všechny čtyři aplikační tabulky mají RLS a Neon Data API ověřuje stávající Supabase JWT přes veřejné JWKS.

## 0. Co je už připraveno

- PostgREST-kompatibilní klient Neon Data API s bearer tokenem stávající Supabase relace;
- schéma profilů, návrhů, uživatelského stavu a auditu v `neon/migrations/202608110001_application_schema.sql`;
- RLS podle `auth.user_id()` a e-mail pouze z ověřeného JWT claimu přes `auth.session()`;
- dual-provider offline issuer: autentizace a manifest ze Supabase, autoritativní profil a audit z Neonu;
- bezpečný outbox replay po návratu sítě, při focusu a s exponenciálním opakováním;
- build-time feature flag, který zůstává v CI výchozí na Supabase.

## 1. Read-only inventář

Exportovat verze PostgreSQL a rozšíření, schémata, tabulky, sekvence, indexy, constraints, triggery, functions/procedures, views/materialized views, RLS policies, GRANTy, RPC, publications/Realtime, cron, webhooky, Vault/secrets reference, Edge Functions, Auth providery, SMTP, Storage buckety/policies/objekty a velikosti. Samostatně inventarizovat `auth.*` a `storage.*`; do reportu nevkládat secrets.

## 2. Staging dump/restore

1. Vytvořit read-only zdrojové credentials a nový Neon staging projekt v odpovídajícím regionu/verzi.
2. `pg_dump --format=custom --no-owner --no-acl` přes **unpooled** připojení.
3. Uložit dump šifrovaně mimo Git; zaznamenat SHA‑256.
4. `pg_restore --list`, kompatibilita extensions a ruční mapování Supabase-specific objektů.
5. Obnovit do prázdné staging branch; nikdy ne do produkční branch.
6. Aplikovat cílové runtime/migration role a RLS, ne zdrojové service role.

Neon dokumentuje dump/restore a další varianty migrace zde: [Neon migration docs](https://neon.com/docs/import/migrate-intro).

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

Neon PostgreSQL není náhradou privátního object storage. Ve fázi 1 zůstává Supabase Storage. Edge Function `offline-grant` zůstane hostována v Supabase, ale při `DATA_BACKEND=neon` ověřuje autoritativní profil a zapisuje audit přes serverový `NEON_DATABASE_URL`. Tento connection string je výhradně secret funkce, nikdy proměnná `VITE_*`.

## 6. Stagingový cutover

1. Vytvořit Neon staging branch a zapnout Data API s JWKS stávajícího Supabase Auth.
2. Přes migration-owner spojení aplikovat `neon/migrations/202608110001_application_schema.sql`; runtime role nesmí mít `BYPASSRLS`.
3. Přenést pouze aplikační řádky `profiles`, `song_submissions`, `user_app_state` a případný audit. Nepřenášet `auth.*`, `storage.*`, service role ani secrets.
4. Nasadit Edge Function s `DATA_BACKEND=neon` a serverovými secrets `NEON_DATABASE_URL`, `OFFLINE_GRANT_*`; URL funkce nastavit do `VITE_NEON_OFFLINE_GRANT_URL`.
5. Ve staging buildu nastavit `VITE_DATA_BACKEND=neon` a `VITE_NEON_DATA_API_URL`.
6. Ověřit A/B/admin/pending/rejected/suspended RLS matici, tvorbu profilů, návrhy, outbox replay, vydání grantu a cold start bez sítě.
7. Spustit Neon Data API Advisors a odstranit nálezy před produkčním rozhodnutím.

## 7. Přechod a rollback

- nejprve dual-read ve stagingu a stínové porovnání bez vracení Neon dat uživateli;
- krátké read-only okno pro finální delta sync, nebo logical replication po samostatném testu;
- jeden build zapisuje vždy do jediného autoritativního systému; během ověřování se nemíchá zápis Supabase/Neon;
- rollback nastaví `VITE_DATA_BACKEND=supabase`, znovu sestaví PWA a vrátí Edge Function na `DATA_BACKEND=supabase`;
- Supabase nesmazat minimálně po celou ověřovací/retention dobu;
- definovat RPO/RTO, vlastníka rozhodnutí a stop podmínky před cutoverem.

## Aktuální provozní omezení

- Supabase se nemaže a zůstává zdrojem autentizace a privátních souborů.
- Aplikace nesmí zapisovat současně do obou aplikačních databází; aktivní backend určuje pouze `VITE_DATA_BACKEND`.
- Produkční Neon connection string a soukromý podpisový klíč jsou pouze v Edge Function Secrets, nikdy v proměnných `VITE_*` ani v Git.
- Návrat na Supabase vyžaduje přepnout GitHub proměnnou `VITE_DATA_BACKEND=supabase`, Edge Function secret `DATA_BACKEND=supabase` a znovu nasadit PWA.
