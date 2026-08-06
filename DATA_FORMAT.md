# Datové formáty

## Katalog písně

Katalog se generuje ze schválených souborů, není ručním zdrojem pravdy. Aktuální `schemaVersion` je `3`; `version` je stabilní hash obsahu. Povinná pole normalizované písně:

- `id`, `title`, `sortTitle`, `alternativeTitles[]`
- `authors[]`, `lyricists[]`, `composers[]`
- `language`, `originalKey`, `timeSignature`, `tempo`, `capo`
- `tags[]`, `categories[]`, `difficulty`, `firstLine`
- `chordProPath`, `contentBytes`, `scoreAssets[]` (každý part má také `byteSize`)
- `source`, `sourceIdentifier`, `rightsStatus`, `license`, `attribution`, `notes`
- `createdAt`, `updatedAt`

Chybějící autor, tempo, kapodastr nebo noty jsou platné. Identifikátor je stabilní malými ASCII písmeny a pomlčkami. Datum je ISO 8601 v UTC.

Osobní lokální záznam může navíc obsahovat `contentFormat`, `personalOnly`, `chordsVerified` a `reviewFlags[]`. Obsah s cestou `indexeddb:<id>` je uložený pouze v IndexedDB daného zařízení a nesmí se generovat do veřejného katalogu.

## ChordPro

Zdroj je `data/songs/<song-id>.cho` v UTF-8. Akord stojí bezprostředně před slabikou, například syntetické `[G]Tes[C]tovací`. Doporučené hlavičkové direktivy:

```text
{id: synteticky-priklad}
{title: Syntetický příklad}
{sort_title: Syntetický příklad}
{author: Vlastník testovacích dat}
{language: cs}
{key: G}
{time: 4/4}
{tempo: 90}
{capo: 0}
{tags: syntetická; ukázková}
{categories: táborová}
{difficulty: easy}
{source: Původní syntetická data}
{source_identifier: synthetic-example-1}
{rights_status: synthetic}
{license: CC0-1.0}
{attribution: Syntetická ukázka}
{created_at: 2026-08-05T00:00:00.000Z}
{updated_at: 2026-08-05T00:00:00.000Z}
```

Pole s více hodnotami lze opakovat nebo oddělit středníkem. Refrén používá `{start_of_chorus}` / `{end_of_chorus}` (zkratky `{soc}` / `{eoc}`). Výchozí značení zdrojových akordů je české; direktiva `{chord_notation: international}` přepne zdroj na mezinárodní.

### Akordy

Interně se akord rozpadá na `root`, jeho `accidental`, `quality`, `extension` a volitelnou `bassNote`; tón je `pitchClass` 0–11. České `H` je B natural a české `B` je B flat. Mezinárodní zápis používá `B` a `Bb`. Transpozice mění jen výšky, ne přípony `maj7`, `sus4`, `dim`, `add9` apod.

## MusicXML a MXL

Schválené party jsou:

```text
data/scores/<song-id>/melody.musicxml
data/scores/<song-id>/violin.musicxml
data/scores/<song-id>/cello.musicxml
```

Přípona `.mxl` je také povolená. Souběžný `score-metadata.json` obsahuje pro každý název souboru:

```json
{
  "violin.musicxml": {
    "clef": "treble",
    "arrangementType": "user_arrangement",
    "source": "Vlastní aranžmá uživatele",
    "rightsStatus": "user_owned",
    "license": "All rights reserved by user"
  }
}
```

`instrument` se odvodí z názvu `melody`, `violin`, `cello`, jinak je `other`. `format` je `musicxml` nebo `mxl`. `arrangementType` je `original`, `user_arrangement` nebo `generated_draft`. Noty se v první verzi netransponují.

## Verze a migrace

- Katalog: `catalog.schemaVersion`.
- Lokální záloha a stav: `userState.schemaVersion`.
- IndexedDB: verze předaná do `openDB`; upgrade je řízen větvemi `oldVersion < N`.

Změna existujícího významu pole vyžaduje nové číslo verze a migrační test. Pole se bez migrace neodstraňují ani nepřejmenovávají.

## Veřejné setlisty

Zdrojové soubory jsou `data/setlists/<setlist-id>.json`. Obsahují stabilní `id`, `title`, `description`, neprázdné `songIds[]`, `source`, `rightsStatus`, `license`, `attribution`, `createdAt` a `updatedAt`. Generátor odmítne neznámé ID písně nebo nevyjasněná práva. Soukromé setlisty do těchto souborů nepatří.
