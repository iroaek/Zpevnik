# Offline-first architektura

## Tok oprávnění a obsahu

```text
Online přihlášení
        ↓
Server ověří uživatele
        ↓
Server vydá podepsaný offline grant
        ↓
Aplikace stáhne autorizovaný obsahový balíček
        ↓
Aplikace ověří checksumy
        ↓
IndexedDB / SQLite
        ↓
Offline cold start
        ↓
Lokální ověření podpisu a platnosti grantu
        ↓
authenticated-offline
        ↓
Přístup ke staženým písním
```

## Vrstvy

- **App shell:** Workbox precache, hashované JS/CSS cache-first, navigation fallback pod správným base path.
- **Veřejný katalog:** NetworkFirst s 5s timeoutem, poslední validní kopie v Cache Storage.
- **Chráněné balíčky:** privátní Supabase Storage → ověření velikosti/SHA‑256 → jedna IndexedDB transakce → aktivace.
- **Lokální doménová data:** IndexedDB DB v5; web/PWA implementace repository rozhraní.
- **Auth:** ve fázi 1 online Supabase session a samostatný serverem podepsaný offline grant; aplikační DB lze přepnout na Neon Data API.
- **Sync:** lokální změna je okamžitá; neodeslaný snapshot jde do deduplikovaného idempotentního outboxu a opakuje se po online/focus/visibility nebo backoff timeru.

## Atomická aktualizace

Nový balíček se nejprve celý stáhne a ověří. JSON a každá píseň projdou Zod schématem a sanitizací Unicode/řídicích znaků. Teprve potom jedna transakce nahradí staré chráněné písně, obsah, metadata a aktivní `ContentPackageRecord`. Při chybě parseru, checksumu nebo transakce zůstane poslední aktivní balíček zachovaný.

## Oddělení uživatelů

Nové balíčky mají `ownerUserId`; loader skryje chráněné písně jiného účtu. Legacy balíček z DB v4 vlastníka neměl, a proto musí být po nasazení v5 jednou online obnoven. Při logoutu se chráněný balíček aktivního účtu odstraní.

## Platformní adaptéry

`AuthRepository`, `SongRepository` a `SyncRepository` oddělují UI od konkrétního providera. Web používá IndexedDB. Budoucí Capacitor může implementovat `SongRepository` nad SQLite a tajné tokeny držet v Keychain/Keystore bez změny doménového UI.

## Neon fáze 1

PWA posílá existující krátkodobý Supabase access token do Neon Data API. Neon ověří JWT podle nastaveného JWKS a RLS používá `auth.user_id()`. Do klienta se nikdy neposílá databázový connection string. Privátní soubory zůstávají v Supabase Storage; Edge Function vydávající offline grant ověří Supabase relaci, ale v Neon režimu čte roli a zapisuje audit v Neonu.
