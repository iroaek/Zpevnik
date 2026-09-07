# Ověření redesignu — 7. 9. 2026

Skutečná aplikace React/Vite byla sestavena a otevřena v Chromium přes Playwright. Následující výsledky zachycují původní místní ověření; následnou přípravu vydání popisuje datovaný záznam na konci. Všechny testovací písně, osoby, PDF a notové party jsou syntetické. Nebyl použit produkční účet ani měněna vzdálená data.

## Příkazy a výsledky

| Příkaz | Výsledek |
| --- | --- |
| `npm run lint` | Prošlo |
| `npm run typecheck` | Prošlo |
| `npm run test:unit` | 50 souborů, 216 testů prošlo; včetně nové regrese vypršení oprávnění |
| `npm run test:integration` | 9 souborů, 45 testů prošlo |
| `npm run test:e2e` | 48 prošlo, 1 selhal na časovém limitu přechodu, 70 podmíněně přeskočeno |
| `npx playwright test e2e/mobile-pwa.spec.ts --project=mobile-390x844 --grep 'navigace používá plynulý' --workers=1` | Prošlo; 183,9 ms, maximální mezera mezi snímky 28,8 ms, žádný prázdný snímek ani layout shift |
| `npx playwright test --workers=1` | 49 prošlo, 0 selhalo, 70 podmíněně přeskočeno; 8,2 min |
| `node scripts/ui-redesign-capture.mjs after` | Prošlo; obnovené snímky skutečného místního režimu aplikace |
| `node scripts/ui-redesign-secure-capture.mjs --after-only` | Prošlo; přihlášení, administrace v 7 rozměrech a 200% text, chráněný offline cold start, nový setlist bez sítě a reconnect |
| `node scripts/ui-redesign-a11y.mjs` | Prošlo; 252 záznamů měření ve třech tématech, text zkratek nejméně 4,87 : 1 |
| `npm run build` | Prošlo, včetně sestavení PWA a SPA fallbacku |
| `node scripts/ui-redesign-production-smoke.mjs` | Původní místní běh prošel: 46 hashů souborů, bezpečná brána, žádné testovací payloady, chybějící assety ani JS chyby; přihlášení tehdy blokovala chybějící místní konfigurace serveru |

První souběžný E2E běh změřil přechod 352,9 ms proti limitu 300 ms. Samostatné opakování i následný celý sériový běh prošly beze změny limitu; v úplné sériové sadě měl přechod 185,6 ms, bez prázdných snímků a layout shiftu. Sedmdesát přeskočení je dáno podmínkami existující sady: například PDF/tisk nebo cold start běží pouze v určeném viewportu. Neznamenají sedmdesát chybějících funkcí.

Integrační sada zahrnuje importy a kontroly lokálních definic autentizace, migrací a RLS. Neprovádí požadavky proti živému databázovému serveru; výsledek proto není potvrzením produkční konfigurace RLS.

Po posledním úplném E2E běhu byla doplněna časová aktualizace platnosti oprávnění. Její regresní test prošel v celé finální sadě 216 jednotkových testů i v samostatné sadě OfflineContent (11 testů); finální secure scénář a produkční kontrola používají již tuto verzi kódu.

## Rozměry a interakce

Ověřené rozměry Chromium: 320 × 568, 360 × 800, 390 × 844, 430 × 932, 844 × 390, 768 × 1024 a 1440 × 900. Knihovna, čtečka, deep linky a navigace nevyvolaly vodorovné přetékání stránky.

Na 390 × 844 začíná první skutečná položka knihovny ve výšce **254 CSS px**; před spodní navigací je **šest celých položek** včetně dlouhého názvu. Ve čtečce jsou vidět **tři celé řádky textu s akordy**, i když jim předcházejí dva řádky intra a původní prázdný řádek.

- 320 px a 200% text: Domů, knihovna, dlouhý detail, setlisty, offline, Více, nastavení, přihlášení a administrace. Poslední obsah je po scrollování dosažitelný nad skutečně změřenou výškou navigace. Správcovské ukazatele se skládají do jediného sloupce. Login má také samostatný snímek při zmenšeném viewportu 320 × 360. Toto je simulace zmenšení okna, nikoli fyzická softwarová klávesnice.
- Dialogy: otevření filtrování, 24 kroků Tab uvnitř modalu, Escape, návrat fokusu; totéž zavření a návrat z detailu akordu. Pozadí nativního dialogu je inertní.
- Čtečka: H/B, H7/F#, Bmaj7, mollová výsledná tónina, kapodastr, ruční lokální oprava s undo/redo, změna písma, dlouhá slova, oddělená intra a prázdný řádek. Ruční kolečko pozastaví automatický posun.
- Zachované funkce: hledání při návratu, hluboké URL, setlisty a oblíbené po reloadu, import syntetického PDF, tisk bez prázdné úvodní stránky, vykreslení syntetických houslí/violoncella a offline stav nenahraných not.
- Kontrast: změřené barvy všech tří témat, primární tlačítko v default/hover/focus/active/disabled stavu a barevné zkratky. Výsledky jsou v `contrast-results.json`. Nejde o úplný audit shody celé aplikace s WCAG.

## Offline a zachování dat

Jednotkové testy zahrnují chybějící, prošlé a cizí oprávnění: dvě ze tří splněných podmínek nikdy neznamenají připravenost. Zvláštní regrese ověřuje automatické zrušení zeleného stavu přesně při vypršení oprávnění na otevřené stránce. Kontrola app shellu čte cache bez stahování, ověřuje SHA-256, odmítá chybějící/poškozený soubor i inventář jiného buildu. Volitelné noty neblokují ověřené texty.

Místní secure scénář používá běžný režim `ui-qa` s povinným přihlášením, syntetické odpovědi na síťové hranici a platný čerstvě podepsaný Ed25519 JWT. Stávající klient ověřuje podpis a skutečně importuje chráněný balíček s kontrolními součty. Při offline části jsou blokovány všechny síťové odpovědi včetně testovacího auth/data serveru. Stránka se zavře a vznikne nová karta; scénář tedy nezůstává pouze v paměti původní stránky.

Toto Chromium v nové kartě řízené service workerem někdy ponechá `navigator.onLine = true` i po `context.setOffline(true)`. Ověření proto navíc vyžaduje skutečné selhání necachovaného požadavku a zobrazení stavu „Offline režim“ z ověřeného lokálního grantu. Testovací endpointy během této části nic nevracejí. Vytvoření dalšího setlistu během tohoto výpadku a jeho zachování po návratu online jsou součástí scénáře; fyzický režim letadlo na telefonu tím ověřený není.

SchemaVersion uživatelského stavu 7, IndexedDB 9 a klíče úložiště se nemění. Existující testy starších formátů, atomického nahrazení knihovny a fronty lokálních změn prošly. Plný upgrade již instalované produkční PWA na fyzickém telefonu nebyl ověřen.

## Neověřeno, omezení a rozsah

- **Původní místní blokace:** produkční režim měl `VITE_REQUIRE_SECURE_ACCESS=true`, ale chyběly skutečné adresy `VITE_NEON_AUTH_URL` a `VITE_NEON_DATA_API_URL`. Běžný build zobrazil „Server není připojený“ a nezpřístupnil lokální profil místo povinného účtu. Konfigurace nebyla nahrazena vymyšlenými servery. Tento historický místní stav zachycuje `screenshots/after-production-config-390x844.png`; ověření existujících proměnných pro vydání je uvedeno níže.
- **Neověřeno na serveru:** skutečné přihlášení heslem/kódem, vydání grantu, schvalování účtu a RLS. Testovací odpovědi potvrzují klientské chování; neověřují konfiguraci vzdáleného prostředí. Staging účet nebyl poskytnut a produkční credentials nebyly použity.
- **Neověřeno na zařízení:** Safari/WebKit, fyzický Android/iPhone, skutečná klávesnice, instalace na plochu, wake lock a případné odstranění cache operačním systémem.
- **Mimo rozsah:** hudební validace soukromého katalogu, přepis algoritmu doporučování kapodastru, backendová migrace a změna účtů/secrets/RLS. Commit, push a deployment nebyly součástí původního místního ověření; následný požadavek uživatele na nasazení je zaznamenán níže.
- **Build:** zůstává upozornění na velký volitelný modul notového rendereru; renderer nebyl v rámci redesignu nahrazován.

## Lokální spuštění

Z kořene projektu spusťte `npm run dev`. Pro kontrolu běžného sestavení použijte `npm run build` a poté `npm run preview -- --host 127.0.0.1`; lokální adresa je `http://127.0.0.1:4173/Zpevnik/`. Přihlášení používá stávající konfiguraci projektu. Místní sestavení bez skutečných adres stávajícího Neon serveru zobrazí výše uvedenou blokaci; nastavené proměnné GitHub Actions se do místního shellu automaticky nepřenášejí.

`npm run build:e2e` je pouze izolovaný místní testovací režim. Není určený k nasazení a neověřuje skutečné přihlášení. Po ověření zůstává v `dist` normální produkční sestavení.

Párové snímky před/po a popis metodiky jsou v `IMPLEMENTATION_REPORT.md`. Běhové logy jsou uchovány v lokálním ignorovaném adresáři `tmp/ui-redesign-initial/`.

## Příprava vydání — 2026-09-07

Uživatel následně výslovně požádal o živé nasazení. Byl potvrzen stávající web GitHub Pages `https://iroaek.github.io/Zpevnik/` a existující proměnné repozitáře: `VITE_REQUIRE_SECURE_ACCESS=true` a vyplněné `VITE_NEON_AUTH_URL` i `VITE_NEON_DATA_API_URL`. Původní místní blokaci tak pro vydání řeší již nastavené proměnné GitHub Actions; backend zůstává beze změny. Nasazení se připravuje a probíhá, tento záznam zatím nepotvrzuje jeho úspěšné dokončení ani skutečné přihlášení na produkci.

Produkční sestavení s ověřenou konfigurací i smoke kontrola následně prošly: `configurationMissing=false`, 46 platných hashů app shellu, žádné chybějící assety ani JS chyby a zobrazená přihlašovací brána. Aktuální výsledek je v `production-smoke-results.json`, snímek v `screenshots/after-production-login-390x844.png`; původní snímek chybějící konfigurace zůstává historickým dokladem bezpečného blokování. Kontrola živého webu před nasazením prošla pro PWA, manifest, service worker, JWKS i odmítnutí anonymního přístupu k Data API. Tyto kontroly nepotvrzují úspěšné přihlášení konkrétního produkčního účtu ani dokončení nového nasazení.
