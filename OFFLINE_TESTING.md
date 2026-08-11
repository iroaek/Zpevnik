# Testování offline režimu

## Automatické vrstvy

- `src/auth/authState.test.ts`: síť, timeout, 5xx, 401/403, revokace, expirace a návrat online.
- `src/auth/offlineGrant.test.ts`: ES256 podpis, issuer, audience, device, package a expirace.
- `src/storage/database.test.ts`: migrace DB v1→v5, atomický import/rollback, user separation a outbox.
- `src/pwa/contentCache.test.ts`: velikost a SHA‑256 položek.
- `tests/rls-policy.integration.test.ts`: statická anonymous/A/B/admin matice.
- `e2e/mobile-pwa.spec.ts`: service worker, explicitní download, úplné zavření stránky, offline nový cold start, píseň, transpozice, oblíbené a setlist.

## Povinný staging scénář se skutečným účtem

1. Přihlásit schváleného syntetického člena online.
2. Ověřit, že server vydal ES256 grant a obrazovka Offline ukazuje expiraci.
3. Stáhnout členský balíček; ověřit počet, verzi a `integrity=verified`.
4. Vytvořit oblíbenou položku a setlist.
5. Aplikaci skutečně ukončit, ne pouze přepnout tab.
6. Zapnout airplane mode; spustit z ikony/deep linku.
7. Ověřit `Offline režim`, žádný login, vyhledání, otevření, transpozici, posun a stažené noty.
8. Aplikaci znovu ukončit/spustit offline; změny musí zůstat.
9. Zapnout síť; ověřit flush outboxu bez duplicit a beze ztráty lokálních dat.
10. Opakovat s vypršeným, pozměněným, cizím-device a cizím-package grantem; přístup musí být odmítnut.

## Matice prostředí

- viewporty 320×568, 360×800, 390×844, 430×932, landscape 844×390;
- Android Chrome browser + instalovaná PWA;
- iOS Safari browser + Home Screen web app;
- rychlá, pomalá a zcela vypnutá síť;
- 500/503, timeout, 401 bez revokace, explicitní `account_revoked`;
- aktualizace service workeru; smazání Cache Storage při zachování IndexedDB; smazání cookies/session při zachování IndexedDB; smazání všech site data;
- zamítnuté `navigator.storage.persist()`, nízká quota a přerušený download.

Automatický Playwright offline mód nekopíruje všechny zvláštnosti iOS WebKit. Finální iPhone test je před produkční aktivací povinný.
