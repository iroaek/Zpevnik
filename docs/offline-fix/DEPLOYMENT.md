# Produkční nasazení offline opravy

7. 9. 2026 uživatel po dokončení lokální opravy výslovně požádal „tak to dej live“. Tím povolil následný release commit, push a nasazení přes stávající GitHub Pages.

- Živá adresa: [Český zpěvník](https://iroaek.github.io/Zpevnik/).
- Nasazená revize: `6e61c72134612556474c02c35dbaa1dbf8fcaf6c`, build ID `6e61c7213461`.
- [Nasazení GitHub Pages](https://github.com/iroaek/Zpevnik/actions/runs/34146724733): **SUCCESS**. [Strojový záznam](deployment-run.json).
- CI na nasazované revizi: **245 unit + 58 integračních + 49 e2e PASS**; dalších 70 e2e případů záměrně přeskočeno podle viewportu. Produkční build prošel, precache má 55 položek.
- [Navazující kontrola produkce](https://github.com/iroaek/Zpevnik/actions/runs/34147135660): **SUCCESS**. PWA, manifest, worker a Neon JWKS HTTP 200; chráněné Data API odmítlo anonymní požadavek HTTP 400 s chybou chybějící autentizace.
- Nezávislá kontrola živého webu v Chromium v **17:20:26 UTC**: potvrzena správná revize ve skutečně staženém JS a všech **47 SHA-256** položek app shellu. Scope i start URL zůstávají `/Zpevnik/`. Povinné přihlášení se zobrazuje, konfigurace nechybí, nejsou chyby JavaScriptu, chybějící soubory ani vodorovné přetékání při 390 × 844 px. [Výsledek](live-smoke-results.json), [snímek](live-login-390x844.png).

Produkční účet nebyl přihlašován: secrets `PRODUCTION_TEST_EMAIL` a `PRODUCTION_TEST_PASSWORD` nejsou nastavené, proto je tato část automatického health testu výslovně přeskočena. Fyzický telefon a produkční offline grant zůstávají neověřené; místní důkaz nového offline procesu s expirovaným access tokenem je v [OFFLINE_FIX_REPORT.md](../../OFFLINE_FIX_REPORT.md).

Publikován je existující klient se stejnými veřejnými Neon endpointy a `VITE_REQUIRE_SECURE_ACCESS=true`. Backend, schvalování, RLS, účetní data ani osobní PWA profil se neměnily. Commit obsahuje pouze 42 vyjmenovaných souborů opravy, testů a sanitizovaných důkazů; původní místní změny katalogů a soukromé soubory zůstaly mimo commit.

Pro již nainstalovanou PWA: při zapnuté síti v sekci Offline zvolit **Zkontrolovat aktualizaci**, potom **Nainstalovat aktualizaci**. V nové verzi dokončit **Dokončit offline přípravu** a následně provést popsaný test úplného zavření a nového spuštění bez sítě. Aktualizace zachovává existující profil a uživatelská data.
