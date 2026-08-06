# Testování

## Úplná lokální kontrola

```powershell
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
```

`test:e2e` vyžaduje nainstalovaný prohlížeč Playwright. Při prvním použití lze spustit `npx playwright install chromium`.

## Rozsah

- `src/domain/chords.test.ts` – české H/B, mezinárodní B/Bb, lomené akordy, kanonická reprezentace a zachování přípon.
- `src/domain/chordpro.test.ts` – zarovnání, sanitizace a opakované refrény.
- `src/components/Library.test.tsx` – přístupné vyhledávání bez ohledu na diakritiku.
- `tests/import.integration.test.ts` – UTF-8/Windows-1250, právní blokace, duplicity, ZIP, poškozená data, prostý text a MusicXML kandidát.
- `e2e/mobile-pwa.spec.ts` – pět požadovaných viewportů, přetečení, deep linky, transpozice, velikost textu, autoscroll, režim U ohně, ověřené stažení, offline reload a zachování lokálních dat.

## Ruční akceptační kontrola

1. Nainstalovat produkční PWA z HTTPS/localhost.
2. Otevřít syntetickou píseň, přejít na housle a violoncello a ověřit čitelné SVG noty.
3. Přepnout české/mezinárodní akordy a transponovat přes hranici H/C.
4. Zapnout autoscroll, fullscreen a podporovaný wake lock; bez podpory se volba nesmí zobrazit ani způsobit chybu.
5. Vytvořit setlist, změnit pořadí, vytisknout A4 i A5 a ověřit, že navigace v tisku není.
6. Exportovat JSON zálohu, změnit nastavení a zálohu obnovit.
7. Po prvním online načtení vypnout síť a ověřit katalog, píseň a partituru.

Veřejné snapshoty, reporty a screenshoty nesmějí obsahovat chráněné texty nebo partitury.
