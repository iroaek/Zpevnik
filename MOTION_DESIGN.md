# Plynulost a pohyb rozhraní

Pohybový systém je původní součást Českého zpěvníku. Vychází z obecných principů kontinuity, vrstvení a jasné prostorové orientace známých z filmového UI; nekopíruje konkrétní scénu, grafiku ani rozhraní filmu.

## Pravidla

- hlavní záložky mají směr podle pořadí navigace;
- detail písně se otevírá dopředu a návrat se pohybuje zpět;
- prohlížeče s View Transitions API používají plynulé prolnutí a krátký posun;
- fallback používá lehkou animaci vstupní vrstvy bez blokování navigace;
- karty, tlačítka a aktivní záložka reagují změnou `transform`, `opacity` a barvy;
- animace nemění rozměry layoutu, takže nevzniká poskakování ani horizontální scroll;
- při `prefers-reduced-motion: reduce` jsou přechody a mikrointerakce prakticky vypnuté.

## Výkonnostní rozpočet

Navigační přechod má zůstat přibližně 180–320 ms. Nepoužívá animaci `width`, `height`, velký blur ani JavaScriptové snímkování. Na slabším zařízení se může vizuální přechod vynechat; změna trasy a dat musí vždy proběhnout okamžitě a nezávisle na animaci.

## Testování

Playwright ověřuje mobilní viewport, dokončení přechodu, absenci horizontálního přetečení a omezení pohybu. Ručně je třeba zkontrolovat Safari/PWA na iPhonu, Chrome/Android, tlačítko Zpět a rychlé opakované přepínání záložek.
