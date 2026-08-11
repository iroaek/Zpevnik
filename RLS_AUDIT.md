# Audit RLS a Storage policies

## Výsledek statického auditu

| Objekt | RLS | Zásadní pravidlo | Stav |
|---|---|---|---|
| `profiles` | enabled | vlastní profil nebo schválený admin | vyhovuje zdrojové migraci |
| `song_submissions` | enabled | owner/admin read; INSERT pouze vlastní `user_id`, approved, `requires_review` | vyhovuje |
| `user_app_state` | enabled | vlastní `user_id`, approved; INSERT/UPDATE mají `WITH CHECK` | vyhovuje |
| `offline_grant_audit` | enabled + force | čtení jen admin; INSERT pouze serverová service role | připraveno, nenasazeno |
| Storage `song-library` | private | members/admin prefix + serverové role | vyhovuje zdrojové migraci |
| Storage `song-submissions` | private | vlastní prefix upload/read/delete; admin read | vyhovuje |

Anon role nemá GRANT na chráněné tabulky. Publishable key v klientovi RLS neobchází. Service-role/S3 admin credentials do klienta nepatří a v auditovaných Vite proměnných nejsou.

## Povinná staging/produkční introspekce

Následující dotazy jsou read-only; před spuštěním použijte read-only účet a výstup necommitujte, pokud obsahuje identifikátory:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname in ('public', 'storage')
order by 1, 2;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by 1, 2, 3;

select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema in ('public', 'storage')
order by 1, 2, 3, 4;
```

## Dynamická matice testů

Ve stagingu vytvořit syntetické účty `anonymous`, A, B, admin, pending, approved a suspended. Ověřit:

1. anonymous nečte chráněné tabulky ani objekty;
2. A nečte profil/stav/návrh B a nemůže INSERT/UPDATE s `user_id=B`;
3. pending/suspended nestáhne členký balíček;
4. approved člen stáhne jen `members/*`;
5. admin čte správní data a `admin/*`, ale běžný klient nemá service role;
6. runtime role nepoužívá `BYPASSRLS`;
7. owner/migration credentials jsou jiné než runtime credentials.

Statické integrační testy jsou v `tests/rls-policy.integration.test.ts`. Nenahrazují dynamické testy proti stagingu.

## Neon varianta

Použít nativní PostgreSQL RLS, minimálně role `migration_owner`, `app_runtime`, `app_readonly`. `migration_owner` se nikdy nepoužije za běhu; `app_runtime` nesmí mít `BYPASSRLS`. Pokud BFF nastavuje identitu v pooled connection, použije transakční `SET LOCAL` až po ověření JWT a test úniku identity mezi requesty A/B.
