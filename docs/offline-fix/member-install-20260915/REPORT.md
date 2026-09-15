# Offline oprávnění po instalaci PWA — 15. 9. 2026

## Výchozí stav a rozsah

Uživatel uvádí, že administrátorovi offline režim funguje, ale členové na Androidu i iPhonu dostávají `grant_issue_failed`. Výchozí živá revize je `bd017a3f1b74be5efa4f6b198e1a99971b0b21c7`. Disk E: s původním pracovním stromem nebyl dostupný, proto oprava vzniká v samostatném klonu aktuálního GitHub repozitáře. Původní pracovní soubory ani data existujících PWA se nemění.

Read-only kontrola skutečného produkčního Neonu potvrdila shodnou autorizaci administrátora a schváleného člena: existující účty mají odpovídající Auth role, ověřený e-mail a nejsou zablokované. Obě role mají stejnou cestu přes `register_my_device`; potřebná oprávnění funkce a RLS jsou přítomná. Žádné zařízení není odvolané. Nebyly měněny účty, schválení, SQL funkce, konfigurace ani produkční data.

## Reprodukované příčiny

1. **Společný časový limit přerušuje přípravu.** `useSecureAccount` spouštěl osmivteřinový časovač před načtením session/profilu a nechával ho běžet také při registraci zařízení, JWKS, ověření a ukládání grantu. Šest sekund na přihlášení a tři sekundy na přípravu proto vedly ke zrušení a `grant_issue_failed`, přestože jednotlivé kroky měly být v limitu. Nový regresní test před opravou prokazatelně nedostal ani zápis grantu.
2. **Chybějící nativní Ed25519 znemožní ověření pravého grantu.** Původní verifier vyžadoval nativní `crypto.subtle` podporu Ed25519. Prohlížeč může podporovat instalaci PWA, IndexedDB i ostatní WebCrypto algoritmy a tento algoritmus přesto nemít. `NotSupportedError` se převáděl na stejnou obecnou chybu přípravy. Nejde o zvláštní zákaz členů: administrátor i člen používají stejný verifier. Dostupnost algoritmu popisují [poznámky Chrome 137](https://developer.chrome.com/release-notes/137#ed25519_in_web_cryptography) a [Safari 17](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).

Obě příčiny byly reprodukovány na skutečném aplikačním kódu. Síťové časy a verze prohlížečů konkrétních uživatelů nejsou známé; nezaměňujeme proto reprodukci stejné chyby za zachycení původní chyby na jejich telefonu.

## Oprava

- Síťový časovač se ukončí po dokončení načtení session/profilu. Vydání grantu si ponechá vlastní osmivteřinový limit a zápis vlastní pětivteřinový limit. Rušení při logoutu/přepnutí účtu, kontrola pořadí a trvalá revize záměru přihlášení zůstávají zachované.
- Jen při nativním `NotSupportedError` ověří stejný podpis přímo přibalená knihovna `@noble/curves@2.4.0` v režimu `zip215: false`. Neplatný podpis ani `DataError`/`OperationError` nespouštějí další pokus. Přísný režim odmítá i testovaný podvrh s bodem malého řádu, který permisivní ZIP215 přijímá. [Dokumentace knihovny](https://github.com/paulmillr/noble-curves#consensus-friendliness-vs-e-voting).
- Role, schválení, identita, issuer/audience, podpisové klíče a časová platnost se nemění. Není zaveden žádný nový backend, veřejný přístup k písním, externí runtime požadavek ani mazání PWA.
- Křehký integrační test hledající doslovný řádek verifieru byl nahrazen skutečným ověřením podpisu, uložením/čtením IndexedDB a opětovnou offline autorizací. Test se typově kontroluje v existujícím prohlížečovém TS projektu. Starší kontrola migračního souboru nyní přijímá LF i CRLF; SQL soubor se nemění.

## Testy a důkazy

- Před opravou časovače: 18 případů PASS, 1 FAIL; po opravě 19 PASS, včetně zachování samostatného timeoutu vydání.
- Před opravou kompatibility: 4 PASS, 13 FAIL ze 17 nových případů. Část červených negativních případů původně končila nepodporovaným algoritmem místo zamýšleného důvodu odmítnutí; nedokládají dřívější neoprávněný přístup.
- Po opravě: 17 nových případů kompatibility + 9 existujících případů grantu PASS. Plná unit sada: **274 PASS**. Plná integrační sada: **58 PASS**.
- Nová integrace používá skutečný podepsaný syntetický členský grant, expirovaný online JWT, platný offline interval, nepodporovaný nativní Ed25519 a skutečné transakce fake-indexeddb. Opětovné ověření nepoužije síť.
- [Původní selhání kompatibility](native-ed25519-before.json), [ověření po opravě](native-ed25519-after.json), [souhrn regresí](regression-tests.json).
- Samostatný browserový harness `node scripts/member-install-browser.mjs --before` a poté `node scripts/member-install-browser.mjs` používá produkční sestavení klienta, instalovaný Neon SDK a syntetický HTTP backend. Sign-in neposkytuje JWT hlavičku, raw bearer pro `/token` je odmítnut 401 a cookie session má podporovanou cestu. Není podvržen React auth stav ani předem vložen hotový grant.
- Browserová reprodukce proti `bd017a3`: administrátor s běžnou odezvou PASS; člen s profilem 6 s a registrací/JWKS po 1,5 s **REPRODUCED grant_issue_failed**; člen bez nativního Ed25519 **REPRODUCED grant_issue_failed**. Viz [původní log](browser-before.json). Původní screenshoty zachycují domovskou stránku; konkrétní chybu dokazují diagnostické kódy a zrušený požadavek v logu.
- Opravený zabezpečený browserový běh: **4/4 PASS**. Člen se zpomalením i bez nativního Ed25519 získal ověřený, trvale zapsaný grant za 9,93 s. Administrátor má samostatný testovací profil; nový členský profil nepřebírá jeho cookie ani grant. Pole `preservedProfile` u prvního online startu pouze označuje hlavní testovací adresář, nikoli předchozí přihlášení.
- **Nový offline proces:** oba HTTP servery byly zavřeny v 14:55:17.731 UTC, skutečný JWT vypršel v 14:55:25 UTC. Nový Chromium proces nad týmž členským profilem začal v 14:55:26.622 UTC, se sítí vypnutou již před navigací. V 14:55:28.800 UTC ověřil přímý odkaz na dříve staženou syntetickou píseň, platný grant, shodné ID zařízení a hashe textů. Všech **63 úspěšných odpovědí pocházelo ze service workeru**, nezacachovaný fetch selhal; žádné routy nevracely náhradní odpovědi.
- Druhý nový offline proces od 14:55:29.419 UTC ověřil zachování oblíbené písně a nového setlistu. Viz [úplný log](browser-after.json), [platnost zařízení při přípravě](browser-after-member-prepared.png) a [čtení v novém offline procesu](browser-after-offline-cold-member.png). Screenshot přípravy byl pořízen při závěrečné kontrole app shellu; dokončení a následný cold start dokazují navazující logy.
- `npm run lint`, `npm run typecheck`, `npm run build`: **PASS**. Běžná e2e sada: **49 PASS, 70 záměrně přeskočeno, 0 selhání, exit 0**. Tato sada používá běžný testovací režim; důkaz schváleného člena je samostatný zabezpečený harness výše.
- Dvě omezení lokálního Windows testování byla vyřešena bez změny produktu: Chromium při příliš dlouhé cestě testovacího profilu nedokázalo zapsat SW cache, proto harness používá krátký vyhrazený adresář v systémovém temp. Po dokončení běžné e2e sady bylo potřeba ukončit pouze ověřený vlastní Vite preview proces, aby runner dokončil teardown. Neodstraňovala se data existující PWA.
- Read-only kontrola skutečného Neonu a GitHub konfigurace potvrdila aktivní Neon Auth, zabezpečený režim a stávající schvalovací/serverové funkce. Žádné nové serverové oprávnění ani migrace nejsou potřeba.

## Nasazení

Oprava je připravena k nasazení na stávající GitHub Pages podle dřívějšího výslovného pokynu uživatele „tak to dej live“. Tento záznam vzniká před spuštěním deploymentu; dokončení a živá revize budou zaznamenány zvlášť po ověření CI a veřejných souborů.

## Konkrétní limity

Fyzická instalace a následný restart na postiženém Androidu/iPhonu zatím nejsou ověřené. Chybějící Ed25519 je v Chromium emulováno pouze odmítnutím nativního algoritmu; pravý podpis potom kontroluje skutečná knihovna aplikace. Produkční přihlašovací údaje se nepoužívají.

Známá online obnova raw bearer session bez dostupné cookie z předchozí diagnostiky není touto opravou vydávána za vyřešenou. Offline start s již platným uloženým grantem na této online výměně nezávisí. Hodiny klienta a dosavadní politika offline intervalu se nemění.

Po nasazení je potřeba na postižené nainstalované PWA načíst aktuální verzi online, dokončit offline přípravu, ověřit platnost zařízení, zcela zavřít aplikaci a otevřít ji bez mobilních dat i Wi-Fi. Data PWA ani stažené písně se nemají mazat.
