# Technický plán

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
