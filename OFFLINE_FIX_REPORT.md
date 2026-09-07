# Oprava skutečného offline přístupu

7. 9. 2026. Tato zpráva zachycuje lokální opravu a důkazy před nasazením. Původní úkol byl dokončen bez commitu, pushe a produkčního deploye; následným pokynem „tak to dej live“ uživatel nasazení povolil. Backend, schvalování účtů a serverové RLS se nemění. Lokální ověření používá syntetické účty a krátký syntetický obsah, nikoli osobní browserový profil nebo produkční data.

## Prokázaná příčina

Současný klient skutečně používá **Neon Auth / Better Auth**, `BetterAuthVanillaAdapter` z instalovaného `@neondatabase/neon-js@0.7.0-beta`. Ověřeno v klientovi, SDK, SQL a veřejném nasazeném JavaScriptu. Podrobnosti a původní červené testy jsou v [OFFLINE_ROOT_CAUSE.md](OFFLINE_ROOT_CAUSE.md).

- `src/auth/secureAccess.ts` / `normalizeSession`: SDK nahradí neprůhledný session token krátkým JWT z `set-auth-jwt`, ale ponechá dlouhé `session.expiresAt`. Klient přebíral tuto dlouhou expiraci místo podepsaného JWT `exp`; mohl posílat expirovaný access token serveru. Původní reprodukční test dostal sedm dní místo patnácti minut.
- `jwtFromSessionToken` / `restorePersistedSession`: HTTP 503 se měnil na „relace neexistuje“ a mazal jedinou uloženou obnovovací session. Druhý reprodukční test ztrátu skutečně zachytil. Oprava zachovává credential také při poškozeném tokenu z HTTP 200; maže jej až při potvrzeném odmítnutí session.
- `neonAuthRepository.issueOfflineGrant`: `ensure_my_profile` podle stávající SQL funkce synchronizuje roli až **po vydání login JWT**. Schválený profil s původně podepsanou rolí `user/pending` proto neprojde kontrolou balíčku. V původním produkčním klientu `d53ed1d` jsme tuto cestu reprodukovali: HTTP odpovědi 200, dva texty skutečně v IndexedDB, žádný grant, **2/3 a žádná offline platnost**. Opravený klient vyžádá čerstvý serverový podpis a znovu jej ověří; kontrolu role neobchází.
- Ověřeny i závody: původní hook kontroloval pořadí až po zápisu grantu; ID zařízení se inicializovalo dvěma transakcemi. Nové testy kontrolují logout, přepnutí účtu, zrušený zápis a souběžnou inicializaci. `idb@8.0.3` už u `put` čeká na dokončení transakce; samotná tato zkratka nebyla příčinou.

To prokazuje konkrétní vady současného kódu a lokální cestu ke stavu ze snímku. **Neprokazuje to přesnou historickou příčinu na původním telefonu**: jeho session, podepsané claims a tehdejší síťové odpovědi nemáme.

## Co se změnilo

`useSecureAccount` je společná orchestrace obnovy a přípravy. Načte a kryptograficky ověří místní grant souběžně se síťovou kontrolou; platné lokální čtení na síť nečeká. Obnovy deduplikuje, omezuje časem a ruší při změně účtu. Před zápisem kontroluje aktuální úlohu i trvalou revizi záměru přihlášení. Ztráta sítě nebo expirace online tokenu vrátí i již otevřenou stránku do ověření místního grantu. Nemůže zůstat neomezeně v původní online autorizaci. Expirace grantu blokuje další offline čtení a ukáže výzvu k online obnově.

`neonAuthRepository` kontroluje serverový profil, jeho vazbu `auth_user_id` na podepsané `sub`, schválení, registraci zařízení, Ed25519 podpis, issuer/audience, ověřený e-mail, podepsanou roli, `kid`, čas a obsahový balíček. JWKS bere výhradně z nakonfigurovaného Auth endpointu; při rotaci neznámého `kid` je jednou obnoví. Klíče zůstávají s grantem v původním `offlineAuth/current` a při offline startu se nestahují.

Zachována je stávající politika `VITE_NEON_OFFLINE_DAYS` v rozmezí **1–30 dní od podepsaného `iat`**, nezávislá na krátkém online `exp`. Online API nadále vyžaduje platný online token a serverové oprávnění. Offline grant ani místní role nenahrazují serverovou autorizaci.

`storage/database.ts` explicitně převádí IndexedDB **9 → 10**; přidává pouze `account/authIntent` se `schemaVersion: 1`. Existující store, formát grantu a uživatelský stav schématu 7 zachovává. ID zařízení vzniká v jedné transakci. Zápis grantu čeká na commit, pak se znovu načte a ověří. Chyba kvóty a abort zachovávají poslední platný záznam. Logout odstraní autorizační údaje, nikoli písně, importy, oblíbené, setlisty či frontu změn. Selhání hydratace uživatelského stavu nepřepíše data výchozími hodnotami.

`App.tsx` nepřevezme pozdně načtený seznam chráněných písní jiného účtu. Staré členské záznamy **bez evidovaného vlastníka** zůstanou fyzicky zachované, ale neslouží jako oprávnění pro libovolný účet; online autorizované stažení obnoví správnou vazbu. Soukromé importy nejsou tímto filtrem mazány.

V původním designu přibyla akce **Dokončit offline přípravu**. Zkontroluje/obnoví grant, ověří jeho trvalé uložení, skutečné texty a akordy a kontrolní součty app shellu. Úplnou knihovnu znovu nestahuje. Hlásí konkrétní bezpečné kódy včetně chybějícího grantu/klíče, podpisu, identity, expirace, zápisu, místního úložiště a neúplného obsahu. Zelený stav plyne z ověřeného grantu a lokálních dat.

Service worker drží správný `/Zpevnik/` scope/start URL a veřejné lazy moduly. HTML fallback vylučuje API, auth, JSON a soubory. Při aktualizaci zachová veřejné JS/CSS starších klientů v cache historie; chráněné odpovědi se do ní nekopírují. `inspectAppShell` kontroluje inventář skutečně otevřeného buildu a skutečné lokální bajty, bez sítě. Zahrnut je také `pdf-engine`, který je podle výsledného importního grafu přímou závislostí startu, přesto jej původní konfigurace vylučovala. Chybějící povinný JS v testu způsobí `shell_incomplete` a 2/3; odstraněná veřejná položka testovací cache je před cold startem vrácena beze změny. Nebyl přidán externí runtime, webfont, CDN ani analytika.

## Přihlášení a obnova

| Větev | Ověření a výsledek |
|---|---|
| Heslo | Reálné UI + instalovaný SDK + syntetický HTTP server: serverově podepsaný grant se uloží. |
| Jednorázový kód | Zachován povinný druhý kód a nastavení hesla; mezikrok OTP sám neemituje `SIGNED_IN`. Kompletní větev UI vydá a uloží grant. |
| Registrace a ověření e-mailu | Cílený test: neověřená registrace nevytváří přístup; ověření e-mailu s heslem vede do společného login toku. Schválení se stále ověřuje zvlášť. |
| Starší session / chybějící grant | Původní profil s daty se obnoví bez nového loginu; bez cookie funguje uložený bearer credential (cílený test). Ruční příprava doplní chybějící grant. |
| Čekající a nově schválený účet | V UI čekající účet nezíská grant ani texty. Po online schválení v téže session získá nový podpis; není nutný logout. |
| Odkaz obnovy hesla | Testuje se použití a odstranění kódu z URL; samotný reset hesla nepřiděluje členský přístup. |
| OAuth / magic-link login | V současném UI nejsou implementovány. Odkaz obnovy hesla není magic-link login. |

Mapování původního ID na Neon identitu zůstává ve stávající serverové funkci `ensure_my_profile` v `neon/migrations/202608120002_require_verified_email.sql`, která pracuje s ověřenými serverovými claims. Klient neslučuje identity jen podle jím dodaného e-mailu.

## Důkazy A / B / C

**A — PASS:** online příprava skutečného produkčního klienta, následné zavření lokálního HTTP hostingu i auth/data serveru, vypnutí sítě v Chromium, otevření a reload stažené písně. Nezachycený kontrolní `fetch` selhal.

**B — PASS:** zcela nový proces Chromium přes `launchPersistentContext` nad týmž vyhrazeným `userDataDir`, se `offline: true` již před navigací. Žádný export/import `storageState`, žádné nasazení hotového grantu do databáze, žádné podvržení React auth stavu. Online fáze používá oddělený syntetický HTTP server, který ověřuje testovací přihlašovací údaje, podepisuje JWT testovacím Ed25519 klíčem a na datovém API odmítá expirovaný token. Nejde o produkční Neon účet. Během offline fáze jsou oba HTTP servery skutečně zavřené; žádné testovací routy nevracejí auth ani písně.

JWT v testu platí 12 sekund; před novým procesem čekáme na jeho skutečnou expiraci, bez změny hodin či tokenu. Offline grant dále platí 30 dní. Ověřen start_url, přímý deep link na předem staženou, dosud neotevřenou píseň, místní text/akordy, hledání, transpozice, oblíbené a nový setlist. Uložení transpozice se řídí existující volbou **Vlastní aranžmá této písně**, kterou test zapne. Další nový offline proces ověří zachované změny; po návratu sítě se tytéž změny nahrají na testovací server.

Původní build `offline-old` vychází z lokální git revize `d53ed1d`, sestavené bez checkoutu pracovního stromu. Následuje `offline-new` nad totožným profilem/originem `http://127.0.0.1:4187/Zpevnik/`. Hash obsahu a ID zařízení zůstane shodný, databáze přejde z 9 na 10. Starý lazy modul čtečky je dostupný offline i po aktivaci nového workeru. Poslední souvislý běh: reprodukce 17:01:20–24 UTC, opravený klient 17:02:41–17:03:15 UTC. V cold startu je zaznamenáno **130 úspěšných odpovědí, všechny ze service workeru**, a selhání nezacachovaného síťového dotazu. Souhrn obsahuje osm úspěšných scénářů (chybějící povinný JS, login větve, schválení, A, B, návrat sítě), plus reprodukci původní vady.

**C — NEOVĚŘENO NA ZAŘÍZENÍ:** fyzický Android/Chrome ani iOS/Safari nebyl dostupný. Desktopový Chromium s mobilním viewportem není vydáván za test nainstalované PWA na telefonu.

Sanitizované důkazy:

- [Původní 2/3](docs/offline-fix/before-2-of-3.png), [příprava po opravě](docs/offline-fix/after-prepared.png), [nový offline proces po expiraci access tokenu](docs/offline-fix/after-cold-start-expired-access-token.png).
- [Log původního buildu](docs/offline-fix/before-browser-evidence.json), [log opraveného buildu](docs/offline-fix/after-browser-evidence.json). Obsahují časy UTC, build ID, fáze, HTTP statusy, klientské diagnostické kódy a důkaz vypnuté sítě. Neobsahují cookies, tokeny, celé granty, privátní klíče ani obsah písní.
- [Veřejná konfigurace nasazení](docs/offline-fix/public-configuration.json).

## Spuštěné kontroly

| Příkaz | Výsledek |
|---|---|
| `npm run lint` | PASS i po posledních změnách. |
| `npm run typecheck` | PASS. |
| `npm run test:unit` | 52 souborů, **241/241 PASS**. |
| `npx vitest run src/hooks/useSecureAccount.test.tsx src/auth/secureAccessOtp.test.ts src/auth/secureAccessOfflineRegression.test.ts` | Po posledním doplnění registrační/recovery větve a ztráty sítě/expirace za běhu **25/25 PASS**; čtyři testy navíc proti úplnému běhu, ostatní se překrývají. Celkem ověřeno 245 různých unit případů. |
| `npm run test:integration` | 11 souborů, **58/58 PASS**. |
| `npm run build` | PASS; běžný produkční build, včetně generátorů a SPA fallbacku. |
| `npm run test:e2e` | **49 PASS, 70 záměrně přeskočeno** podle viewportu, 0 selhání; exit 0. Na Windows bylo po všech případech nutné ukončit zaseknutý testovací Vite/npm preview proces; pak runner vypsal souhrn a skončil. |
| `npx playwright test e2e/mobile-pwa.spec.ts --project=mobile-390x844 --grep 'výslovně stažené noty' --output=tmp/offline-fix/scores-test` | **1/1 PASS** po doplnění explicitního přepnutí na housle a violoncello bez sítě. |
| `node scripts/offline-fix-browser.mjs --before` a následně `node scripts/offline-fix-browser.mjs` | Reprodukce 2/3 a samostatný zabezpečený produkční tok A/B výše. |
| `node scripts/offline-fix-public-config.mjs` | Read-only veřejný HTML/JS/JWKS audit; nezkouší produkční přihlášení. |

Regrese zahrnují podpis, role, issuer/audience/sub, `iat/nbf/exp`, sekundy vs. milisekundy, vypršelý grant, rotaci/chybějící klíč, uložení a readback, kvótu, souběžné device ID, logout/přepnutí účtu, blokované lokální čtení, timeout/fetch/5xx/401/403 a výslovnou revokaci. Generické HTTP 401/403/5xx se nepovažuje za odebrání členství. Schválený profil nebo důvěryhodný revokační kód se posuzují samostatně.

České H/B, lomené akordy a přípony pokrývají existující unit testy i syntetické browserové příklady. Offline housle i violoncello se skutečně vykreslily jako SVG. Kvóta a blokované lokální čtení jsou simulovány na hranici IndexedDB; fyzický telefon nebyl zaplněn ani poškozován. Běžná e2e sada používá veřejný testovací režim; její úspěch není zaměňován za důkaz zabezpečeného cold startu B.

## Konfigurace, kompatibilita a neověřené kroky

Veřejný audit 7. 9. 2026 v 16:09 UTC našel nasazené Neon Auth `/neondb/auth` a Data API `/neondb/rest/v1`; konkrétní veřejné adresy jsou v přiloženém JSON. JWKS vrátil **200, JSON, Ed25519/EdDSA**, s povoleným originem `https://iroaek.github.io`. Tím je vyloučeno aktuální 404/HTML na tomto veřejném JWKS endpointu. Není tím ověřeno produkční vydání grantu, credentials/CSRF pro login, podepsaný issuer/audience konkrétní session, stav účtu ani skutečná serverová migrace.

Lokální `.env.local` používá staré názvy Supabase, zatímco workflow `.github/workflows/deploy-pages.yml` předává Neon proměnné. Aktualizována `.env.example`: pro lokální/staging provoz nastavit celé veřejné `VITE_NEON_AUTH_URL`, `VITE_NEON_DATA_API_URL`, správné `VITE_PUBLIC_BASE_URL`, `VITE_REQUIRE_SECURE_ACCESS=true` a stávající `VITE_NEON_OFFLINE_DAYS` (1–30). Lokální testovací server tyto hodnoty nastavuje jen pro svůj proces. Soukromé klíče, hesla, `DATABASE_URL` ani Neon API key nepatří do `VITE_*` nebo chatu.

**Oprava nezavádí novou serverovou funkci, backendovou migraci ani nový produkční signing secret.** Pro úplné produkční ověření správce musí potvrdit nasazení stávajících funkcí `ensure_my_profile` a `register_my_device` podle repozitáře; veřejný audit verzi produkční databáze neověřil. V době výše uvedených lokálních kontrol produkční nasazení ještě nebylo autorizované. Následný pokyn uživatele povolil nasazení klienta, ale nenahrazuje ověření s oprávněným produkčním testovacím účtem. Výše popsaná veřejná kontrola není důkazem produkčního offline přihlášení.

Existující PWA nebyla mazána, odinstalována ani přenášena na jiný origin. Generované katalogy se upravovaly výhradně projektovými generátory při povinném buildu; tři původně změněné generované soubory byly po kontrolách vráceny **byte-for-byte**, ověřeno SHA-256. Nechtěné změny devíti starších screenshotů z běžné e2e sady byly také vráceny. [Záznam zachování pracovních dat](docs/offline-fix/workspace-preservation.json). Oddělené syntetické browserové profily a testovací klíč jsou pouze v ignorovaném `tmp/offline-fix/`. Bez souhlasu se žádná produkční data ani účty nemění.

Ruční scénář C pro správce: na nainstalované PWA online přihlásit schválený testovací účet a dokončit přípravu; poznamenat ověřenou platnost. Úplně zavřít PWA, zapnout režim letadlo **a vypnout Wi-Fi**, spustit ikonou. Otevřít dosud neotevřenou předem staženou píseň, vyhledávat, transponovat (pro zachování zapnout vlastní aranžmá), uložit oblíbenou a setlist. Znovu úplně zavřít/spustit bez sítě, ověřit změny. Po připojení ověřit synchronizaci bez ztrát. Opakovat po vypršení online access tokenu, ale před koncem offline grantu; nemažte profil ani data PWA. Zaznamenat OS/prohlížeč/build a výsledek zvlášť pro Android a iOS.

Zbytková omezení stávající politiky: offline telefon se o novém serverovém odvolání dozví až při dalším úspěšném spojení nebo skončení lokální platnosti. Podpis obsah nešifruje, hodiny klienta nejsou důvěryhodný serverový čas a lokální device ID není hardwarová ochrana proti kopírování. Cache historie veřejných chunků záměrně neodstraňuje staré soubory otevřených klientů; může postupně růst. `storage.persist()` ani tento postup nezaručují zachování při ručním smazání dat nebo zásahu systému.

## Následné autorizované nasazení

Na dodatečný pokyn uživatele byla oprava 7. 9. 2026 nasazena na stávající [živý zpěvník](https://iroaek.github.io/Zpevnik/) v revizi `6e61c72134612556474c02c35dbaa1dbf8fcaf6c`. Nasazení, celý CI běh a nezávislé ověření živé verze prošly. Přesné výsledky, odkazy na workflow a zbývající neověřené produkční kroky jsou v [záznamu nasazení](docs/offline-fix/DEPLOYMENT.md).

## Následná regrese formátu odpovědi API

Po nasazení uživatel nahlásil chybu „Neon Data API nevrátilo JSON“ spolu s chybějícím grantem. Nová MIME kontrola odmítala i validní JSON a prázdné úspěšné odpovědi. Byla nahrazena bezpečným parsováním skutečného těla; HTML a poškozené JSON zůstávají odmítnuté. [Zpráva hotfixu](docs/offline-fix/mime-hotfix/REPORT.md) obsahuje červené testy před opravou, devět úspěšných browserových scénářů a opakovaný důkaz skutečného offline restartu po expiraci online tokenu.
