# Plynulost a pohyb rozhraní

Pohybový systém je původní součást Českého zpěvníku. Vychází z obecných principů kontinuity, vrstvení a jasné prostorové orientace známých z filmového UI; nekopíruje konkrétní scénu, grafiku ani rozhraní filmu.

## Pravidla

- hlavní záložky mají směr podle pořadí navigace a prostorový náklon odpovídá směru;
- detail písně se otevírá dopředu a návrat se pohybuje zpět;
- název písně nebo setlistu se při podporované navigaci plynule přenese ze zdrojové karty do záhlaví;
- filmový střih kombinuje hloubku, krátké ztmavení okrajů a světelný průchod; režim `full` přidává krátké horní a dolní clony;
- fallback používá Web Animations API bez závislosti na snapshotu celé stránky;
- karty, tlačítka a aktivní záložka reagují změnou `transform`, `opacity` a barvy;
- animace nemění rozměry layoutu, takže nevzniká poskakování ani horizontální scroll;
- při `prefers-reduced-motion: reduce` jsou přechody a mikrointerakce prakticky vypnuté.

## Výkonnostní rozpočet

Jemný navigační přechod má zůstat přibližně do 320 ms, filmový režim do 510 ms. Animují se jen `transform`, `opacity` a barva sdíleného titulku; nepoužívá se animace rozměrů, velký blur ani JavaScriptové snímkování. U velmi dlouhého obsahu se prostorový pohyb omezí na malé záhlaví, aby nevznikla obří kompoziční vrstva.

## Testování

Playwright ověřuje mobilní viewport, dokončení přechodu, absenci horizontálního přetečení a omezení pohybu. Ručně je třeba zkontrolovat Safari/PWA na iPhonu, Chrome/Android, tlačítko Zpět a rychlé opakované přepínání záložek.
