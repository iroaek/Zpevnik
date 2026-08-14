import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';

const cssAsset = readdirSync('dist/assets').find((name) => /^index-.*\.css$/.test(name));

test('mobilní karta uživatele ponechá identitě čitelnou šířku', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 430, 'Mobilní kontrakt se ověřuje pouze v portrétním zobrazení.');
  if (!cssAsset) throw new Error('V dist/assets chybí hlavní CSS soubor.');

  await page.goto('/Zpevnik/');
  await page.setContent(`<!doctype html><html lang="cs"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/Zpevnik/assets/${cssAsset}"></head><body><main class="app-main"><section class="admin-page"><section class="backup-card admin-users-panel"><div class="admin-user-list"><article class="admin-user-row"><div class="admin-user-primary"><label class="admin-user-select"><input type="checkbox" aria-label="Vybrat uživatele"></label><span class="admin-user-avatar">P<i class="admin-user-presence online"></i></span><span class="admin-user-identity"><strong>Petr H.</strong><small class="admin-user-email">cruman.ph@gmail.com</small><small>Online nyní</small></span></div><div class="admin-user-badges"><span class="status-badge status-badge--approved">Schválený</span><span class="status-badge status-badge--admin">Administrátor</span><button class="admin-user-device-button"><span>2 zařízení</span><i>⌄</i></button></div></article></div></section></section></main></body></html>`);
  await page.locator('link[rel="stylesheet"]').evaluate((link: HTMLLinkElement) => link.sheet ? undefined : new Promise<void>((resolve, reject) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => reject(new Error('CSS se nepodařilo načíst.')), { once: true });
  }));

  const card = page.locator('.admin-user-row');
  const identity = page.locator('.admin-user-identity');
  const email = page.locator('.admin-user-email');
  const badges = page.locator('.admin-user-badges');
  await expect(card).toBeVisible();

  const [cardBox, identityBox, emailBox, badgeBox] = await Promise.all([
    card.boundingBox(), identity.boundingBox(), email.boundingBox(), badges.boundingBox(),
  ]);
  expect(cardBox?.width).toBeGreaterThan(240);
  expect(identityBox?.width).toBeGreaterThan(110);
  expect(emailBox?.width).toBeGreaterThan(110);
  expect(badgeBox?.y).toBeGreaterThan(identityBox?.y ?? 0);
  if (process.env.ADMIN_VISUAL_QA) await page.screenshot({ path: 'test-results/admin-user-mobile.png', fullPage: true });
});
