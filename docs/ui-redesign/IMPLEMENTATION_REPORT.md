# Implementace redesignu

Úpravy patří do existující aplikace Český zpěvník. React/Vite, Neon Auth, Neon Data API, serverové schvalování a kontrola rolí zůstávají. Nevznikla oddělená aplikace, maketa ani nový backend. Při původním místním ověření nebyl proveden commit, push, deployment ani zásah do produkčních účtů. Následnou přípravu vydání popisuje datovaný záznam níže.

## Změny

| Oblast | Soubory a výsledné chování |
| --- | --- |
| Společný vzhled | `src/ui/interface.css`, `src/styles.css`, `src/main.tsx`: tokeny, menší plochy, formuláře, focus, 44–48px ovládání, mobilní layout; odstranění původních pravidel přestavěných komponent |
| Navigace | `src/App.tsx`, `AppNavigation.tsx`, `MorePage.tsx`: Domů, Písně, Setlisty, Offline, Více; měřená spodní rezerva, zachované URL a role |
| Hledání a knihovna | `SearchField.tsx`, `Library.tsx`: jedno hledání, rychlé filtry, dialog rozšířených voleb, samostatné akce řádku, zachování uloženého pohledu |
| Čtečka | `SongReader.tsx`, `ChordSheet.tsx`: kompaktní ovládání, nástroje v dialozích, akord s odpovídající slabikou, kompaktní intro, dlouhá slova, ruční zásah pozastaví autoscroll |
| Přihlášení a Domů | `AccountAccessPage.tsx`, `HomeDashboard.tsx`: formulář v popředí, zobrazení hesla, chyby propojené s poli, sekundární kód, sbalitelná nápověda; hledání, poslední píseň, šest barevných obdélníkových zkratek podle reference |
| Hudební motiv | `public/images/taborovy-zpevnik.jpg`: nezměněná lokální kopie uživatelova přebalu, použitá jako malá dekorace; provenance v přiloženém README, žádné vzdálené obrázky |
| Offline | `OfflineContent.tsx`, `src/pwa/appShell.ts`, `vite.config.ts`: skutečná kontrola SHA-256 souborů app shellu v cache, samostatný grant a integrita obsahu, kruhový počet ověřených textů, graf odhadu úložiště, cílené akce, noty zvlášť, potvrzení mazání |
| Administrace | `AdminPage.tsx`, `AdminOverview.tsx`: fronta práce, kompaktní ukazatele, čas dat a jejich zastarání; bez duplicitních grafů |
| Setlisty a nastavení | `Setlists.tsx`, sdílené CSS: kompaktnější začátek, sbalitelný formulář, zalamování velkého textu, šipky řazení i drag and drop |
| Pomocné moduly | `Dialog.tsx`, `format.ts`, `motion.ts`: modal a focus, Intl cs-CZ, zkrácené přechody |
| Rozsah počtů | `domain/librarySource.ts`: beze změny přesunut existující čistý predikát původu písně z databázového modulu; jeho původní export zůstal dostupný |

Databázové schemaVersion 7, IndexedDB 9 a všechny klíče úložiště zůstaly stejné. Není přidána migrace. Přesun predikátu nemění ukládání dat. Generování při sestavení probíhalo stávajícími npm příkazy. Po posledním buildu byly tři dříve rozpracované generované JSON soubory vráceny přesně na úvodní uložené bajty a ověřeny kontrolním součtem. Rozpracovaný SECURE_ACCESS_SETUP.md zůstal nedotčený. Soukromé písně nebyly přepisovány.

## Hudební a datové hranice

- Transpozice, parser, H/B, lomené akordy a notový renderer zůstaly. Výsledná tónina v liště nyní zachovává i mollovou příponu metadat; dříve zobrazovala pouze kořen.
- Intro není slučováno přes původní zalomení. Nový test vznikl před odstraněním starého CSS. Syntetické fixture zahrnují prázdný řádek, oddělené intro, H7/F#, Bmaj7, dlouhé slovo i změnu velikosti.
- Čtečka neurčuje tóninu podle prvního akordu. Kvalita skutečných metadat ani původních importovaných akordů není tímto redesignem hudebně ověřena.
- Existující doporučení kapodastru hodnotí kořeny a obtížnost podle dosavadní logiky; jeho označení hmatových tónin je stále zjednodušené. Tento úkol nepřepisuje hudební algoritmus.
- Produkční rozdíl 1 952 / 1 951 nelze bez příslušného účtu potvrdit. Nové UI uvádí rozsah počtů a odděluje členské stažení od osobních konceptů. Nevnucuje shodný počet různým množinám.
- Syntakticky načitatelné akordy nejsou označovány za hudebně správné.
- Volitelné JS moduly PDF a not mají nadále původní lazy loading/cache. Nejsou nutnou podmínkou offline připravenosti textů.

## Snímky skutečné aplikace

Všechny snímky vznikly v Chromium z běžícího React UI. Referenční obrázky nebyly kopírovány do dokumentace. Zobrazené písně a osoby jsou syntetické.

| Obrazovka, 390 × 844 | Před | Po |
| --- | --- | --- |
| Přihlášení | [před](screenshots/before-login-390x844.png) | [po](screenshots/after-login-390x844.png) |
| Domů | [před](screenshots/before-home-390x844.png) | [po](screenshots/after-home-390x844.png) |
| Knihovna | [před](screenshots/before-library-390x844.png) | [po](screenshots/after-library-390x844.png) |
| Píseň | [před](screenshots/before-song-390x844.png) | [po](screenshots/after-song-390x844.png) |
| Offline nedokončeno | [před](screenshots/before-offline-incomplete-390x844.png) | [po](screenshots/after-offline-incomplete-390x844.png) |
| Offline připraveno | [před](screenshots/before-offline-ready-390x844.png) | [po](screenshots/after-offline-ready-390x844.png) |
| Administrace | [před](screenshots/before-admin-390x844.png) | [po](screenshots/after-admin-390x844.png) |
| Setlist | [před](screenshots/before-setlists-390x844.png) | [po](screenshots/after-setlists-390x844.png) |

Srovnávací dvojice používají jeden veřejný syntetický záznam, oblíbenou píseň a setlist. Dodatečné [knihovna s devíti položkami](screenshots/after-library-mobile-390x844.png) a [čtečka s intrem](screenshots/after-reader-mobile-390x844.png) slouží k měřitelnému ověření hustoty. Soubory označené `text-200` zachycují zvětšený text; jejich prioritou je čitelnost a dosažitelnost obsahu.

Přihlášení a administrace používají skutečný secure režim, lokální syntetické odpovědi na síťové hranici a čerstvě vytvořený testovací podpisový klíč. Původní UI se pro tyto dva snímky načetlo z HEAD přes lokální Vite load hook, bez změny pracovních souborů. Snímky veřejného offline režimu nepotvrzují členské oprávnění. Členský scénář má zvláštní [nedokončený stav](screenshots/after-offline-member-incomplete-390x844.png), [ověřený stav](screenshots/after-offline-member-ready-390x844.png) a [novou kartu bez sítě](screenshots/after-member-cold-start-390x844.png).

Celostránkové snímky mohou zobrazovat pevnou navigaci v místě hranice původního viewportu; ovládání posledního obsahu bylo prověřováno také skutečným scrollováním.

## Neověřeno a mimo rozsah

Při původním místním ověření produkční konfigurace vyžadovala secure přístup, ale neměla adresy Neon Auth a Data API. Normální build proto zobrazoval bezpečnou blokující obrazovku „Server není připojený“. Tento výsledek se týkal místního prostředí; následná kontrola existujících proměnných GitHub Actions je uvedena níže. Přihlášení a správcovské snímky jsou odděleně označené lokální testy; podrobnosti obsahuje `VERIFICATION.md`.

Skutečné vydání grantu, přihlášení heslem/kódem, schválení a RLS na produkčním nebo staging serveru nebyly provedeny. Lokální fixture a existující testy potvrzují chování klienta, nikoli správnou konfiguraci vzdáleného prostředí. Nebyl poskytnut staging účet pro tento zásah; produkční credentials nebyly použity.

Neproběhl fyzický test Androidu/iPhonu, Safari/WebKit, skutečné softwarové klávesnice, instalace na plochu telefonu, reálného wake locku ani odstranění cache operačním systémem. Zmenšení viewportu a touch emulace jsou samostatně označené simulace. Kontrastní kontrola a klávesnicové scénáře nejsou prohlášením o shodě celé aplikace s WCAG.

Nebyly měněny produkční účty, secrets, RLS, poskytovatel backendu ani soukromá data. Distribuční varování na velké volitelné notové/PDF moduly zůstává; přepis rendereru je mimo rozsah.

## Příprava vydání — 2026-09-07

Uživatel následně výslovně požádal o živé nasazení. Byl potvrzen stávající web GitHub Pages `https://iroaek.github.io/Zpevnik/` a existující proměnné repozitáře: `VITE_REQUIRE_SECURE_ACCESS=true` a vyplněné `VITE_NEON_AUTH_URL` i `VITE_NEON_DATA_API_URL`. Původní místní blokaci tak pro vydání řeší již nastavené proměnné GitHub Actions; backend zůstává beze změny. Nasazení se připravuje a probíhá, tento záznam zatím nepotvrzuje jeho úspěšné dokončení ani skutečné přihlášení na produkci.

Produkční sestavení s touto konfigurací a následná smoke kontrola prošly: `configurationMissing=false`, všech 46 hashů app shellu odpovídá, žádné chybějící assety ani JS chyby. Aplikace zobrazuje přihlašovací bránu; [nový místní produkční snímek](screenshots/after-production-login-390x844.png) doplňuje historický snímek chybějící konfigurace. Kontrola živého webu před nasazením prošla pro PWA, manifest, service worker, JWKS i odmítnutí anonymního přístupu k Data API. Úspěšné přihlášení konkrétního produkčního účtu tím ověřeno není.
