# Průvodce importem

## Podporované vstupy

- ChordPro (`.cho`, `.chordpro`, `.pro`)
- CSV a JSON
- XLSX
- SQLite (`.sqlite`, `.sqlite3`, `.db`)
- MusicXML (`.musicxml`, `.xml`) a MXL
- ZIP obsahující podporované formáty
- prostý text (`.txt`) jako návrh vyžadující ruční kontrolu

## Vícestránkové PDF zpěvníky

PDF se záměrně nezpracovávají běžným publikovatelným importem. Dodané soubory vložte do `songs_data/` a nainstalujte lokální PDF závislost:

```powershell
python -m pip install -r requirements-pdf.txt
npm run import:pdf-songbooks
```

Skript:

- ponechá `songs_data` beze změny;
- vytvoří nový `data/normalized/import-<čas>-pdf-songbooks/`;
- rozliší začátek písně, možnou pokračovací stránku a prázdnou stránku;
- zachová monospaced rozložení textu a akordů v `requires-review/pages/`;
- vytvoří `duplicate-report.json` a `duplicate-report.csv` pro přesné i pravděpodobné duplicity;
- nastaví každému záznamu `rightsStatus: requires_review` a nic nepřidá do veřejného katalogu.

Stejný název nebo interpret je pouze kandidát ke kontrole. Pokračovací strany obsahují `parentCandidate`, ale skript je automaticky nespojuje s předchozí stránkou.

Import je lokální. Původní vstup se nemění a nic se neodesílá do sítě.

## Postup

1. Zazálohujte vlastní data a vložte jejich kopii do `data/import/`.
2. U tabulkových dat použijte hlavičky odpovídající poli katalogu; podporované jsou i běžné české varianty jako `název`, `autor`, `zdroj`, `licence`.
3. U každého záznamu vyplňte minimálně název, obsah, `source`, `rights_status`, `license` a `attribution`.
4. Spusťte:

   ```powershell
   npm run import:data
   ```

5. Otevřete nový `data/normalized/import-<čas>/import-report.json`.
6. Vyřešte všechny položky v `manual-review.json`: nejasná práva, neplatné schéma, chybějící obsah, možné duplicity a samostatné partitury.
7. Publikovatelný odvozený ChordPro je v podadresáři `publishable/songs`. Zkontrolujte jej proti originálu a ručně jej schvalte přesunem do `data/songs/`.
8. Připojte notové party a `score-metadata.json`, potom spusťte `npm run generate:catalog`.

## Kódování

Importér nejprve zkouší striktní UTF-8. Při neplatné sekvenci dekóduje text jako Windows-1250, normalizuje jej do Unicode NFC a zapisuje UTF-8. Česká diakritika zůstává zachována a zvolené kódování je v reportu.

## Duplicity

Pravděpodobná duplicita se hledá podle názvu bez diakritiky/interpunkce a normalizovaného autora. Všechny členy skupiny dostanou `requires_manual_review`. Importér je neslučuje; rozhodnutí a případné ruční sloučení musí zůstat dohledatelné v auditu.

## Prostý text s oddělenými akordy

Řádky vypadající převážně jako akordy se zachovají v komentáři návrhu. Importér nehádá jejich umístění nad slabikami a nastaví `requires_manual_review`. Editor musí akordy ručně vložit do hranatých závorek před správné místo.

## Bezpečnostní limity

- jeden vstup nejvýše 50 MB;
- jedna položka ZIP nejvýše 20 MB;
- rozbalený součet ZIP nejvýše 100 MB;
- kontrola CRC a odmítnutí cest s `..` nebo absolutní cestou;
- poškozený soubor se zapíše do reportu a nezastaví zpracování ostatních souborů.

SQLite import čte první tabulku, jejíž název připomíná `song` nebo `pisen/pisne`. XLSX čte první list a první řádek jako hlavičku. Samostatné partitury se nikdy samy nepřiřadí k písni.
