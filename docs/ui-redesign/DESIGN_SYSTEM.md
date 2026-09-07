# Vizuální systém Českého zpěvníku

Sdílený základ je v `src/ui/interface.css`, importovaný jednou z `main.tsx`. Původní pravidla přestavěných komponent byla odstraněna ze `styles.css`; zůstávají specializované obrazovky, tisk a režimy hraní. Žádné nové balíčky, webfonty ani služby.

## Tokeny

| Role | Tmavý vzhled |
| --- | --- |
| Pozadí | #0E1316 |
| Povrch / zvýšený povrch | #171E22 / #222B30 |
| Text / sekundární text | #F4F1E9 / #B6BFC1 |
| Hlavní akce / její text | #F4F1E9 / #0E1316 |
| Akcent, focus a akordy | #E9B768 |
| Úspěch / upozornění / chyba | #79C89B / #F0BF67 / #F08D88 |
| Hranice ovládání | #718086 |

Zachované světlé téma, správcovský monochromatický vzhled i preference uživatele mají vlastní kontrastní tokeny. Barva není jediným nositelem stavu: používá se text, symbol, `aria-current` nebo `aria-pressed`.

Rozestupy: 4, 8, 12, 16, 24, 32 px; základní mobilní okraj 16 px. Radius 12–16 px. UI používá systémová písma, název aplikace a detailu systémové serifové písmo. Základ UI 16 px, metadata 13–14 px, detail 20 px s uživatelským ovládáním. Text písně je v rem a respektuje zvětšení kořenového písma. Běžné přechody 120–180 ms; existující vypnutí pohybu a reduced motion se zachovávají.

## Společné prvky

- Hlavička aplikace a `AppNavigation`: pět destinací, aktivní položka a měřená výška přes ResizeObserver. Rezerva pod obsahem respektuje skutečnou výšku a safe area; při velkém textu se položky zalamují.
- `SearchField`: vlastní label, jedno pole, samostatné vymazání. Domů předává hledání do knihovny.
- Tlačítka, IconButton, filtry a stavové prvky mají sdílené třídy. Hlavní akce nejméně 48 px na výšku, vedlejší ovládání nejméně 44 px.
- `Dialog`: nativní modal, inertní pozadí, cyklus Tab / Shift+Tab, Escape, zavření a návrat fokusu. Používají jej filtry, rychlé akce knihovny, čtečka, detail akordu a nové potvrzení mazání cache.
- Seznam má hlavní tlačítko písně a samostatné tlačítko akcí. Dostupný název obsahuje celý titul; vizuálně smí mít dva řádky. Hustota a virtuální seznam zůstaly; velký text vypíná pevné virtuální řádky.
- Čtečka zachovává strukturu parseru: akord a odpovídající úsek textu tvoří společnou jednotku. Nezávislé absolutní umisťování akordů bylo odstraněno. Instrumentální řádky zůstávají samostatnými řádky, dlouhá slova se mohou zalomit.
- Čísla, desetinná místa a datum nových stavů používají `src/ui/format.ts` s Intl cs-CZ.
- Domů má šest menších obdélníkových zkratek ve dvou sloupcích. Barvy rozlišují hudební destinace: modré písně, tlumené červené setlisty, jantarové oblíbené a zelené offline. V monochromatickém tématu jsou neutrální. Barva zkratky Offline sama neoznamuje připravenost; odkaz zve k jejímu ověření.
- Přihlášení a poslední píseň používají nenápadný motiv z existujícího uživatelského přebalu `zpevnik-prebal.jpg`. Lokální kopie má přibližně 105 KiB a je v cache. Na přihlášení zabírá pouze 104 px, aby zůstal formulář viditelný.
- Kruhový ukazatel Offline vyjadřuje počet ověřených textů z daného rozsahu. Zelená se objeví až při splnění všech tří podmínek připravenosti. Úložiště má samostatný graf odhadu prohlížeče, nikoli příslib fyzicky volného místa telefonu.

## Význam stavů

„Připraveno bez internetu“ se vztahuje na ověřený app shell, oprávnění daného účtu a texty. Veřejná ukázka oprávnění nevyžaduje; členské texty vyžadují platný grant a kontrolu balíčku. Volitelné noty mají vlastní počet. Stav „Neověřeno“ není úspěch.

Počet katalogu, stažené členské písně a osobní koncepty mají různý rozsah. Tónina vychází z metadat, nikoli z prvního akordu. „Akordy lze načíst“ není hudební posudek. Správcovské „Online při kontrole“ znamená aktivitu evidovanou během dvou minut.
