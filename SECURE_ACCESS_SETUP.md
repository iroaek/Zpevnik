# Soukromé účty a schvalování

GitHub Pages může dál veřejně poskytovat pouze instalační PWA. Uživatelské účty, stav schválení, členská knihovna a nahrané soubory jsou uloženy v soukromém projektu Supabase. Veřejný klientský klíč není tajemství; přístup vynucují databázové RLS politiky podle ověřené relace uživatele.

## Tok přístupu

1. Uživatel zadá jméno nebo přezdívku, e-mail a heslo.
2. Potvrdí registrační e-mail.
3. Profil zůstane ve stavu `pending`; aplikace mu neposkytne katalog ani formulář pro návrhy.
4. Administrátor v Nastavení účet schválí nebo zamítne.
5. Jen profil `approved` může stáhnout členský balíček a vložit požadavek nebo soubor.
6. Každý návrh začíná jako `requires_review`. Převzetí ke kontrole jej ještě nepublikuje.

## Jednorázové zprovoznění

1. Vytvořte projekt na Supabase a ponechte zapnuté potvrzení e-mailu.
2. V **Authentication → URL Configuration** nastavte Site URL na `https://iroaek.github.io/Zpevnik/` a tutéž adresu povolte mezi Redirect URLs.
3. V SQL editoru spusťte migraci `supabase/migrations/202608060001_private_members.sql`.
4. Zaregistrujte přes aplikaci svůj vlastní účet.
5. V SQL editoru jej jednorázově povyšte; e-mail nahraďte skutečnou adresou:

   ```sql
   update public.profiles
   set status = 'approved', role = 'admin', reviewed_at = now(), reviewed_by = id
   where lower(email) = lower('vas-email@example.cz');
   ```

6. V GitHub repozitáři nastavte Actions variables:

   - `VITE_SUPABASE_URL` – Project URL,
   - `VITE_SUPABASE_PUBLISHABLE_KEY` – publishable client key, nikdy ne `service_role`,
   - `VITE_REQUIRE_SECURE_ACCESS` – `true`.

7. Znovu spusťte workflow pro GitHub Pages.

## Soukromé písně

Členský balíček se ukládá do privátního bucketu `song-library` jako `members/member-library.json`. Smí obsahovat pouze skladby se zdrojem, licencí, atribucí a stavem práv, který dovoluje sdílení. Záznamy `requires_review` do členského balíčku nepatří. Správcovský balíček lze uložit odděleně pod `admin/`.

Po aktivaci serveru odstraňte dosavadní balíček z veřejného GitHub Pages a vyřaďte starý sdílený přístupový kód. Kopii, kterou si uživatel dříve stáhl pro offline použití, nelze na dálku zaručeně smazat; odebrání účtu zastaví další serverové stahování po příštím připojení.

## Ochrana osobních údajů

Aplikace ukládá e-mail, zvolené jméno, stav schválení a historii uživatelských návrhů. Před ostrým provozem doplňte kontakt správce údajů, účel a dobu uchování, postup výmazu účtu a zásady ochrany osobních údajů.
