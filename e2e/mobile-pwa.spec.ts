import { expect, test } from '@playwright/test';

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function ensureServiceWorkerControls(page: import('@playwright/test').Page) {
  const controlled = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  });
  if (!controlled) await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  const registration = page.getByRole('heading', { name: 'Jak vám máme říkat?' });
  if (await registration.isVisible()) {
    await page.getByLabel('Jméno nebo přezdívka').fill('Mobilní test');
    await page.getByRole('button', { name: 'Vytvořit profil a pokračovat' }).click();
    await expect(page.getByRole('heading', { name: 'Co si dnes zazpíváme?' })).toBeVisible();
  }
});

test('mobilní čtečka nemá přetečení a ovládá transpozici, text i posun', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Co si dnes zazpíváme?' })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: /Syntetická jiskra/ }).click();
  await expect(page.getByText('Jiskra kreslí')).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Zvýšit o půltón' }).click();
  await expect(page.getByLabel('Posun v půltónech')).toHaveText('+1');
  const initialSize = await page.locator('.chord-sheet').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  await page.getByRole('button', { name: 'Zvětšit písmo' }).click();
  await expect.poll(() => page.locator('.chord-sheet').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(initialSize);

  await page.getByRole('button', { name: 'Automatický posun' }).click();
  await expect(page.getByRole('button', { name: 'Zastavit posun' })).toBeVisible();
  await page.locator('.fire-tap-zone').click();
  await expect(page.getByRole('button', { name: 'Automatický posun' })).toBeVisible();

  await page.getByRole('button', { name: 'Režim U ohně' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-fire-mode', 'true');
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: 'Ukončit U ohně' }).click();
});

test('deep linky načtou píseň, setlist, import PDF, instalaci, offline obsah a nápovědu', async ({ page }) => {
  await page.goto('songs/synteticka-jiskra');
  await expect(page.getByRole('heading', { name: 'Syntetická jiskra' })).toBeVisible();
  await page.goto('setlists/synteticky-vecer');
  await expect(page.getByRole('heading', { name: 'Syntetický večer' })).toBeVisible();
  await page.goto('offline');
  await expect(page.getByRole('heading', { name: 'Offline obsah' })).toBeVisible();
  await page.getByRole('button', { name: 'Přejít k instalaci' }).click();
  await expect(page.getByRole('heading', { name: 'Nainstalovat zpěvník' })).toBeVisible();
  await page.goto('import');
  await expect(page.getByRole('heading', { name: 'Vložit PDF s akordy' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Akordy v PDF jsou zkontrolované' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Přidat' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nahrát nebo vyžádat píseň' })).toBeVisible();
  await page.goto('help');
  await expect(page.getByRole('heading', { name: 'Jak používat zpěvník' })).toBeVisible();
  await expectNoPageOverflow(page);
});

test('stažená píseň funguje offline a nestažené noty zobrazí upozornění', async ({ page, context }) => {
  await page.goto('./');
  await ensureServiceWorkerControls(page);
  await page.goto('offline');
  await page.getByRole('button', { name: /Stáhnout celý zpěvník|Ověřit a stáhnout znovu/ }).click();
  await expect(page.getByText('Všechny písně byly staženy a ověřeny.')).toBeVisible({ timeout: 20_000 });
  await page.goto('songs/synteticka-jiskra');
  await expect(page.getByText('Jiskra kreslí')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Jiskra kreslí')).toBeVisible();
  await page.getByRole('tab', { name: /Noty/ }).click();
  await expect(page.getByText(/notový part ještě není stažený/i)).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);
});

test('výslovně stažené noty se vykreslí offline', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Stažení velkého rendereru stačí ověřit v reprezentativním mobilním viewportu.');
  await page.goto('./');
  await ensureServiceWorkerControls(page);
  await page.goto('offline');
  await page.getByRole('button', { name: /Stáhnout všechny notové party|Ověřit noty znovu/ }).click();
  await expect(page.getByText('Všechny notové party byly staženy a ověřeny.')).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await page.goto('songs/synteticka-jiskra');
  await page.getByRole('tab', { name: /Noty/ }).click();
  await expect(page.locator('.score-host svg').first()).toBeVisible({ timeout: 30_000 });
  await context.setOffline(false);
});

test('oblíbené a soukromý setlist přežijí obnovení aplikace', async ({ page }) => {
  await page.goto('songs/synteticka-jiskra');
  await page.getByRole('button', { name: 'Přidat do oblíbených' }).click();
  await page.goto('setlists');
  await page.getByLabel('Název nového setlistu').fill('Aktualizační test');
  await page.getByRole('button', { name: 'Vytvořit' }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Aktualizační test' })).toBeVisible();
  await page.goto('./');
  await page.getByRole('button', { name: /Syntetická jiskra/ }).click();
  await expect(page.getByRole('button', { name: 'Odebrat z oblíbených' })).toBeVisible();
});
