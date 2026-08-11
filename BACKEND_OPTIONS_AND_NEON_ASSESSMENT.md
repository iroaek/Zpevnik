# Supabase versus Neon

Ověřeno 11. 8. 2026 výhradně proti oficiální dokumentaci. Ceny a produktové stavy jsou proměnlivé; před nákupem nebo migrací je znovu ověřte.

## Krátké doporučení

**Nyní ponechat Supabase a dokončit/stagingově ověřit offline architekturu.** Přechod na Neon neřeší klientské odhlašování ani offline cold start. Nemigrovat současně databázi, Auth a Storage. Pokud později vznikne měřitelný důvod k přesunu databáze, nejméně rizikový mezikrok je Neon PostgreSQL + dočasně Supabase Auth a Storage + vlastní malý BFF.

Neon podporuje PostgreSQL RLS, ale není principiálně „pokročilejší“ než Supabase RLS. V obou případech je základem PostgreSQL Row-Level Security; liší se integrace JWT, Data API a provozní platforma.

## Varianty

| Varianta | Výhody | Nevýhody/rizika | Verdikt |
|---|---|---|---|
| A. Supabase + opravený offline režim | nejmenší změna; Auth, DB, RLS, Storage, Functions a zálohy v jedné platformě; současné migrace odpovídají | vendor lock-in platformy; nutná kontrola tarifu, SMTP, záloh a RLS driftu | **doporučeno nyní** |
| B. Neon DB + Supabase Auth | oddělení DB, zachování uživatelů; postupná migrace | BFF/JWT integrace, dvě platformy, Storage zůstává jinde, složitější monitoring/rollback | možný stagingový krok až po P0/P1 |
| C. Neon DB + vlastní BFF + stabilní auth | plná kontrola, cookies pro web, jednotná autorizace | nejvyšší vývojová/provozní odpovědnost, rate limit, sessions, e-mail, MFA, incidenty | jen s kapacitou na backend provoz |
| D. Neon DB + externí auth | specializovaný provider, BFF/RLS integrace | třetí vendor, migrace identity, nové ceny a lock-in, Storage stále samostatně | pouze po samostatném výběrovém řízení |
| E. Self-hosted | maximální kontrola | patching, HA, backup, SMTP, storage, observability a pohotovost na správci | pro současný projekt nerealistické |

## Ověřená fakta

- Supabase poskytuje PostgreSQL, Auth, Storage s RLS, Realtime a Edge Functions. Storage objekty nejsou součástí databázových záloh; zálohovat se musí odděleně: [Supabase backups](https://supabase.com/docs/guides/platform/backups), [Storage](https://supabase.com/docs/guides/storage).
- Supabase Auth používá krátkodobé access JWT a rotační refresh tokeny; síťové selhání refreshu nemá být klientem zaměněno za ztrátu offline oprávnění: [User sessions](https://supabase.com/docs/guides/auth/sessions).
- Supabase oficiálně popisuje migraci auth tabulek včetně bcrypt hashů mezi Supabase projekty, ale změna JWT secretu zneplatní relace: [Migrating Auth Users](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects). To automaticky neznamená kompatibilní import do jiného auth produktu.
- Neon dokumentuje PostgreSQL RLS přes Data API nebo JWT/JWKS integraci; tyto dvě cesty se na jedné branch nekombinují: [Neon RLS](https://neon.com/docs/guides/row-level-security).
- Oficiální Neon materiály z roku 2025 označovaly Neon Auth a Data API jako beta. Současný pricing Neon Auth uvádí, ale audit nenašel jednoznačnou aktuální GA deklaraci pro kritickou auth migraci. Před rozhodnutím požadovat výslovné GA/SLA potvrzení: [Neon pricing](https://neon.com/pricing), [Data API beta changelog](https://neon.com/docs/changelog/2025-06-20).
- Neon nabízí Postgres restore window/instant restore a migrace přes `pg_dump`/`pg_restore` nebo logical replication: [Manage projects](https://neon.com/docs/manage/projects), [Migration guides](https://neon.com/docs/import/migrate-intro).
- Capacitor lze přidat do existující moderní webové aplikace: [Capacitor docs](https://capacitorjs.com/docs).

## Cena, region, GDPR a provoz

- Supabase pricing při auditu uváděl Free a Pro od 25 USD/měsíc, 7denní denní backup na Pro a PITR jako placený doplněk. Free projekty mohou být při neaktivitě pozastaveny: [pricing](https://supabase.com/pricing), [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
- Neon pricing při auditu uváděl Free, usage-based Launch a Scale, restore windows podle plánu a evropskou kapacitu Frankfurt v changelogu: [pricing](https://neon.com/pricing), [changelog](https://neon.com/docs/changelog).
- Konkrétní region současného Supabase projektu, skutečný tarif, DPA, subprocesory, RPO/RTO a očekávané počty uživatelů nebyly z repozitáře zjistitelné. Jsou otevřeným bodem správce.
- Minimalizovat PII na e-mail + display name + auditní metadata; tokeny, texty písní a privátní klíče nikdy neposílat do telemetrie.

## Spolehlivost a offline-first

Žádný backend provider není zdrojem offline dostupnosti. Offline spolehlivost zajišťuje app shell + IndexedDB/SQLite + podepsaný grant + transakční balíčky. Migrace backendu bez této vrstvy by pouze přesunula stejnou chybu.
