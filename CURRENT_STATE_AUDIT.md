# Audit současného stavu

Datum lokálního auditu: **11. 8. 2026**. Audit vychází ze zdrojového stromu větve `codex/offline-first-architecture`; neprováděl žádné dotazy do produkční databáze ani změny Supabase projektu.

## Souhrn

| Oblast | Zjištění | Důkaz |
|---|---|---|
| Frontend | React 19 + TypeScript 6 + Vite 8, SPA bez externího routeru | `package.json`, `src/App.tsx` |
| Package manager | npm, uzamčený `package-lock.json` | workflow používá `npm ci` |
| Build | generování ikon/katalogu/distribuce → `tsc -b` → Vite → finalizace | `npm run build` |
| Hosting | GitHub Pages z GitHub Actions; repozitář není pouze verzovací úložiště | `.github/workflows/deploy-pages.yml` |
| Routing | History API, base path z `VITE_PUBLIC_BASE_URL`, `404.html` jako SPA fallback | `src/pwa/paths.ts`, `vite.config.ts`, `scripts/finalize-dist.ts` |
| PWA | `vite-plugin-pwa`, prompt update, Workbox precache, navigation fallback | `vite.config.ts`, `src/pwa/updateManager.ts` |
| Cache Storage | app shell, veřejný katalog, veřejné písně a noty; chráněný balíček se do společné cache neukládá | `src/pwa/contentCache.ts` |
| IndexedDB | profil, stav, osobní a členské písně, granty, balíčky, outbox a diagnostika | `src/storage/database.ts`, DB verze 5 |
| localStorage | pouze poslední verze veřejného katalogu a Supabase session přes SDK | `src/App.tsx`, Supabase `storageKey` |
| sessionStorage | pouze dočasný stav filtrů knihovny | `src/components/Library.tsx` |
| Backend | Supabase Auth, PostgreSQL/Data API, privátní Storage, RPC; Realtime se nepoužívá | `src/auth/secureAccess.ts`, SQL migrace |
| Edge Functions | nově připravená `offline-grant`, zatím nenasazená | `supabase/functions/offline-grant/index.ts` |

## Původní příčina odhlašování

Před patchem modeloval `useSecureAccount` účet pouze pomocí `session | null`. `App.tsx` měl guard ekvivalentní `if (secure mode && !session) zobraz login`. Auth listener při každé prázdné session nuloval profil. Neexistoval samostatný stav „server nedostupný, lokální oprávnění platné“. `loadSecureProfile()` navíc ignoroval chybu `auth.getUser()` a prázdného uživatele mohl zaměnit za neautentizovaný stav.

Hlavní příčinou tedy nebyl prokázaný výpadek nebo nespolehlivost Supabase, ale klientský auth guard a chybějící offline autorizační model.

## Načítání a veřejnost písní

- Veřejný build obsahuje jedinou syntetickou píseň `Syntetická jiskra` a její syntetické MusicXML party.
- `public/content` a vygenerované `docs/content` mají přibližně 9 kB obsahových dat. Každý veřejný záznam obsahuje práva a licenci.
- Členské balíčky nejsou v Git repozitáři ani frontendovém JavaScriptu. Stahují se z privátního bucketu `song-library` přes uživatelskou Supabase session.
- Uploady jsou v privátním bucketu `song-submissions`; automatické publikování je zakázané a každý návrh má `requires_review`.
- `songs_data/` a `data/import/*` jsou v `.gitignore`; audit je nečetl ani neměnil.

## Autentizace a autorizace

- Supabase klient používá PKCE, `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`.
- Online profil je server-authoritative: `pending | approved | rejected | suspended`, role `member | admin`.
- Přímá volání Supabase jsou soustředěna v `src/auth/secureAccess.ts`; nová rozhraní jsou v `src/repositories/contracts.ts`.
- Podepsaný offline grant je oddělen od access tokenu. Klient ověřuje ES256, `issuer`, `audience`, `kid`, zařízení, balíček a časovou platnost.
- Privátní podpisový JWK se nachází pouze v serverovém secretu Edge Function. Do Vite buildu patří jen veřejný JWKS.

## Chování chyb po patchi

| Událost | Výsledek |
|---|---|
| airplane mode, DNS/fetch chyba, timeout | platný grant → `authenticated-offline`; nic se nemaže |
| HTTP 500–599 | platný grant → `authenticated-offline`; diagnostika `backend unavailable` |
| vypršený access token + funkční refresh | `authenticated-online`, grant se obnoví |
| refresh nedostupný kvůli síti | platný grant → `authenticated-offline` |
| běžný 401/403 bez potvrzené revokace | grant se nemaže; dočasný offline fallback je povolen |
| serverový kód `account_revoked`/`account_suspended` | přístup se odmítne; lokální data se nemažou skrytě |
| vypršený/neplatný podpis grantu | chráněný obsah se neotevře, zobrazí se nutnost online ověření |
| ruční logout | lokální Supabase session, offline grant a chráněný balíček se odstraní |

## Databáze a RLS

Repozitář obsahuje tabulky `profiles`, `song_submissions`, `user_app_state` a připravenou `offline_grant_audit`. RLS je zapnutá na všech těchto tabulkách. Storage buckety jsou privátní. Politiky používají `auth.uid()`, `is_approved_member()` a `is_app_admin()`; INSERT/UPDATE uživatelského stavu mají `WITH CHECK`.

Nelze bez připojení k projektu prokázat, že všechny soubory migrací byly skutečně aplikovány, že v produkci neexistují další tabulky/politiky nebo že se konfigurace ručně nezměnila. Před nasazením je nutný read-only export `pg_policies`, rolí, funkcí, bucketů a policies podle `RLS_AUDIT.md`.

## Taxonomie rizik

- **Autentizační:** původní boolean guard; opraven explicitním automatem.
- **Síťové:** síťová chyba byla zaměněna za logout; opraveno klasifikací a timeoutem.
- **Cache:** starý veřejný obsah neměl SHA‑256; nové katalogy jej mají.
- **Datové:** staré členské balíčky před DB v5 nemají vlastníka; při první online obnově se svážou s účtem.
- **Routing:** GitHub Pages vyžaduje `404.html` a správný base path; konfigurace je přítomná.
- **RLS:** zdrojové migrace vypadají konzervativně, produkční shoda není ověřená.
- **Hosting:** GitHub Pages je statický a nemůže bezpečně držet podpisový klíč; proto Edge Function.
- **Bezpečnostní:** PWA není DRM a offline revokace nemůže být okamžitá.

## Otevřené body

1. Nasadit a otestovat migraci + Edge Function nejprve ve stagingu.
2. Vytvořit/rotovat ES256 klíče mimo Git a nastavit přesný seznam originů.
3. Ověřit produkční RLS skutečnými účty A/B/admin.
4. Po první online obnově odstranit nebo převázat legacy balíčky bez `ownerUserId`.
5. Rozhodnout přesnou dobu grantu; návrh je 30 dní, maximum funkce 90 dní.
