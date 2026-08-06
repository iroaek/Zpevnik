# Český digitální zpěvník

Mobile-first Progressive Web App pro české táborové, trampské, folkové a další společně zpívané písně. Uživatel ji otevře běžným HTTPS odkazem nebo QR kódem a může ji přidat na domovskou obrazovku bez Google Play či App Storu. Výchozí místní režim backend nevyžaduje; volitelný soukromý režim používá plnou e-mailovou registraci, ruční schválení administrátorem a privátní úložiště.

Repozitář obsahuje pouze původní syntetickou ukázku. Žádný ukázkový text ani partitura nepochází z existující písně.

## 1. Lokální spuštění

Požadován je Node.js 22 nebo novější a npm s podporou lock souboru.

```powershell
cd E:\Zpěvník
npm ci
npm run dev
```

Otevřete adresu vypsanou Vite, obvykle `http://localhost:5173`. Vývojový build používá bezpečnou ukázkovou kanonickou adresu `.invalid`; pro tisk skutečných QR kódů nastavte produkční URL.

### Vyzkoušení na telefonu ve stejné Wi-Fi

```powershell
npm run dev:mobile
```

Příkaz nejprve vytvoří produkční `dist` a po síti zpřístupní pouze tento balíček, nikoli pracovní adresář ani osobní PDF katalog počítače. V telefonu otevřete síťovou adresu, kterou Vite vypíše jako `Network`, například `http://192.168.1.20:4173`. Tato HTTP adresa stačí k vyzkoušení knihovny, čtečky a lokálního importu PDF; soubor vyberete až v telefonu a zůstane v jeho IndexedDB. Instalace PWA a service worker na telefonu vyžadují produkční HTTPS adresu; výjimka `localhost` platí pouze na zařízení, kde server běží.

V dolní navigaci otevřete **Import PDF**, zvolte značení H/B a soubor z telefonu. PDF se zpracuje lokálně, každá textová stránka se uloží do IndexedDB daného zařízení a nic se neodesílá na server. Naskenované obrázky bez textové vrstvy vyžadují předem OCR.

Chcete-li přenést již zpracované osobní písně z počítače, otevřete v desktopové aplikaci **Nastavení → Exportovat celou zálohu**. Vzniklý JSON přeneste do telefonu a v nainstalované PWA zvolte **Nastavení → Importovat celou zálohu**. Záloha obsahuje také texty osobních písní a po importu se uloží pouze do IndexedDB telefonu; GitHub ani hosting je neobdrží.

## 2. Produkční build

```powershell
$env:VITE_PUBLIC_BASE_URL='https://zpevnik.example.cz/'
npm run build
npm run preview
```

Výstup je v `dist/`. Build automaticky:

- validuje a generuje katalog;
- vytvoří PWA ikony 192 × 192, 512 × 512, maskable a Apple Touch;
- vytvoří QR kódy SVG/PNG a A4 list;
- vytvoří `robots.txt`, `sitemap.xml`, `_headers`, `_redirects`, `404.html` a `.nojekyll`;
- vytvoří verzovaný service worker s malým app shellem bez automatického precache všech not.

## 3. Nasazení

Nasaďte beze změny celý adresář `dist/` na statický HTTPS hosting. Tento repozitář publikuje produkční kopii z `main/docs`; workflow `.github/workflows/deploy-pages.yml` při každém pushi ověří testy a sestavení. Příklad pro Cloudflare Pages je v `deploy/cloudflare-pages.example.json`. Přesný postup je v [DEPLOYMENT.md](DEPLOYMENT.md).

Aktuální produkční instalace tohoto repozitáře: **https://iroaek.github.io/Zpevnik/**

Kořen domény:

```powershell
$env:VITE_PUBLIC_BASE_URL='https://zpevnik.example.cz/'
```

Podadresář:

```powershell
$env:VITE_PUBLIC_BASE_URL='https://example.cz/tabor/zpevnik/'
```

Proměnná určuje Vite base path, canonical URL, odkazy, QR kódy, manifest `id`, `start_url` a `scope`.

## 4. Připojení vlastní domény

1. Přidejte doménu v administraci GitHub Pages nebo Cloudflare Pages.
2. Nastavte požadované DNS záznamy.
3. Nastavte `VITE_PUBLIC_BASE_URL` na finální doménu a spusťte nový build.
4. Znovu vytiskněte QR list; starý QR kód stále obsahuje předchozí adresu.

## 5. Ověření HTTPS

V prohlížeči zkontrolujte ikonu zabezpečeného spojení a načtení `manifest.webmanifest` a `sw.js` bez chyb. Instalace PWA, Cache Storage, fullscreen, wake lock a bezpečné aktualizace vyžadují HTTPS; `localhost` je vývojová výjimka.

## 6. Vytvoření QR kódů

```powershell
$env:VITE_PUBLIC_BASE_URL='https://zpevnik.example.cz/'
npm run generate:assets
```

Výstupy jsou v `public/qr/`:

- `hlavni.svg/.png` – hlavní stránka;
- `pisen-<id>.svg/.png` – konkrétní píseň;
- `setlist-<id>.svg/.png` – veřejný setlist;
- `offline.svg/.png` a `instalace.svg/.png`;
- `index.html` – tisknutelný A4 list s hlavním QR kódem a krátkým návodem.

Generování je zcela lokální, s korekcí chyb a klidovým okrajem čtyř QR modulů.

## 7. Test na Androidu

1. Otevřete produkční HTTPS odkaz v Chrome.
2. Ověřte vyhledání a otevření písně v běžné kartě.
3. Otevřete `/install`; tlačítko instalace se smí zobrazit jen po události prohlížeče.
4. Nainstalujte aplikaci, spusťte ji z plochy a ověřte standalone zobrazení.
5. Na `/offline` stáhněte písně, vypněte síť a znovu otevřete píseň.

## 8. Test na iOS

1. Otevřete odkaz v Safari.
2. Na `/install` ověřte návod Safari → Sdílet → Přidat na plochu → Otevřít jako webovou aplikaci.
3. Přidejte aplikaci na plochu a spusťte ji.
4. Ověřte portrait i landscape, bezpečnou degradaci zámku orientace/wake locku a stažené písně bez sítě.
5. Návod se ve standalone režimu nesmí zobrazovat.

## 9. Test bez internetu

1. Online otevřete `/offline`.
2. Zvolte „Stáhnout celý zpěvník“ a počkejte na potvrzení ověření.
3. Noty stáhněte samostatně, pokud je potřebujete.
4. Vypněte síť nebo zapněte režim Letadlo.
5. Obnovte deep link `/songs/<song-id>`.
6. Ověřte, že stažená píseň funguje a nestažený notový part zobrazí srozumitelné upozornění.

## Veřejné trasy

- `/songs/<song-id>` – píseň;
- `/setlists/<setlist-id>` – veřejný zdrojový setlist;
- `/offline` – správa offline obsahu;
- `/import` – lokální import PDF do daného zařízení;
- `/install` – instalace;
- `/help` – jednoduchý návod pro táborníky.

Soukromé setlisty a osobní importy zůstávají v IndexedDB a exportují se pouze na výslovný pokyn uživatele jako JSON. Schvalované víceuživatelské účty a privátní členskou knihovnu zapnete podle [SECURE_ACCESS_SETUP.md](SECURE_ACCESS_SETUP.md); bez serverové konfigurace aplikace zachová místní režim.

## Import vlastních dat

1. Vložte kopie vstupů do `data/import/`.
2. Spusťte `npm run import:data`.
3. Projděte report v `data/normalized/import-<čas>/`.
4. Po právní a obsahové kontrole přesuňte schválené ChordPro do `data/songs/` a party do `data/scores/<song-id>/`.
5. Spusťte `npm run generate:assets`.

Podrobnosti: [IMPORT_GUIDE.md](IMPORT_GUIDE.md), [DATA_FORMAT.md](DATA_FORMAT.md), [RIGHTS_AND_LICENSING.md](RIGHTS_AND_LICENSING.md).

## Kontroly

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
npm audit
```

Automatické mobilní testy pokrývají 320 × 568, 360 × 800, 390 × 844, 430 × 932 a landscape 844 × 390. Ruční scénáře jsou v [PWA_TEST_CHECKLIST.md](PWA_TEST_CHECKLIST.md).
