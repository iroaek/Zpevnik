# Diagnostika offline přístupu

Výchozí revize: `d53ed1d`; pracovní změny uživatele zachovány. Přečteno celé zadání a oba referenční snímky. Současný klient používá `BetterAuthVanillaAdapter` z `@neondatabase/neon-js`, nikoli Supabase. Screenshot pochází ze staršího UI; sám neprokazuje konkrétní chybu produkčního serveru.

## Potvrzené chyby před opravou

1. `secureAccess.normalizeSession` používá `session.expiresAt`, ačkoli instalované SDK (`@neondatabase/auth/dist/adapter-core-CZ8saNEY.mjs`, `onSuccess`) přepisuje `session.token` hlavičkou `set-auth-jwt`. Dlouhá platnost relace se tak přenese na krátký JWT. Reprodukční test očekává 15 minut a dostává 7 dní. `sessionIsUsable` potom drží expirovaný JWT v paměti a předává ho online API včetně registrace zařízení.
2. `jwtFromSessionToken` vrací `null` pro každé neúspěšné HTTP; `restorePersistedSession` následně maže `account/neonSession`. Reprodukční test pro HTTP 503 prokazatelně ztrácí uloženou obnovovací relaci. Dočasný výpadek tím znemožní následnou obnovu bez cookie.
3. `loadSecureProfile` volá `ensure_my_profile`, který na serveru synchronizuje podepsanou roli (`neon/migrations/202608120002_require_verified_email.sql`). `neonAuthRepository.issueOfflineGrant` však stále ověřuje původní JWT vydaný PŘED touto změnou. Při novém schválení či starší roli `user/pending` schválený profil nesouhlasí s podpisem a grant se neuloží. Nutná je nová serverem podepsaná autorizační informace, nikoli povolení nesouhlasící role.
4. `useSecureAccount.persistOfflineGrant` kontroluje pořadí jen před změnou React stavu, až PO trvalém zápisu. Opožděný výsledek může znovu uložit grant po logoutu. Čtení grantu navíc porovnává device ID s hodnotou ze stejného záznamu místo s identitou instalace.
5. `getOrCreateDeviceId` odděluje čtení a zápis do dvou transakcí; souběžný první přístup může vytvořit dvě identity. `idb@8.0.3` naproti tomu u zkratky `database.put` již čeká i na dokončení transakce: samotná tato zkratka NENÍ potvrzenou příčinou ztráty zápisu. Chybí následné přečtení a ověření.
6. Sestavený `App-*.js` staticky importuje `pdf-engine-*.js`, přesto `vite.config.ts` tento modul vylučoval z precache i inventáře kontrolovaného app shellu. Původní běžný online start ho obvykle zahřál v runtime cache; ukazatel připravenosti jeho přítomnost vůbec nedokazoval. Modul je nově povinný. Browserový regresní scénář dočasně odebere pouze tuto veřejnou cache položku ve vyhrazeném syntetickém profilu, vyžádá `shell_incomplete` a obnoví přesnou původní odpověď před cold startem. Nejde o potvrzenou příčinu chybějícího grantu na referenčním snímku, ale o další potvrzenou mezeru ověření offline startu.

Přihlášení kódem nyní záměrně pokračuje povinným nastavením hesla (`AccountAccessPage.submit` → `completeMigratedPasswordSetup` → `signInSecureAccount`). Chybějící `SIGNED_IN` v mezikroku OTP není samostatně potvrzený bug a bezpečnostní krok se zachová. OAuth/magic-link login není v současném UI implementován; odkaz obnovy hesla je jiná větev.

## Výchozí důkazy

`npx vitest run src/auth/secureAccessOfflineRegression.test.ts`: 2 testy, oba před opravou FAILED (nesprávná expirace; smazaná session při 503). Základní `npm run typecheck` před úpravou prošel. Reprodukce v produkčním buildu s lokálním syntetickým HTTP auth/data serverem a skutečným browserovým profilem je zaznamenána v `docs/offline-fix/before-browser-evidence.json`.

## Co zatím není prokázáno

Konkrétní selhání historické instalace na telefonu, skutečné podepsané claims produkčního účtu, stav jeho cookies/JWKS a případný CORS/404 v době snímku nemáme. Lokální `.env.local` obsahuje staré názvy Supabase, zatímco workflow předává Neon proměnné: konfigurace lokálního a nasazeného buildu nejsou totožné. Nepoužíváme osobní profil ani produkční účet. Výsledná zpráva oddělí lokální důkazy od neověřené produkce.
