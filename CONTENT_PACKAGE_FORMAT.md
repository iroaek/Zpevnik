# Formát obsahového balíčku

## Současný privátní balíček

Privátní knihovna je JSON záloha aplikace s `libraryScope`, `libraryManifest`, uživatelským stavem a poli `personalSongs`. Každá píseň nese povinné `source`, `sourceIdentifier`, `rightsStatus`, `license` a `attribution`. Nejasný obsah zůstává `requires_review`.

Manifest v1:

```ts
interface LibraryManifest {
  schemaVersion: 1;
  scope: 'admin' | 'members';
  version: string;
  generatedAt: string;
  songCount: number;
  contentBytes: number;
  packageBytes?: number;
  sha256?: string;
}
```

Klient ověřuje očekávaný scope, velikost, SHA‑256 celého balíčku, počet/typy záznamů a bezpečný původ členských písní. Aktivace je transakční.

## Veřejný katalog

Nově generované položky obsahují `contentSha256`; notové soubory `sha256`. Explicitní offline download kontroluje velikost a SHA‑256 každé položky. Poškozená cache se odstraní a online se stáhne pouze chybná položka.

## Doporučený manifest v2

Další kompatibilní krok může přidat `minimumAppVersion` a pole `files` s `path`, `size`, `sha256`, MIME a typem. Změna musí zvýšit `schemaVersion`, přidat explicitní parser/migraci a nesmí aktivovat částečný obsah.

Případný podpis manifestu nenahrazuje HTTPS ani offline grant: podpis manifestu chrání původ obsahu, grant chrání integritu oprávnění.
