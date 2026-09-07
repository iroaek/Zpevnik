# Krátký audit — Český zpěvník

Datum: 7. 9. 2026. Prohlédnuty všechny reference 01–10; cílový směr je spodní část 10. React 19 / Vite 8, vlastní History API routing, stav uživatele schemaVersion 7, IndexedDB verze 9, Workbox PWA. Aktuální backend: Neon Auth a Neon Data API. Starší adresář Supabase není důvod k migraci.

| Pozorovaný problém | Místo | Oprava | Ověření |
| --- | --- | --- | --- |
| Domů nemá navigaci, Přidat zabírá destinaci | App.tsx, HomeDashboard.tsx | Domů / Písně / Setlisty / Offline / Více; zachovat URL | E2E historie a deep linků |
| Opakované filtry, velké karty odsouvají výsledky | Library.tsx, styles.css | Jedno hledání, rychlé filtry, přístupný dialog, kompaktní řádky | 390 × 844, první řádek do 300 px; návrat se stavem |
| Ovládání vyplňuje první obrazovku čtečky | SongReader.tsx | Jedna lišta; nastavení a další akce v dialogu | Snímky, transpozice, kapodastr, klávesnice |
| Instrumentální řádek přebírá mobilní block layout; dlouhé slovo může přetéct | ChordSheet.tsx, readerLayout.ts, styles.css | Zachovat páry a hudební řádky; opravit reflow | Nejdřív regresní testy se syntetickým obsahem |
| Přihlášení předchází migrační text a počty | AccountAccessPage.tsx | Formulář první; kód sekundárně; nápověda sbalit | Komponentové testy + screenshot skutečné komponenty |
| Připravenost podle SW controlleru a přítomnosti grantu | OfflineContent.tsx, contentCache.ts | Ověřit app shell, platnost, integritu zvlášť; cílená akce | Negativní stavy, stažení, cold start |
| Opakované statistiky a neověřená dostupnost serveru | AdminOverview.tsx | Fronta první, kompaktní ukazatele, čas dat | Testy reálné komponenty s mockem síťové hranice |
| Mnoho postupných globálních přepisů a maskování overflow | styles.css | Sloučit pravidla upravovaných komponent, sdílené tokeny | 7 viewportů, 200 %, kontrast, focus |

Před zahájením byly rozpracované SECURE_ACCESS_SETUP.md a tři generované JSON soubory. Jejich původní obsah je uchován lokálně; soukromé podklady se nepřidávají do veřejných výstupů. Nečteme hesla v admin.txt, nepoužíváme produkční účty ani neměníme produkční data. Existující režim e2e má izolovaný lokální profil; nelze jej vydávat za test produkčního přihlášení nebo vydávání grantu. Testovací obrázky smějí obsahovat pouze syntetická data.
