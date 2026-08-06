# Práva a licencování

Tento projekt je nástroj pro obsah, k jehož použití má uživatel oprávnění. Není zdrojem textů, akordů ani not a nesmí se používat k jejich získávání z internetu.

## Povinné údaje

Každá publikovaná píseň musí uvádět:

- `source` – skutečný původ dat;
- `source_identifier` – stabilní identifikátor dokumentu nebo záznamu;
- `rights_status` – `public_domain`, `licensed`, `user_owned` nebo `synthetic`;
- `license` – název/SPDX identifikátor nebo přesné smluvní označení;
- `attribution` – text atribuce, i když je pouze „bez požadavku“.

`unknown` a `requires_review` nejsou publikovatelné stavy. Stejnou kontrolu vyžaduje každý MusicXML/MXL part, protože aranžmá může mít jiná práva než text nebo melodie.

## Přijatelné zdroje

- soubory výslovně dodané uživatelem do `data/import` s doloženými právy;
- uživatelův původní obsah;
- obsah s ověřenou licencí kompatibilní se zamýšleným použitím;
- skutečně public-domain obsah po právním ověření pro příslušnou jurisdikci;
- syntetický testovací obsah, který nepřetváří existující píseň.

Pouhé nalezení díla na internetu, stáří nahrávky ani uvedení autora není licencí. U lidových nebo anonymních písní je stále nutné ověřit konkrétní textovou redakci, harmonizaci a aranžmá.

## Ukázková data

`synteticka-jiskra.cho` a tři krátké partitury jsou původní testovací artefakty vytvořené pro tento projekt. Nemají představovat ani napodobovat známou píseň. Metadata je označují jako `synthetic` / `CC0-1.0`.

## Publikační kontrola

Generátor katalogu skončí chybou, pokud píseň nemá zdroj, licenci nebo platný stav práv. Importér jen připravuje odvozené soubory; lidské schválení a právní kontrola před přesunem do `data/songs` zůstávají povinné.
