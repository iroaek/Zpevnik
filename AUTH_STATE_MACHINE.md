# Stavový automat autentizace

Implementace: `src/auth/authState.ts`, koordinace: `src/hooks/useSecureAccount.ts`.

## Stavy

- `checking` – načítání IndexedDB a omezené online ověření (timeout 8 s).
- `authenticated-online` – server právě potvrdil session a profil.
- `authenticated-offline` – server není spolehlivě dostupný a lokální ES256 grant je platný.
- `offline-access-expired` – grant chybí, vypršel nebo časově neplatí; chráněný obsah se neotevře.
- `unauthenticated` – uživatel nemá online session ani použitelné offline oprávnění, provedl logout nebo server výslovně potvrdil revokaci.

## Start aplikace

1. Načte se lokální grant, profil, balíček a uživatelská data.
2. Podpis grantu se lokálně ověří proti veřejnému JWKS.
3. Paralelně se s timeoutem ověří online session a serverový profil.
4. Online úspěch obnoví grant a zaznamená poslední synchronizaci.
5. Síťová chyba/timeout/5xx použije platný grant.
6. Běžný 401/403 bez potvrzené revokace grant automaticky nemaže.
7. `account_revoked` nebo `account_suspended` nepovolí fallback.

`navigator.onLine` slouží pouze pro UX a vynechání zbytečných requestů. O oprávnění rozhoduje výsledek online repository nebo kryptograficky ověřený grant.

## Ruční logout

Logout používá lokální scope Supabase, smaže offline grant, chráněný balíček, lokální serverový profil a čekající cloudové mutace daného účtu. Vlastní PDF importy se nemažou. Oblíbené a setlisty zůstávají jako lokální uživatelská data; mohou obsahovat neaktivní ID, ale bez balíčku neodhalí text písně.

## Omezení revokace

Server nemůže okamžitě odvolat oprávnění zařízení, které je zcela offline. Horní hranicí rizika je `offlineValidUntil`. Pro tábor je vhodné nastavit platnost do konce akce plus krátkou rezervu; obecný výchozí návrh je 30 dní.
