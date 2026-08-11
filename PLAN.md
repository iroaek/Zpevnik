# Technický plán

## Offline-first architektura 2026-08

- [x] audit klientského auth guardu, PWA, IndexedDB, Supabase a veřejného obsahu;
- [x] explicitní auth stavy online/offline/expired/unauthenticated;
- [x] síť/timeout/5xx bez automatického logoutu;
- [x] lokální ES256 ověření offline grantu a připravená serverová Edge Function;
- [x] DB v5: user-scoped content package, offline grant, outbox a diagnostika;
- [x] SHA‑256 veřejných souborů a transakční privátní balíček;
- [x] repository kontrakty pro budoucí změnu backendu/SQLite;
- [x] idempotentní outbox replay po návratu sítě, focusu a s exponenciálním backoffem;
- [x] Neon Data API provider, RLS migrace a dual-provider offline issuer připravené pro staging;
- [x] plynulé směrové přechody s View Transitions fallbackem a `prefers-reduced-motion`;
- [x] RLS, threat model, Neon a Capacitor dokumentace;
- [ ] izolovaný Neon staging branch, import aplikačních řádků a behaviorální RLS testy – vyžaduje správce/secrets;
- [ ] staging nasazení migrace/function a dynamické A/B/admin testy – vyžaduje správce/secrets;
- [ ] produkční aktivace offline grantu – až po schváleném stagingu;
- [ ] Capacitor Android/iOS scaffold – samostatný patch po volbě app ID/pluginů/signingu.

1. **Základ projektu** – vytvořit TypeScript/React/Vite PWA, přístupné mobilní rozhraní, českou lokalizaci, instalovatelný manifest a service worker bez externích runtime služeb.
2. **Datová vrstva** – definovat verzované Zod schéma písní, partů, uživatelských dat a migrací; zdrojem katalogu budou výhradně ChordPro/score soubory a jejich metadata.
3. **Import a katalog** – implementovat nedestruktivní import ChordPro, CSV, JSON, XLSX, SQLite, MusicXML, MXL a ZIP; detekovat UTF-8/Windows-1250, validovat práva, logovat transformace, duplicity a ruční kontroly; generovat runtime katalog a kopie povolených aktiv automaticky.
4. **Čtečka zpěvníku** – vyhledávání a filtry, sazba ChordPro, české/mezinárodní akordy, kanonický model tónů, transpozice, kapodastr, oblíbené, historie a setlisty v IndexedDB.
5. **Noty a použití v terénu** – OSMD pro MusicXML/MXL, volba partu, zoom a tisk; tmavý režim, fullscreen, autoscroll, wake lock s bezpečnou degradací a tisk A4/A5.
6. **Kvalita a předání** – syntetická data, jednotkové/importní/E2E testy, lint, typecheck, produkční build, offline kontrola a dokumentace práv, formátů, importu i testování.

## Zásady implementace

- Původní `/data/import` se nikdy nemění; výstupy a auditní záznamy patří do `/data/normalized`.
- Do publikovaného katalogu nesmí záznam bez `source` a `rightsStatus`; licence a atribuce zůstávají dohledatelné u písně i každého partu.
- Ukázky a testy používají jen krátký syntetický text a syntetickou melodii.
- Katalog se neupravuje ručně: vytváří jej `npm run generate:catalog`.
- První verze netransponuje notový zápis; transpozice se týká pouze akordů.

## Rozšíření mobilní distribuce

7. **Veřejné PWA trasy** – deep linky písní/setlistů, instalační, offline a help obrazovka s podporou kořene i podadresáře.
8. **Řízený offline obsah** – oddělené verzované cache písní a not, ověření každého souboru, statistiky, oprava a bezpečné mazání.
9. **Distribuce** – PNG/maskable/iOS ikony, lokální QR SVG/PNG, A4 list, sitemap, hlavičky, SPA fallback a CI nasazení.
10. **Mobilní QA** – automatické viewporty 320–430 px a landscape, Chrome offline scénář a dokumentovaný fyzický Android/iOS checklist.
