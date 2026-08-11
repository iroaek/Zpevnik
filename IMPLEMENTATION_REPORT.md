# Implementační zpráva: offline-first přístup

Datum: 11. 8. 2026
Větev: `codex/offline-first-architecture`

## Výsledek

Projekt má nově explicitní stavový automat přihlášení, lokálně ověřovaný podepsaný offline grant, uživatelsky oddělené chráněné balíčky, atomický import, integritní hashe, frontu lokálních změn, bezpečné odhlášení, diagnostiku a návrh serverové funkce pro vydávání grantů. Žádná migrace, Edge Function, tajný klíč ani obsah nebyly nasazeny do produkce.

## Kořenová příčina původního problému

Původní klient spojoval tři odlišné situace do jednoho výsledku „odhlášeno“: skutečně neplatný účet, nedostupnou síť a dočasně neobnovitelnou Supabase session. Událost `SIGNED_OUT` navíc mohla okamžitě zavřít aplikaci bez ověření, zda zařízení stále vlastní platné offline oprávnění. Chráněný obsah současně neměl důslednou vazbu na uživatele a balíček/verzi a import nebyl jeden atomický krok.

## Nový stavový automat

Stavy jsou popsány v [AUTH_STATE_MACHINE.md](AUTH_STATE_MACHINE.md):

- `checking`
- `authenticated-online`
- `authenticated-offline`
- `offline-access-expired`
- `unauthenticated`

Síťová chyba, timeout a serverová chyba 5xx nemažou platný grant ani obsah. Běžné 401/403 samy o sobě nejsou považovány za kryptograficky spolehlivý důkaz revokace; s platným grantem klient pokračuje offline. Explicitní serverový kód `account_revoked` nebo ruční odhlášení přístup ukončí. Po expiraci grantu se chráněný obsah neotevře, ale fyzické odstranění je oddělená operace.

## Offline grant

- Formát: kompaktní JWS, algoritmus ES256.
- Klient obsahuje pouze veřejný JWKS, `issuer`, `audience` a `kid`.
- Privátní JWK je navržen pouze jako serverový secret Edge Function.
- Kontroluje se podpis, issuer, audience, device ID, uživatel, scope, povolené balíčky, `nbf` a `exp`.
- Výchozí platnost je 30 dní; server dovoluje konfigurovat 1–90 dní.
- Grant neobsahuje texty písní ani dlouhodobý Supabase refresh token.

Vydání zapisuje auditní metadata bez tokenu a bez privátního klíče. Návrh funkce token nevrátí, pokud auditní zápis selže.

## Offline data a synchronizace

IndexedDB schéma bylo zvýšeno na verzi 5 a obsahuje samostatné stores pro grant, balíčky, pending mutations a omezenou diagnostiku. Chráněné písně jsou při novém importu svázané s `ownerUserId`, balíčkem a verzí. Import manifestu, obsahů a metadata verze probíhá v jedné transakci. Poškozený balíček se rollbackne. Veřejné soubory i notové party mají SHA-256 a při nesouladu se odstraní a znovu stáhne jen chybná položka.

Oblíbené, setlisty a nastavení se při offline nebo neúspěšném zápisu ukládají jako idempotentní snapshot do outboxu. Současná implementace frontu bezpečně připravuje a maže po úspěšném upsertu; samostatný background replay worker je další krok před produkční aktivací.

## RLS a server

Připravená migrace zapíná a vynucuje RLS pro auditní tabulku. Politikami je povoleno čtení jen administrátorům; klient nemůže audit vkládat ani měnit. Serverová funkce používá service role pouze na serveru. Statické integrační testy pokrývají anonymního uživatele, uživatele A, uživatele B, administrátora a přítomnost RLS/force RLS. Skutečné behaviorální testy proti izolovanému Supabase staging projektu jsou povinný předprodukční krok.

## Supabase versus Neon

Rozhodnutí je nyní Supabase ponechat. Změna databázového poskytovatele neřeší offline odhlašování; příčina byla v klientském auth modelu a absenci podepsaného lokálního oprávnění. Současný projekt navíc používá Supabase Auth, Storage, RLS a Edge Functions, takže jednorázová migrace DB + Auth + Storage by zbytečně zvětšila riziko. Varianty, trigger migrace a rollback jsou v [BACKEND_OPTIONS_AND_NEON_ASSESSMENT.md](BACKEND_OPTIONS_AND_NEON_ASSESSMENT.md) a [NEON_MIGRATION_PLAN.md](NEON_MIGRATION_PLAN.md).

## PWA versus Capacitor

PWA zůstává primární distribuční cesta. Podepsaný grant a balíčky nejsou závislé na Service Workeru, takže je lze později použít i v Capacitor obálce. Nativní scaffold nebyl přidán, protože by bez rozhodnutí o bundle ID, signing týmu, iOS buildu na macOS a seznamu povolených pluginů byl jen neověřený základ. Postup a rizika jsou v [CAPACITOR_FEASIBILITY.md](CAPACITOR_FEASIBILITY.md).

## Přesný seznam implementačních souborů

### Změněné

- `.env.example`
- `.github/workflows/deploy-pages.yml`
- `DEPLOYMENT.md`
- `PLAN.md`
- `README.md`
- `e2e/mobile-pwa.spec.ts`
- `public/content/catalog.json`
- `scripts/generate-catalog.ts`
- `src/App.tsx`
- `src/auth/secureAccess.ts`
- `src/components/OfflineContent.test.tsx`
- `src/components/OfflineContent.tsx`
- `src/components/Settings.tsx`
- `src/components/SongReader.tsx`
- `src/domain/song.ts`
- `src/generated/catalog.json`
- `src/hooks/useCloudUserState.ts`
- `src/hooks/useSecureAccount.ts`
- `src/pwa/contentCache.ts`
- `src/storage/database.test.ts`
- `src/storage/database.ts`
- `src/styles.css`
- `src/vite-env.d.ts`

### Nové

- `AUTH_STATE_MACHINE.md`
- `BACKEND_OPTIONS_AND_NEON_ASSESSMENT.md`
- `CAPACITOR_FEASIBILITY.md`
- `CONTENT_PACKAGE_FORMAT.md`
- `CURRENT_STATE_AUDIT.md`
- `IMPLEMENTATION_REPORT.md`
- `NEON_MIGRATION_PLAN.md`
- `OFFLINE_ARCHITECTURE.md`
- `OFFLINE_TESTING.md`
- `RLS_AUDIT.md`
- `SECURITY_THREAT_MODEL.md`
- `src/auth/authState.test.ts`
- `src/auth/authState.ts`
- `src/auth/offlineGrant.test.ts`
- `src/auth/offlineGrant.ts`
- `src/components/DiagnosticsPage.tsx`
- `src/pwa/contentCache.test.ts`
- `src/repositories/contracts.ts`
- `src/repositories/localSongRepository.ts`
- `src/repositories/supabaseAuthRepository.ts`
- `supabase/functions/offline-grant/index.ts`
- `supabase/migrations/202608110001_offline_grant_audit.sql`
- `tests/rls-policy.integration.test.ts`

Před začátkem existující lokální změny `SECURE_ACCESS_SETUP.md`, `src/components/AccountAccessPage.tsx` a `admin.txt` nebyly součástí patche ani commitu.

## Ověření

- Lint: prošel.
- TypeScript typecheck: prošel.
- Unit testy: 23 souborů, 95 testů prošlo.
- Integrační testy: 5 souborů, 27 testů prošlo.
- Playwright: 40 scénářů napříč pěti viewporty; 24 prošlo a 16 bylo záměrně přeskočeno jako duplicitní drahé scénáře.
- Dodatečný regresní test režimu „U ohně“ na 390 × 844 px: prošel; režim již automaticky neaktivuje fullscreen.
- E2E i produkční build: prošel; zůstává pouze neblokující upozornění na velké lazy chunk soubory PDF/OSMD.
- Interaktivní kontrola: mobilní Offline, Nastavení a čtečka bez vodorovného přetečení; konzole bez warning/error záznamů.

## Známá omezení

1. Offline revokace nemůže být okamžitá bez kontaktu se serverem; účinek nastane při dalším online ověření nebo expiraci grantu.
2. Legacy chráněná data z databáze verze 4 bez `ownerUserId` zůstávají čitelná jen do prvního nového online refresh/importu; poté je nahradí uživatelsky svázaný balíček.
3. Outbox zatím nemá samostatný periodický/background replay worker.
4. Podepsaný offline režim nebude aktivní, dokud administrátor nenasadí migraci a funkci a nenastaví veřejné i tajné hodnoty.
5. Behaviorální RLS testy je nutné zopakovat proti staging Supabase projektu; lokální test neprokazuje konfiguraci vzdáleného projektu.

## Co musí administrátor udělat před produkcí

1. Vytvořit nebo použít izolovaný Supabase staging projekt a zálohu produkčního schématu.
2. Aplikovat `supabase/migrations/202608110001_offline_grant_audit.sql` nejdříve na staging.
3. Vygenerovat ES256 key pair; privátní JWK uložit pouze jako secret Edge Function, veřejný JWKS publikovat do build-time konfigurace s odpovídajícím `kid`.
4. Nastavit přesný `OFFLINE_GRANT_ALLOWED_ORIGINS`, issuer, audience a zvolenou platnost (doporučený start 30 dní).
5. Nasadit `supabase/functions/offline-grant` na staging a ověřit schválený, zamítnutý, pozastavený a admin účet.
6. Spustit behaviorální RLS testy A/B/admin, zkontrolovat audit a ověřit, že klient nikdy neobdrží service role ani privátní klíč.
7. Vygenerovat a podepsat staging manifest soukromé knihovny, ověřit SHA-256, rollback po přerušeném importu a přepnutí mezi dvěma účty na jednom zařízení.
8. Otestovat cold start bez sítě na Androidu, iOS Safari/PWA a desktopu, včetně expirace a ručního odhlášení.
9. Teprve poté aplikovat stejný postup do produkce s možností rychle vypnout vydávání nových grantů; nasazení po dobu monitoringu nechat bez destruktivní migrace obsahu.

Detailní postup je v [DEPLOYMENT.md](DEPLOYMENT.md), testovací matice v [OFFLINE_TESTING.md](OFFLINE_TESTING.md) a hrozby v [SECURITY_THREAT_MODEL.md](SECURITY_THREAT_MODEL.md).
