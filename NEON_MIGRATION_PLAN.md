# Produkční přechod na Neon

Stav k 12. 8. 2026: aplikační schéma, 12 profilů a 6 synchronizačních stavů jsou v produkční větvi Neon. Čistý Neon Auth/Data API klient, verzované obsahové balíčky a blokovaný upload PDF jsou připravené a ověřené v izolované staging větvi. Produkční auth cutover a přenos obsahových balíčků zatím nesmí proběhnout bez samostatného ověření a souhlasu.

## Cílová architektura

- Neon Auth: registrace, přihlášení, obnova hesla a podepsaná online identita;
- Neon Data API: všechny klientské dotazy pod JWT a PostgreSQL RLS;
- PostgreSQL: profily/role/schválení, synchronizovaný stav, návrhy a chunkované privátní balíčky;
- IndexedDB: stažené písně, metadata, outbox a ověřené časově omezené offline oprávnění;
- GitHub Pages: pouze statická instalační PWA a veřejný syntetický obsah.

Klient neobsahuje přepínač na jiný backend ani connection string. Historické backendové funkce a migrace nejsou součástí runtime stromu.

## Již ověřeno

- schéma a RLS migrace v Neon staging větvi;
- Neon Auth email/password a Data API token;
- administrátor vidí profily, anonymní požadavek chráněná data nezíská;
- ověření Ed25519 JWT/JWKS a zamítnutí nesprávné role;
- lint, TypeScript, jednotkové testy, integrační testy a produkční build;
- atomická aktivace obsahové revize až po ověření počtu a kontrolních součtů bloků.

## Zbývající stagingové kroky

1. Nahrát přesně určený členský a administrátorský balíček do staging větve po výslovném souhlasu vlastníka obsahu.
2. Ověřit počty písní, SHA-256, rozsah `members` versus `admin` a stažení do prázdné IndexedDB.
3. Ověřit registraci nového účtu, e-mailové OTP, pending stav, schválení z mobilu, nové přihlášení a reset hesla.
4. Ověřit upload PDF po blocích, přerušení, opakování a administrátorské zobrazení návrhu.
5. Spustit mobilní E2E pro iPhone-like rozměry, offline reload a režim U ohně.

## Produkční cutover

1. Zapnout produkční Neon Auth a propojit produkční Data API s jeho JWKS.
2. Nastavit trusted origins a bezpečné e-mailové doručování.
3. Aktivovat první administrátorský Neon účet. Hesla a aktivní relace se nepřenášejí; uživatelé si vytvoří nové Neon heslo nebo použijí reset.
4. Aplikovat novou migraci a zkontrolovat RLS matici.
5. Přenést obsahové balíčky jako neaktivní revize, ověřit bloky/SHA a teprve poté je atomicky aktivovat.
6. Nastavit pouze veřejné GitHub variables a nasadit PWA.
7. Ověřit produkční login, schválení, synchronizaci, stažení, offline otevření a upload PDF.
8. Až po retenční době a záloze lze samostatně zrušit starou vzdálenou službu. Tento krok je destruktivní a není součástí automatického nasazení.

## Rollback

Frontend lze vrátit na předchozí ověřený commit. Neon obsah je verzovaný: neúplná revize se neaktivuje a předchozí aktivní revize zůstane dostupná. Databázové řádky, účty ani obsah se během prvotní diagnostiky nemažou.
