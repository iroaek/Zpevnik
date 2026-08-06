# Ruční kontrola mobilní PWA

Vyplňte pro konkrétní veřejný HTTPS deployment. Emulace prohlížeče nenahrazuje poslední kontrolu na fyzickém telefonu.

## Android + Chrome

- [ ] QR otevře kanonickou HTTPS adresu.
- [ ] Vyhledání, otevření písně a návrat zachovají pozici seznamu.
- [ ] `/install` nabídne skutečné systémové instalační okno, pokud Chrome vyšle `beforeinstallprompt`.
- [ ] Instalovaná aplikace běží standalone a respektuje portrait i landscape.
- [ ] Režim U ohně, fullscreen, wake lock, zámek orientace a zastavení posunu dotykem fungují.

## iPhone + Safari

- [ ] Návod zobrazuje Safari → Sdílet → Přidat na plochu → Otevřít jako webovou aplikaci.
- [ ] Návod zmizí po spuštění z plochy ve standalone režimu.
- [ ] Apple Touch ikona a název na ploše jsou správné.
- [ ] Bez podpory zámku orientace nebo wake locku nevzniká chyba ani nefunkční tlačítko.
- [ ] Safe-area okraje nepřekrývají navigaci.

## Běžná karta a instalovaná PWA

- [ ] Všechny deep linky lze přímo obnovit bez hostingové 404.
- [ ] Soukromé setlisty jsou stejné po zavření/otevření aplikace.
- [ ] Aktualizační banner nabízí „Aktualizovat nyní“ a „Později“ a nic neaktivuje uprostřed písně.
- [ ] Po aktualizaci zůstávají oblíbené, setlisty, velikost textu a rychlost posunu.

## Pomalá a žádná síť

- [ ] Při pomalé síti zůstává app shell ovladatelný a stahování zobrazuje přesný průběh.
- [ ] Přerušené stahování nevede k falešnému stavu „připraveno offline“.
- [ ] Opakované stažení opraví neúplný obsah.
- [ ] Stažené písně fungují po úplném odpojení a obnovení deep linku.
- [ ] Nestažené noty zobrazí české upozornění.
- [ ] Odstranění not zachová písně, oblíbené a soukromé setlisty.
