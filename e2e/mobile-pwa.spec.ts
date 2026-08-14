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
  const library = page.getByRole('heading', { name: 'Český zpěvník', exact: true });
  await expect(registration.or(library)).toBeVisible({ timeout: 15_000 });
  if (await registration.isVisible()) {
    await page.getByLabel('Jméno nebo přezdívka').fill('Mobilní test');
    await page.getByRole('button', { name: 'Vytvořit profil a pokračovat' }).click();
    await expect(library).toBeVisible();
  }
});

test('mobilní čtečka nemá přetečení a ovládá transpozici, text i posun', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Český zpěvník', exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: /^Akordy/ }).click();
  await page.getByRole('button', { name: /Syntetická jiskra/ }).click();
  await expect(page.getByText('Jiskra kreslí')).toBeVisible();
  await expectNoPageOverflow(page);
  const readerGeometry = await page.locator('.reader-performance-surface').evaluate((surface) => {
    const tapZone = surface.querySelector<HTMLElement>('.fire-tap-zone')!;
    const sheet = surface.querySelector<HTMLElement>('.chord-sheet')!;
    return {
      tapWidth: tapZone.getBoundingClientRect().width,
      sheetWidth: sheet.getBoundingClientRect().width,
    };
  });
  expect(readerGeometry.sheetWidth / readerGeometry.tapWidth).toBeGreaterThanOrEqual(.93);
  const mobileChordFlow = await page.locator('.chord-line--with-chords').first().evaluate((line) => {
    const word = line.querySelector<HTMLElement>('.chord-word')!;
    const token = line.querySelector<HTMLElement>('.chord-token')!;
    const lyric = line.querySelector<HTMLElement>('.lyric')!;
    const chord = line.querySelector<HTMLElement>('.chord:not(.chord--empty)')!;
    return {
      line: getComputedStyle(line).display,
      word: getComputedStyle(word).whiteSpace,
      token: getComputedStyle(token).display,
      lyric: getComputedStyle(lyric).display,
      chord: getComputedStyle(chord).display,
    };
  });
  expect(mobileChordFlow).toEqual({ line: 'block', word: 'nowrap', token: 'grid', lyric: 'block', chord: 'block' });
  const readerButtons = await page.locator('.toolbar-actions > .icon-button').evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  expect(readerButtons.every(({ width, height }) => width >= 44 && height >= 44 && Math.abs(width - height) <= 12)).toBe(true);
  const performanceButtons = await page.locator('.performance-entry .icon-button').evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  const isCompactPortrait = (page.viewportSize()?.width ?? 0) <= 704;
  expect(performanceButtons.every(({ width, height }) => height >= 44 && width >= (isCompactPortrait ? 100 : 44))).toBe(true);

  await page.getByRole('button', { name: 'Zvýšit o půltón' }).click();
  await expect(page.getByLabel('Posun v půltónech')).toHaveText('+1');
  const initialSize = await page.locator('.chord-sheet').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  await page.getByRole('button', { name: 'Otevřít nastavení zobrazení' }).click();
  await page.getByLabel('Nastavit velikost textu').fill(String(initialSize + 2));
  const widthControl = page.getByLabel('Šířka textu');
  await widthControl.fill('320');
  await expect(page.locator('.reader-width-mobile')).toHaveText('84 %');
  const compactReaderWidth = await page.locator('.chord-sheet').evaluate((element) => element.getBoundingClientRect().width);
  await widthControl.fill('980');
  await expect(page.locator('.reader-width-mobile')).toHaveText('100 %');
  await expect.poll(() => page.locator('.chord-sheet').evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(compactReaderWidth + 30);
  await page.getByRole('button', { name: 'Hotovo' }).click();
  await expect.poll(() => page.locator('.chord-sheet').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(initialSize);

  await page.getByRole('button', { name: 'Spustit odpočet a automatický posun' }).click();
  await expect(page.getByRole('button', { name: 'Pozastavit automatický posun' })).toBeVisible({ timeout: 4_000 });
  await page.locator('.fire-tap-zone').click();
  await expect(page.getByRole('button', { name: 'Pozastavit automatický posun' })).toBeVisible();
  await expect(page.getByText('žádná známá píseň')).toBeVisible();
  await page.getByRole('button', { name: 'Pozastavit automatický posun' }).click();

  await page.getByRole('button', { name: 'Režim u ohně' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-performance-mode', 'fire');
  await expect(page.getByText('Jiskra kreslí')).toBeVisible();
  await expect(page.locator('.reader-guidance')).toBeHidden();
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: 'Ukončit režim u ohně' }).click();

  await page.getByRole('button', { name: 'Pódiový režim' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-fire-mode', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-performance-mode', 'stage');
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  const initialFireSize = await page.locator('.chord-sheet').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  await page.getByRole('button', { name: 'Zvětšit text' }).click();
  await expect.poll(() => page.locator('.chord-sheet').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(initialFireSize);
  const fireDockBottomGap = await page.locator('.fire-dock').evaluate((element) => Math.abs(window.innerHeight - element.getBoundingClientRect().bottom));
  expect(fireDockBottomGap).toBeLessThanOrEqual(1);
  await expectNoPageOverflow(page);
  if (!await page.getByRole('button', { name: 'Ukončit pódiový režim' }).isVisible()) {
    await page.getByRole('button', { name: 'Zobrazit pódiové ovládání' }).click();
  }
  await page.getByRole('button', { name: 'Ukončit pódiový režim' }).click();
  await page.getByRole('button', { name: 'Zpět do seznamu' }).click();
  await expect(page.getByRole('heading', { name: 'Písně', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('.now-playing-bar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rychlé akce' }).click();
  await expect(page.getByRole('dialog', { name: /Syntetická jiskra/ })).toBeVisible();
  const quickActionOverlap = await page.evaluate(() => {
    const sheet = document.querySelector('.quick-action-sheet')?.getBoundingClientRect();
    const navigation = document.querySelector('.bottom-nav')?.getBoundingClientRect();
    return sheet && navigation ? Math.max(0, sheet.bottom - navigation.top) : 0;
  });
  expect(quickActionOverlap).toBeLessThanOrEqual(1);
});

test('desktopové nastavení neobsahuje překrývající lištu poslední písně', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Desktopovou regresi stačí ověřit jednou.');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByRole('button', { name: /^Akordy/ }).click();
  await page.getByRole('button', { name: /Syntetická jiskra/ }).click();
  await expect(page.getByText('Jiskra kreslí')).toBeVisible();
  await page.getByRole('button', { name: 'Zpět do seznamu' }).click();
  await page.getByRole('button', { name: 'Nastavení' }).click();

  await expect(page.getByRole('heading', { name: 'Nastavení', exact: true })).toBeVisible();
  await expect(page.locator('.now-playing-bar')).toHaveCount(0);
  await expect(page.locator('.app-shell')).not.toHaveClass(/app-shell--mini-player/);
  await expectNoPageOverflow(page);
});

test('tisk písně obsahuje pouze záhlaví a text s akordy bez prázdné úvodní stránky', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Tiskové médium stačí ověřit v reprezentativním viewportu.');
  await page.goto('songs/synteticka-jiskra');
  await expect(page.getByText('Jiskra kreslí')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });

  const printDocument = page.locator('.print-song-document');
  await expect(printDocument).toBeVisible();
  await expect(printDocument.locator('h1')).toHaveText('Syntetická jiskra');
  await expect(printDocument.getByText('Vývojový tým projektu')).toBeVisible();
  await expect(printDocument.getByText('Jiskra kreslí')).toBeVisible();
  await expect(page.locator('.reader-toolbar')).toBeHidden();
  await expect(page.locator('.capo-hint')).toBeHidden();
  await expect(page.locator('.skip-link')).toBeHidden();
  const firstContentTop = await printDocument.evaluate((element) => element.getBoundingClientRect().top);
  expect(firstContentTop).toBeLessThanOrEqual(12);
  const visibleReaderChildren = await page.locator('.song-reader > *').evaluateAll((elements) => elements
    .filter((element) => getComputedStyle(element).display !== 'none')
    .map((element) => element.className));
  expect(visibleReaderChildren).toEqual(['print-song-document']);
});

test('kapodastr používá křížky a ruční posun akordu uloží potvrzenou lokální polohu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Dotykový editor stačí ověřit v reprezentativním mobilním viewportu.');
  await page.goto('songs/synteticka-jiskra');
  await expect(page.getByRole('heading', { name: 'Syntetická jiskra' })).toBeVisible();

  await page.locator('details.capo-hint > summary').click();
  await expect(page.getByRole('button', { name: 'Začátečník' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.capo-planner')).toContainText('Obtížné hmaty');
  const capoOne = page.getByRole('radio', { name: /1\. pražec F#/ });
  await expect(capoOne).toBeVisible();
  await expect(page.locator('.capo-option-grid')).not.toContainText(/Cis|Dis|Fis|Gis|Ais/);
  await capoOne.click();
  await expect(page.locator('.song-facts')).toContainText('1. pražec');
  await expect(page.getByRole('button', { name: /Akord F#; zobrazit hmat/ }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Ručně posunout akordy' }).click();
  await page.getByRole('button', { name: /Akord F#; upravit polohu/ }).first().click();
  await page.getByRole('button', { name: 'Posunout o jeden znak doprava' }).click();
  await expect(page.getByText('Náhled: akord byl posunut doprava.')).toBeVisible();
  await page.getByRole('button', { name: 'Zavřít', exact: true }).click();
  await page.getByRole('button', { name: '↶ Zpět' }).click();
  await expect(page.getByText('Poslední posun akordu byl vrácen.')).toBeVisible();
  await page.getByRole('button', { name: '↷ Znovu' }).click();
  await expect(page.getByText('Vrácený posun akordu byl znovu použit.')).toBeVisible();
  await page.getByRole('button', { name: 'Uložit úpravy' }).click();
  await expect(page.getByText('Úpravy byly uloženy pouze do tohoto zařízení.')).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole('button', { name: 'Upravit', exact: true }).click();
  await page.getByText('Upravit lokální ChordPro verzi').click();
  await expect(page.getByRole('textbox', { name: 'Text a akordy' })).toHaveValue(/J\[G\]iskra kreslí/);
});

test('úvod obsahuje pouze šest hlavních voleb a knihovna drží hledání uvnitř panelu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Geometrii stačí ověřit jednou pro oba reprezentativní viewporty.');
  for (const viewport of [{ width: 390, height: 844 }, { width: 1300, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await page.goto('./');
    await expect(page.locator('.dashboard-orbits button')).toHaveCount(6);
    await expect(page.locator('.library-sticky-panel')).toHaveCount(0);
    await expect(page.locator('.song-list')).toHaveCount(0);
    await expect(page.locator('.app-header')).toHaveCount(0);
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
    await page.getByRole('button', { name: /^Akordy/ }).click();
    await expect.poll(() => page.locator('html').getAttribute('data-view-transition')).toBeNull();
    const panel = await page.locator('.library-sticky-panel').boundingBox();
    const search = await page.locator('.library-sticky-search').boundingBox();
    expect(panel).not.toBeNull();
    expect(search).not.toBeNull();
    expect(search!.x).toBeGreaterThanOrEqual(panel!.x);
    expect(search!.y).toBeGreaterThanOrEqual(panel!.y);
    expect(search!.x + search!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1);
    expect(search!.y + search!.height).toBeLessThanOrEqual(panel!.y + panel!.height + 1);
    await expectNoPageOverflow(page);
  }
});

test('navigace používá plynulý přechod a respektuje omezení pohybu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Pohybový systém stačí ověřit v reprezentativním mobilním viewportu.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./');
  await page.evaluate(() => {
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
  });
  const transitionFinished = page.evaluate(() => new Promise<{ duration: number; frames: number; blankFrames: number; overlapFrames: number; maxFrameGap: number; longFrameCount: number; scrollRange: number; layoutShiftScore: number; phases: string[] }>((resolve) => {
    let start = 0;
    let previousFrame = 0;
    let started = false;
    let frames = 0;
    let blankFrames = 0;
    let overlapFrames = 0;
    let maxFrameGap = 0;
    let longFrameCount = 0;
    let minScrollY = window.scrollY;
    let maxScrollY = window.scrollY;
    let layoutShiftScore = 0;
    const phases = new Set<string>();
    const layoutShiftObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!shift.hadRecentInput) layoutShiftScore += shift.value ?? 0;
      }
    });
    try { layoutShiftObserver.observe({ type: 'layout-shift' }); } catch { /* starší WebKit metriku nepodporuje */ }
    const sample = () => {
      const active = document.documentElement.dataset.viewTransition === 'active';
      if (!started && !active) {
        requestAnimationFrame(sample);
        return;
      }
      if (!started) {
        started = true;
        start = performance.now();
      }
      const now = performance.now();
      if (previousFrame > 0) {
        const frameGap = now - previousFrame;
        maxFrameGap = Math.max(maxFrameGap, frameGap);
        if (frameGap > 100) longFrameCount += 1;
      }
      previousFrame = now;
      minScrollY = Math.min(minScrollY, window.scrollY);
      maxScrollY = Math.max(maxScrollY, window.scrollY);
      frames += 1;
      const stage = document.querySelector('.route-stage');
      if (!stage || stage.getBoundingClientRect().height < 1) blankFrames += 1;
      if (document.querySelector('.route-transition-snapshot') && stage) overlapFrames += 1;
      const phase = document.documentElement.dataset.transitionPhase;
      if (phase) phases.add(phase);
      if (active) requestAnimationFrame(sample);
      else {
        layoutShiftObserver.disconnect();
        resolve({ duration: performance.now() - start, frames, blankFrames, overlapFrames, maxFrameGap, longFrameCount, scrollRange: maxScrollY - minScrollY, layoutShiftScore, phases: [...phases] });
      }
    };
    requestAnimationFrame(sample);
  }));
  await page.getByRole('button', { name: /^Setlisty/ }).click();
  await expect(page.getByRole('heading', { name: 'Setlisty', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('html').getAttribute('data-view-transition')).toBeNull();
  const transitionMetrics = await transitionFinished;
  expect(transitionMetrics.duration).toBeGreaterThanOrEqual(150);
  expect(transitionMetrics.frames).toBeGreaterThanOrEqual(8);
  expect(transitionMetrics.blankFrames).toBe(0);
  expect(transitionMetrics.overlapFrames).toBe(0);
  // Při plném běhu sdílí CPU pět prohlížečů; samostatný výkonový běh drží limit 1.
  const longFrameBudget = testInfo.config.workers > 1 ? 4 : 1;
  expect(transitionMetrics.longFrameCount).toBeLessThanOrEqual(longFrameBudget);
  expect(transitionMetrics.maxFrameGap).toBeLessThan(180);
  expect(transitionMetrics.scrollRange).toBe(0);
  expect(transitionMetrics.layoutShiftScore).toBeLessThanOrEqual(0.05);
  expect(transitionMetrics.phases).toEqual(expect.arrayContaining(['leaving', 'entering']));
  await expectNoPageOverflow(page);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Písně', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Písně', exact: true, level: 1 })).toBeVisible();
  const reducedDuration = await page.locator('.route-stage').evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration));
  expect(reducedDuration).toBeLessThanOrEqual(0.001);
});

test('vizuální kontrola zachytí mobil, tablet, desktop i landscape bez rozpadu rozložení', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390x844', 'Sada viewportů se pořizuje jen jednou.');
  const viewports = [
    ['iphone-small', 320, 568],
    ['phone', 390, 844],
    ['tablet', 768, 1024],
    ['desktop', 1440, 1000],
    ['landscape', 844, 390],
  ] as const;

  for (const [name, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    for (const route of ['songs', 'songs/synteticka-jiskra'] as const) {
      await page.goto(route);
      await expect(route === 'songs'
        ? page.getByRole('heading', { name: 'Písně', exact: true, level: 1 })
        : page.getByRole('heading', { name: 'Syntetická jiskra' })).toBeVisible();
      await expectNoPageOverflow(page);
      const brokenContainers = await page.locator('.song-card, .reader-performance-surface, .reader-toolbar, .field-actions').evaluateAll((elements) => elements.filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && element.scrollWidth > element.clientWidth + 1;
      }).map((element) => element.className));
      expect(brokenContainers).toEqual([]);
      await testInfo.attach(`${name}-${route.replaceAll('/', '-')}`, {
        body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
        contentType: 'image/png',
      });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['settings', 'offline'] as const) {
    await page.goto(route);
    await expect(page.locator('h1')).toBeVisible();
    await expectNoPageOverflow(page);
    const narrowColumns = await page.locator('.settings-grid > label, .cloud-sync-card > span, .offline-actions article').evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && element.getBoundingClientRect().width < 220;
    }).map((element) => element.className));
    expect(narrowColumns).toEqual([]);
    await testInfo.attach(`phone-${route}`, {
      body: await page.screenshot({ fullPage: true, animations: 'disabled' }),
      contentType: 'image/png',
    });
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
  await page.getByRole('button', { name: /^Akordy/ }).click();
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
