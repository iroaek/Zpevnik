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
2. V **Settings → Pages → Source** vyberte **Deploy from a branch**, větev `main` a adresář `/docs`.
3. Produkční build vytvořte s `VITE_PUBLIC_BASE_URL=https://<vlastník>.github.io/<repozitář>/` a jeho obsah uložte do `docs/`.
4. Workflow `.github/workflows/deploy-pages.yml` provede testy a kontrolní sestavení; samotné Pages publikuje GitHub přímo z `main/docs`.
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

Do klientského buildu ani GitHub variables nikdy nevkládejte `service_role` nebo jiný tajný serverový klíč. Veřejná PWA smí obsahovat pouze instalační obálku a výslovně veřejný obsah; členské soubory se stahují z privátního bucketu až s platnou relací schváleného účtu.

## Bezpečnostní kontrola

- web musí být dostupný výhradně přes HTTPS;
- `sw.js`, manifest a katalog mají být revalidovány, ne dlouhodobě immutable;
- hashované soubory v `/assets/` mohou mít roční immutable cache;
- ověřte výsledné HTTP hlavičky v nástrojích prohlížeče;
- soukromé setlisty se nikdy nepřenášejí při nasazení.
