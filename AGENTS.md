# Projektová pravidla pro agenty a přispěvatele

## Neporušitelné právní zásady

1. Nestahovat ani nescrapovat texty, akordy nebo noty z internetu.
2. Nedoplňovat chybějící části existujících chráněných písní.
3. Publikovat jen obsah z `data/import`, obsah ve vlastnictví uživatele nebo jasně public-domain/licencovaný obsah.
4. Každá píseň musí mít `source`, `rights_status`, `license` a `attribution`; každý notový part vlastní metadata práv.
5. Testy, dokumentace a screenshoty smějí obsahovat jen krátký syntetický obsah.
6. Nejasný záznam označit `requires_review`; nikdy jej automaticky neslučovat ani publikovat.

## Práce s daty

- `data/import` je pouze pro čtení. Import vytváří nový časově označený adresář v `data/normalized`.
- Katalog ani `public/content` se neupravují ručně; generuje je `npm run generate:catalog`.
- Při změně schématu zvýšit `schemaVersion`, přidat explicitní migraci IndexedDB a test staršího formátu.
- Všechen importovaný text projde normalizací Unicode a odstraněním řídicích znaků. Nepoužívat `dangerouslySetInnerHTML`, `eval` ani dynamické skripty z dat.
- Samostatný MusicXML/MXL se bez vazby a práv eviduje k ruční kontrole.

## Vývojový postup

- Zachovat mobilní ovládání, klávesnici, kontrast, popisky `aria-*` a minimální výšku hlavních ovládacích prvků přibližně 44 px.
- Za běhu nepřidávat externí API, webfonty, analytiku ani CDN.
- Před odevzdáním spustit: `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run build` a podle dostupnosti prohlížeče `npm run test:e2e`.
- Zvlášť ověřit české H/B, lomené akordy, přípony akordů, offline reload a syntetické housle/violoncello.
