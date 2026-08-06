# Import report

Datum inventury: 2026-08-05

Adresář `data/import/` byl při založení projektu prázdný (obsahoval pouze technický `.gitkeep`). Nebyla tedy importována žádná uživatelská skladba a nebyl nalezen žádný obsah k právnímu posouzení.

Do schválených dat byla přidána jen jedna původní syntetická testovací skladba se syntetickou melodií, houslovým a violoncellovým partem. Všechna tato aktiva mají metadata `rights_status: synthetic`, licenci `CC0-1.0`, zdroj a atribuci.

Po vložení vstupních dat vytvoří příkaz `npm run import:data` detailní strojově čitelný report, auditní JSONL a seznam ručních kontrol v novém adresáři `data/normalized/import-<čas>/`.
