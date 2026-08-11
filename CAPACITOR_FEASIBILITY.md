# Posouzení mobilní aplikace

## Doporučení

Po stabilizaci a stagingovém ověření PWA použít **PWA + Capacitor** ze stejné React/Vite codebase. Čistý Kotlin + Swift nyní nepřináší úměrnou hodnotu.

| Varianta | Offline | Distribuce | Jedna codebase | Nativní API | Náklady |
|---|---|---|---|---|---|
| pouze PWA | dobrý po tomto patchi, iOS má limity webového storage | QR/odkaz, bez store | ano | omezená | nejnižší |
| PWA + Capacitor | velmi dobrý, možnost SQLite/secure storage | QR i App/Play Store | ano | Keychain/Keystore, soubory, wake lock | střední |
| Kotlin + Swift | nejlepší platformní kontrola | store | ne | úplná | nejvyšší |

Capacitor je určen k doplnění do existující moderní webové aplikace a zachovává webové standardy: [oficiální dokumentace](https://capacitorjs.com/docs).

## Navržené adaptéry

```ts
interface LocalSongStore {
  getSongs(): Promise<Song[]>;
  getSong(id: string): Promise<Song | null>;
  saveContentPackage(pkg: ContentPackageRecord): Promise<void>;
  deleteProtectedContent(userId: string): Promise<void>;
}
```

- web/PWA: současný IndexedDB repository;
- Android/iOS: SQLite pouze po ověření udržovaného pluginu a migračních testů;
- bearer/refresh tokeny: platformní Keychain/Keystore, ne localStorage;
- offline grant může být uložen v DB, ale klíče/tajné tokeny v secure storage;
- wake lock, import/export a files API přes malé platformní adaptéry.

## Proč scaffold zatím nebyl přidán

Android/iOS scaffold by přidal generované platformní projekty a závislosti bez rozhodnutí o application ID, signing identity, Apple teamu, min SDK, privacy manifestech a udržovaném SQLite/secure-storage pluginu. iOS build navíc vyžaduje macOS/Xcode. Nejprve musí projít produkční PWA offline grant a cold-start test; potom založit samostatnou větev pro Capacitor a otestovat migraci IndexedDB → SQLite. Nebyly provedeny žádné Store publikace.
