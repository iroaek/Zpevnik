# Nasazení PWA

## Povinná veřejná adresa

Před produkčním buildem nastavte úplnou kanonickou HTTPS adresu s koncovým lomítkem:

```powershell
$env:VITE_PUBLIC_BASE_URL='https://zpevnik.example.cz/'
npm run build
```

Pro podadresář použijte například `https://example.cz/tabor/zpevnik/`. Z této hodnoty se odvodí Vite `base`, manifest `id`, `start_url` a `scope`, canonical odkazy, sitemap, SPA fallback a všechny QR kódy. Výchozí doména `.invalid` slouží pouze k lokálnímu sestavení a před veřejným nasazením se musí nahradit.

## GitHub Pages

1. Nahrajte projekt do GitHub repozitáře s výchozí větví `main`.
2. V **Settings → Pages → Source** vyberte **GitHub Actions**.
3. Nastavte proměnnou `VITE_PUBLIC_BASE_URL=https://<vlastník>.github.io/<repozitář>/`.
4. Workflow `.github/workflows/deploy-pages.yml` při každém pushi do `main` spustí testy, vytvoří produkční `dist` a teprve po úspěchu jej publikuje na GitHub Pages.
5. `404.html` je kopií app shellu, takže obnovení `/songs/<id>` neskončí chybou aplikace.
6. Vlastní doménu nastavte v **Settings → Pages → Custom domain**, upravte DNS a zároveň nastavte repository variable na finální HTTPS adresu.

## Cloudflare Pages

V **Workers & Pages → Create → Pages → Import repository** nastavte:

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`
- Environment variable: `VITE_PUBLIC_BASE_URL=https://vaše-doména/`

Příklad je v `deploy/cloudflare-pages.example.json`. Build vytváří `_redirects` pro SPA fallback a `_headers` s CSP, zákazem sniffingu, omezením oprávnění a cache pravidly. Vlastní doménu připojte v **Custom domains**, ověřte aktivní certifikát a teprve poté vytiskněte QR list z `/qr/index.html`.

## Kořen a podadresář

- Kořen: `VITE_PUBLIC_BASE_URL=https://zpevnik.example.cz/`
- Podadresář: `VITE_PUBLIC_BASE_URL=https://example.cz/zpevnik/`

Vždy nasaďte celý obsah `dist/` beze změny adresářové struktury. Hosting musí vracet `index.html` nebo vygenerovaný `404.html` pro klientské deep linky.

## Soukromé účty a schvalování

GitHub Pages je statický hosting a sám neumí bezpečně zpracovat hesla, schvalovat účty ani přijímat soubory. Pro soukromý režim nastavte v GitHub Actions také `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` a po dokončení serverové konfigurace `VITE_REQUIRE_SECURE_ACCESS=true`. Kompletní databázová migrace, privátní buckety, první administrátor a pořadí aktivace jsou popsány v [SECURE_ACCESS_SETUP.md](SECURE_ACCESS_SETUP.md).

Pro izolovaný Neon staging nastavte navíc `VITE_DATA_BACKEND=neon`, veřejné `VITE_NEON_DATA_API_URL` a `VITE_NEON_OFFLINE_GRANT_URL`. Výchozí hodnota workflow je záměrně `supabase`. `NEON_DATABASE_URL` je pouze serverový secret Edge Function a nesmí být GitHub repository variable s prefixem `VITE_`.

Do klientského buildu ani GitHub variables nikdy nevkládejte `service_role` nebo jiný tajný serverový klíč. Veřejná PWA smí obsahovat pouze instalační obálku a výslovně veřejný obsah; členské soubory se stahují z privátního bucketu až s platnou relací schváleného účtu.

## Bezpečnostní kontrola

- web musí být dostupný výhradně přes HTTPS;
- `sw.js`, manifest a katalog mají být revalidovány, ne dlouhodobě immutable;
- hashované soubory v `/assets/` mohou mít roční immutable cache;
- ověřte výsledné HTTP hlavičky v nástrojích prohlížeče;
- soukromé setlisty se nikdy nepřenášejí při nasazení.

## Aktivace podepsaného offline oprávnění

Tento krok nejprve proveďte ve staging Supabase projektu. GitHub Pages neumí držet privátní podpisový klíč.

1. Aplikujte `supabase/migrations/202608110001_offline_grant_audit.sql` a ověřte RLS podle `RLS_AUDIT.md`.
2. Vygenerujte standardní EC P‑256 key pair auditovaným nástrojem. Privátní JWK nikdy necommitujte.
3. Do Supabase Function secrets vložte `OFFLINE_GRANT_PRIVATE_JWK`, `OFFLINE_GRANT_ISSUER`, `OFFLINE_GRANT_AUDIENCE`, `OFFLINE_GRANT_ALLOWED_ORIGINS` a volitelně `OFFLINE_GRANT_VALIDITY_DAYS`. Pro Neon staging přidejte `DATA_BACKEND=neon` a serverový `NEON_DATABASE_URL`.
4. Nasaďte `supabase/functions/offline-grant` pouze ve stagingu a proveďte test schváleného/pending/suspended účtu.
5. Do GitHub repository **variables** vložte pouze veřejné hodnoty `VITE_OFFLINE_GRANT_ISSUER`, `VITE_OFFLINE_GRANT_AUDIENCE`, `VITE_OFFLINE_GRANT_PUBLIC_JWKS` a pro Neon staging `VITE_NEON_DATA_API_URL`, `VITE_NEON_OFFLINE_GRANT_URL`.
6. Sestavte PWA, ověřte, že build neobsahuje `d` privátního JWK ani service-role key, a spusťte scénáře z `OFFLINE_TESTING.md`.
7. Teprve po schválení zopakujte migraci/function secrets v produkci. Privátní klíč rotujte přidáním nového `kid` do veřejného JWKS; starý veřejný klíč ponechte do expirace všech starých grantů.

Výchozí návrh platnosti je 30 dní, funkce omezuje rozsah na 1–90 dní. Pro konkrétní tábor nastavte konec akce plus bezpečnostní rezervu.

## Rollback offline grantu

Při problému odstraňte veřejné `VITE_OFFLINE_GRANT_*` proměnné a znovu sestavte frontend. Online přihlášení zůstane funkční; nové offline granty se nebudou používat. Nesmažte databázi ani uživatele. Staré granty přestanou být klientem přijímány, ale již stažené soubory fyzicky odstraní uživatel nebo bezpečný logout.

Při problému s Neonem nastavte `VITE_DATA_BACKEND=supabase`, Edge Function vraťte na `DATA_BACKEND=supabase` a znovu nasaďte. Neon ani Supabase data během rollbacku nemažte.
