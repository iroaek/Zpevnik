# Hotfix chyby „Neon Data API nevrátilo JSON“

7. 9. 2026 uživatel po nasazení nahlásil přihlašovací obrazovku s `grant_missing` a chybou „Neon Data API nevrátilo JSON“.

V revizi `6e61c72` přibyla v `src/backend/neonDataApi.ts` podmínka, která ještě před čtením těla odmítala každou úspěšnou odpověď kromě HTTP 204, pokud hlavička neobsahovala doslova `application/json`. Tím nově odmítala i platné JSON s vendor MIME typem, `text/plain`, chybějící hlavičkou nebo jinou velikostí písmen a prázdné úspěšné odpovědi. Načtení profilu volá `ensure_my_profile` a `profiles` před vydáním offline grantu; chyba zde přeruší obnovu přihlášení.

Oprava ověřuje skutečné tělo parserem JSON. Prázdná úspěšná odpověď zůstává `null` jako před regresí. HTML a neplatné JSON končí bezpečným `NeonDataApiError` s `api_not_json`; tělo odpovědi se nevypisuje. Podpisy grantů, schvalování, identita, serverová autorizace a úložiště se nemění.

## Ověření před nasazením

- Nové testy proti chybné implementaci: **8 FAILED / 5 PASS**, exit 1. Po opravě cílená sada Data API, obnovy session a hooku: **33/33 PASS**. Samotný Data API soubor má 13 případů včetně původních tří.
- `npm run lint` a `npm run typecheck`: **PASS**.
- `node scripts/offline-fix-browser.mjs --before --skip-build --mime-regression`: zachovaný původní případ 2/3, dva skutečně stažené syntetické texty, bez grantu.
- `node scripts/offline-fix-browser.mjs --mime-regression`: produkční sestavení klienta a **9/9 PASS** nad skutečným lokálním HTTP serverem a instalovaným Neon SDK. `ensure_my_profile` používá JSON s `text/plain`, `profiles` s vendor `+json` a `register_my_device` bez Content-Type. Heslo, OTP s nastavením hesla i obnova staré session uloží kryptograficky ověřený grant. Čekající účet nemá přístup.
- **17:30:55 UTC:** nový offline proces nad zachovaným profilem, online JWT již vypršel, grant stále platí; 130 úspěšných odpovědí výhradně ze service workeru, nezacachovaný síťový dotaz selhal, oba HTTP servery zavřené. Další offline restart a následná synchronizace změn prošly. Upgrade zachoval bajty obsahu i ID zařízení.

[Původní lokální stav](before-browser-evidence.json), [výsledky a časové důkazy opravy](after-browser-evidence.json), [uložený grant](after-prepared.png), [nový offline proces](after-cold-start-expired-access-token.png).

Přesná hlavička a tělo uživatelovy produkční odpovědi nejsou dostupné; konkrétní MIME varianty byly reprodukovány synteticky. Anonymní read-only kontrola produkčního `get_my_profile` vrátila správně HTTP 400 a JSON, ale neověřuje úspěšné odpovědi přihlášeného účtu. Nebyly použity produkční přihlašovací údaje ani měněna uživatelská data. Test fyzického zařízení zůstává neprovedený.
