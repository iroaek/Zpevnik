# Bezpečnostní model

Datum revize: 11. 8. 2026. Hodnocení: pravděpodobnost/dopad `nízká | střední | vysoká`.

| Hrozba | Pravd. | Dopad | Mitigace | Reziduální riziko |
|---|---:|---:|---|---|
| Odcizení access/refresh tokenu | střední | vysoký | HTTPS, PKCE, žádné logování tokenů, krátký access token, Supabase rotace refresh tokenu | XSS nebo kompromitované zařízení může token získat |
| XSS | nízká–střední | vysoký | React escaping, zákaz `dangerouslySetInnerHTML`/`eval`, CSP, sanitizace importů | Chyba v knihovně/rendereru zůstává možná |
| Škodlivý importovaný text | střední | střední | Zod limity, Unicode normalizace, odstranění řídicích znaků, text-only rendering, `requires_review` | Sociální inženýrství a zavádějící obsah |
| Zneužití veřejného API | střední | vysoký | RLS, privátní buckety, rate limits na BFF/Function, validace, přesný CORS | DoS proti veřejným endpointům |
| Service-role v klientovi | nízká po kontrole | kritický | workflow a Vite používají jen publishable key; service role pouze Edge Function secret | Chyba budoucí konfigurace |
| Chybná RLS | střední | kritický | migrations-as-code, `WITH CHECK`, A/B/admin testy, staging introspekce | Ruční drift v produkci |
| Veřejný chráněný obsah | nízká po kontrole | vysoký | repozitář obsahuje jen syntetiku; privátní Storage a autorizovaný download | Administrátor může omylem publikovat build artefakt |
| Manipulace s offline grantem | střední | vysoký | standardní JWS ES256, JWKS/kid, issuer/audience/package/device/time kontroly | Kompromitovaný privátní klíč |
| Manipulace s lokálním časem | střední | střední | podpis a toleranční okno; `issuedAt/notBefore/expiry`; obnovování online | Plně offline klient může posunout čas; pro vyšší riziko zkrátit platnost a evidovat poslední důvěryhodný čas |
| Kopírování lokálních dat | střední | střední–vysoký | owner binding, logout cleanup, budoucí nativní secure storage/SQLite | Webový uživatel s DevTools může data číst |
| Více uživatelů na zařízení | střední | vysoký | `ownerUserId` pro balíček, filtrování repository, odstranění při logoutu | Legacy DB v4 vyžaduje první online obnovu |
| Ztráta telefonu | střední | vysoký | omezená doba grantu, ruční odebrání účtu, PIN/biometrie OS; budoucí Capacitor | Offline grant nejde okamžitě odvolat |
| Root/jailbreak | nízká | vysoký | nedůvěřovat klientovi, žádné server secrets, krátká oprávnění | Lokální data a klíče mohou být extrahovány |
| Revokace během offline provozu | střední | střední–vysoký | konfigurovatelné `offlineValidUntil`, explicitní revokace při online ověření | Okamžitá offline revokace není technicky možná |
| Poškozená aktualizace obsahu | nízká–střední | vysoký | SHA‑256, schéma, transakční aktivace, rollback | Kompromitovaný server může dodat konzistentně škodlivý obsah |
| Poškozený service worker update | nízká | vysoký | prompt update, Workbox revize, starý worker do aktivace, E2E | Chyba nové aplikace po vědomé aktivaci |

## Nepřekročitelné limity

- PWA nemůže garantovat absolutní ochranu již stažených textů.
- Nativní aplikace ani šifrovaná SQLite nezajišťují absolutní DRM.
- RLS působí na serverové řádky, nikoli na lokální kopii.
- Server nemůže okamžitě odvolat oprávnění telefonu bez sítě.
- Klientské šifrování není silné DRM, pokud stejný JavaScript získá i dešifrovací klíč.

## Klíče a logování

Edge Function čte `OFFLINE_GRANT_PRIVATE_JWK` pouze ze serverového secretu. Frontend dostává pouze veřejný JWKS. Diagnostika ukládá názvy stavů, HTTP třídu a časy; nikdy tokeny, hesla, e-mail, privátní klíč ani text písně.
