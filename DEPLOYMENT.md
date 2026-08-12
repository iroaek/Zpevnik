# Nasazení PWA s Neonem

## Veřejná adresa

Před produkčním buildem nastavte úplnou HTTPS adresu s koncovým lomítkem:

```powershell
$env:VITE_PUBLIC_BASE_URL='https://iroaek.github.io/Zpevnik/'
npm run build
```

Z adresy se odvodí Vite `base`, PWA manifest, canonical odkazy, SPA fallback a QR kódy. GitHub Pages hostuje pouze statickou PWA; účty a chráněná data zajišťuje Neon, takže po nasazení může být osobní počítač vypnutý.

## Neon Auth a Data API

1. Na cílové Neon větvi zapněte Neon Auth a Data API se stejným auth providerem.
2. Mezi Trusted origins přidejte přesný původ produkce a lokální vývojové adresy, například `https://iroaek.github.io`, `http://localhost:5173` a `http://127.0.0.1:5173`.
3. Přes migrační spojení aplikujte v pořadí:
   - `neon/migrations/202608110001_application_schema.sql`;
   - `neon/migrations/202608120001_neon_auth_content.sql`.
4. Ověřte RLS pro anonymního, čekajícího, schváleného a administrátorského uživatele. Runtime role nesmí mít `BYPASSRLS`.
5. První správce musí vytvořit nebo obnovit heslo v Neon Auth. Původní hash hesla z jiného auth systému nelze bezpečně převzít.

## Proměnné GitHub Actions

V **Settings → Secrets and variables → Actions → Variables** nastavte pouze veřejné hodnoty:

- `VITE_PUBLIC_BASE_URL=https://iroaek.github.io/Zpevnik/`
- `VITE_NEON_AUTH_URL=<veřejná adresa Neon Auth>`
- `VITE_NEON_DATA_API_URL=<veřejná adresa Neon Data API>`
- `VITE_NEON_OFFLINE_DAYS=30`
- `VITE_REQUIRE_SECURE_ACCESS=true`

Do `VITE_*`, Git repozitáře ani statického buildu nikdy nevkládejte PostgreSQL connection string, heslo správce nebo migrační přihlašovací údaje.

## Privátní knihovna

Balíčky se ukládají do verzovaných řádků a bloků PostgreSQL. Aktivní verze se přepne jedinou RPC operací až po ověření úplnosti bloků.

```powershell
$env:NEON_AUTH_URL='<auth-url>'
$env:NEON_DATA_API_URL='<data-api-url>'
$env:NEON_APP_ORIGIN='https://iroaek.github.io'
$env:NEON_MIGRATION_EMAIL='<admin-email>'
$env:NEON_MIGRATION_PASSWORD='<jednorázově zadané heslo>'
npm run upload:neon-content
```

Skript ověřuje manifest, velikost a SHA-256. Přihlašovací údaje se nesmějí uložit do `.env`, historie terminálu, logu CI ani repozitáře. Nahrání nejprve proveďte ve staging větvi a až po funkčních a RLS testech zopakujte v produkci.

## GitHub Pages

1. V **Settings → Pages → Source** vyberte **GitHub Actions**.
2. Push do `main` spustí testy, build a publikaci workflow `.github/workflows/deploy-pages.yml`.
3. `404.html` je kopie app shellu, takže fungují i obnovené klientské odkazy.
4. Po nasazení na iPhonu otevřete HTTPS odkaz v Safari a použijte **Sdílet → Přidat na plochu**.

## Offline oprávnění

Po online přihlášení aplikace ověří Ed25519 podpis Neon Auth tokenu proti veřejnému JWKS, zkontroluje schválený profil a uloží omezené offline oprávnění. Stažený balíček je oddělen podle uživatele. Odhlášení nebo vypršení oprávnění nezpůsobí tiché přihlášení pod jiným účtem; obnova vyžaduje krátké online ověření.

## Kontrola a rollback

- před produkcí spusťte `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run build` a `npm run test:e2e`;
- ověřte login, registraci, schválení, členskou/admin knihovnu, upload PDF, synchronizaci a offline reload;
- při chybě vraťte předchozí GitHub Pages artifact/commit; aktivní Neon obsahové revize nemažte, dokud není příčina potvrzená;
- databázové destruktivní kroky a zrušení starého poskytovatele provádějte až po ověřené produkční retenci a záloze.
