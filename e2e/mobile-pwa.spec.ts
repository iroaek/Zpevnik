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

function syntheticPdf(): Buffer {
  const stream = ['BT', '/F1 16 Tf', '40 760 Td', '(Synthetic Song) Tj', '0 -24 Td', '(C G) Tj', '0 -24 Td', '(Test line) Tj', 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  const registration = page.getByRole('heading', { name: 'Jak vám máme říkat?' });
  const library = page.getByRole('heading', { name: 'Co si dnes zazpíváme?' });
  await expect(registration.or(library)).toBeVisible({ timeout: 15_000 });
  if (await registration.isVisible()) {
    await page.getByLabel('Jméno nebo přezdívka').fill('Mobilní test');
    await page.getByRole('button', { name: 'Vytvořit profil a pokračovat' }).click();
    await expect(library).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Zastavit posun' })).toBeVisible();
  await expect(page.getByText('žádná známá píseň')).toBeVisible();
  await page.getByRole('button', { name: 'Zastavit posun' }).click();

  await page.getByRole('button', { name: 'Režim U ohně' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-fire-mode', 'true');
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  const initialFireSize = await page.locator('.chord-sheet').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  await page.getByRole('button', { name: 'Zvětšit text v režimu U ohně' }).click();
  await expect.poll(() => page.locator('.chord-sheet').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(initialFireSize);
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: 'Ukončit U ohně' }).click();
});

test('vyhledávání zůstává uvnitř úvodního panelu na mobilu i desktopu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Geometrii stačí ověřit jednou pro oba reprezentativní viewporty.');
  for (const viewport of [{ width: 390, height: 844 }, { width: 1300, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await page.goto('./');
    const hero = await page.locator('.hero-card').boundingBox();
    const search = await page.locator('.library-sticky-search').boundingBox();
    expect(hero).not.toBeNull();
    expect(search).not.toBeNull();
    expect(search!.x).toBeGreaterThanOrEqual(hero!.x);
    expect(search!.y).toBeGreaterThanOrEqual(hero!.y);
    expect(search!.x + search!.width).toBeLessThanOrEqual(hero!.x + hero!.width + 1);
    expect(search!.y + search!.height).toBeLessThanOrEqual(hero!.y + hero!.height + 1);
    await expectNoPageOverflow(page);
  }
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

test('syntetické PDF se na mobilu skutečně přečte a uloží', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Import stačí provést v reprezentativním mobilním viewportu.');
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, value: undefined });
    Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: undefined });
    Object.defineProperty(Blob.prototype, 'text', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined });
  });
  await page.goto('import');
  await page.getByRole('button', { name: 'Vybrat PDF ze zařízení' }).setInputFiles({
    name: 'synthetic-song.pdf',
    mimeType: 'application/pdf',
    buffer: syntheticPdf(),
  });

  await expect(page.getByText(/Import dokončen: 1 osobních konceptů/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.device-song-open').filter({ hasText: 'Synthetic Song' })).toBeVisible();
});

test('stažená píseň funguje offline a nestažené noty zobrazí upozornění', async ({ page, context }) => {
  await page.goto('./');
  await ensureServiceWorkerControls(page);
  await page.goto('offline');
  await page.getByRole('button', { name: /Stáhnout ukázky|Ověřit znovu/ }).click();
  await expect(page.getByText('Ukázkové písně byly staženy a ověřeny.')).toBeVisible({ timeout: 20_000 });
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
  await page.getByRole('button', { name: /Stáhnout noty|Ověřit znovu/ }).click();
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
  await expect(page.getByRole('tab', { name: /Aktualizační test/ })).toBeVisible();
  await page.goto('./');
  await page.getByRole('button', { name: /Syntetická jiskra/ }).click();
  await expect(page.getByRole('button', { name: 'Odebrat z oblíbených' })).toBeVisible();
  await page.goto('setlists');
  await page.getByRole('button', { name: 'Smazat setlist' }).click();
  await page.getByRole('button', { name: 'Ano, smazat setlist' }).click();
  await expect(page.getByText('Zatím nemáte žádný setlist.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: /Aktualizační test/ })).toHaveCount(0);
});

test('offline cold start zachová staženou píseň, transpozici, oblíbené a setlist', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Kompletní cold-start scénář stačí v reprezentativním mobilním viewportu.');
  await page.goto('./');
  await ensureServiceWorkerControls(page);
  await page.goto('offline');
  await page.getByRole('button', { name: /Stáhnout ukázky|Ověřit znovu/ }).click();
  await expect(page.getByText('Ukázkové písně byly staženy a ověřeny.')).toBeVisible({ timeout: 20_000 });
  await page.goto('songs/synteticka-jiskra');
  await page.getByRole('button', { name: 'Přidat do oblíbených' }).click();
  await page.goto('setlists');
  await page.getByLabel('Název nového setlistu').fill('Offline cold start');
  await page.getByRole('button', { name: 'Vytvořit' }).click();

  const appBaseUrl = page.url().replace(/setlists$/, '');
  const songUrl = new URL('songs/synteticka-jiskra', appBaseUrl).toString();
  await page.close();
  await context.setOffline(true);
  const coldPage = await context.newPage();
  await coldPage.goto(songUrl, { waitUntil: 'domcontentloaded' });
  await expect(coldPage.getByText('Jiskra kreslí')).toBeVisible({ timeout: 20_000 });
  await expect(coldPage.getByRole('button', { name: 'Odebrat z oblíbených' })).toBeVisible();
  await coldPage.getByRole('button', { name: 'Zvýšit o půltón' }).click();
  await expect(coldPage.getByLabel('Posun v půltónech')).toHaveText('+1');
  await coldPage.goto(new URL('setlists', appBaseUrl).toString());
  await expect(coldPage.getByRole('tab', { name: /Offline cold start/ })).toBeVisible();
  await context.setOffline(false);
});
