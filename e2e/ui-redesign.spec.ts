import { expect, test, type Page } from '@playwright/test';

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    route: location.pathname,
    nodes: [...document.querySelectorAll('body *')].filter(node => node.getClientRects().length && node.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(-12).map(node => ({ tag: node.tagName, class: node.className, text: node.textContent?.slice(0,50) })),
  }));
  expect(overflow.width, JSON.stringify(overflow)).toBeLessThanOrEqual(1);
}
async function seed(page: Page) {
  await page.goto('./');
  await page.getByLabel('Jméno nebo přezdívka').fill('Zkušební hudebník');
  await page.getByRole('button', { name: 'Vytvořit profil a pokračovat' }).click();
  await page.getByRole('heading', { name: 'Český zpěvník', exact: true }).waitFor();
  const catalog = await (await page.request.get('content/catalog.json')).json();
  await page.evaluate(async template => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('cesky-zpevnik'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction(['state', 'personalSongs', 'personalSongContent'], 'readwrite');
    const titles = ['Cvičení s diakritikou', 'Dlouhý název zkušební písně pro klidný večer u ohně', 'Hudební zkouška', 'Jarní cvičení', 'Krátká sloka', 'Malý refrén', 'Ranní akordy', 'Večerní rytmus'];
    const ids = titles.map((_, index) => 'personal-qa-' + index);
    const r = tx.objectStore('state').get('current');
    r.onsuccess = () => {
      const state = r.result; state.settings.motion = 'off'; state.settings.theme = 'dark';
      state.favorites = [ids[0]]; state.recentSongIds = [ids[0]];
      state.setlists = [{ id: 'qa-setlist', name: 'Večerní zkouška', songIds: ids.slice(0,3), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
      tx.objectStore('state').put(state, 'current');
    };
    titles.forEach((title, index) => {
      const content = ['{title: ' + title + '}', '[Am7] [C] [Am7] [C]', '[Dm] [G]', '', '[H7/F#]Řádek má [Bmaj7]svůj rytmus.', '[C]Tichý tón [G]nese ozvěnu.', '[Am]Zkoušíme [F]další sloku.', ...Array.from({ length: 8 }, () => '[C]Krátký test [G]zní dále.'), '[C]Nejpředlouhatánskézkušebníslovosdiakritikoužščř [G]dozní.', '', '[C]Poslední [G]tón.'].join('\n');
      const song = { ...template, id: ids[index], title, sortTitle: title, authors: ['Testovací autor'], composers: ['Testovací autor'], lyricists: ['Testovací autor'], originalKey: 'Hm', firstLine: 'Řádek má svůj rytmus.', personalOnly: true, chordProPath: 'indexeddb:' + ids[index], sourceIdentifier: 'ui-qa-original-' + index, source: 'Původní syntetický test UI', rightsStatus: 'synthetic', license: 'CC0-1.0', attribution: 'Syntetický test UI', contentBytes: new TextEncoder().encode(content).length, scoreAssets: [], reviewFlags: [] };
      delete song.contentSha256;
      tx.objectStore('personalSongs').put(song, song.id);
      tx.objectStore('personalSongContent').put(content, song.id);
    });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  }, catalog.songs[0]);
  await page.reload();
}

test('redesign: hustota knihovny, řádky čtečky, dialogy a zachovaný návrat', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page);
  await page.goto('songs');
  await expect(page.locator('.song-card__open')).toHaveCount(9);
  await noOverflow(page);
  const geometry = await page.locator('.song-card-shell').evaluateAll(rows => {
    const nav = document.querySelector('.bottom-nav')!.getBoundingClientRect();
    return { top: rows[0].getBoundingClientRect().top, visible: rows.filter(row => row.getBoundingClientRect().top >= 0 && row.getBoundingClientRect().bottom <= nav.top).length };
  });
  if (info.project.name === 'mobile-390x844') { expect(geometry.top).toBeLessThanOrEqual(300); expect(geometry.visible).toBeGreaterThanOrEqual(5); }
  await page.screenshot({ path: 'docs/ui-redesign/screenshots/after-library-' + info.project.name + '.png' });
  await page.locator('.search-field input').fill('Cvičení');
  await expect(page.locator('.song-card__open')).toHaveCount(2);
  await page.locator('.song-card__open').first().click();
  await expect(page.locator('.chord-sheet')).toBeVisible();
  await noOverflow(page);
  const lyrics = await page.locator('.chord-line--with-chords:not(.chord-line--instrumental)').evaluateAll(lines => {
    const nav = document.querySelector('.bottom-nav')!.getBoundingClientRect();
    return lines.filter(line => line.getBoundingClientRect().bottom <= nav.top).length;
  });
  if (info.project.name === 'mobile-390x844') expect(lyrics).toBeGreaterThanOrEqual(3);
  console.info('Redesign layout:', info.project.name, JSON.stringify({ firstSongTop: geometry.top, fullyVisibleSongs: geometry.visible, visibleLyricLines: lyrics }));
  const intros = page.locator('.chord-line--instrumental');
  await expect(intros).toHaveCount(2);
  await expect(intros.first().locator('button')).toHaveCount(4);
  if ((page.viewportSize()?.width ?? 0) >= 390) {
    const positions = await intros.first().locator('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
  }
  await page.screenshot({ path: 'docs/ui-redesign/screenshots/after-reader-' + info.project.name + '.png' });
  const chord = page.getByRole('button', { name: 'Akord H7/F#; zobrazit hmat', exact: true });
  await chord.click();
  await expect(page.getByRole('dialog', { name: 'Hmat akordu H7/F#' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chord).toBeFocused();
  await page.getByRole('button', { name: 'Zpět do seznamu', exact: true }).click();
  await expect(page.locator('.search-field input')).toHaveValue('Cvičení');
  await page.getByRole('button', { name: /^Filtry/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Filtry a zobrazení' });
  await expect(dialog).toBeVisible();
  for (let index=0; index<24; index++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Filtry/ })).toBeFocused();
  expect(errors).toEqual([]);
});

test('redesign: 320 px, 200% text, poslední obsah a zmenšený viewport', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-320x568', 'Samostatné ověření nejmenší šířky.');
  await seed(page);
  await page.evaluate(() => document.documentElement.style.fontSize = '32px');
  for (const [path, ready] of [['','.home-shortcuts'], ['songs','.song-card__open'], ['songs/personal-qa-1','.chord-sheet'], ['setlists','.setlists-page'], ['offline','.offline-readiness'], ['more','.more-page'], ['settings','.settings-page']]) {
    // Client navigation preserves text enlargement and uses the real route/history handler.
    await page.evaluate(path => { history.pushState({}, '', '/Zpevnik/' + path); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
    await page.locator(ready).first().waitFor();
    await noOverflow(page);
    await page.screenshot({ path: 'docs/ui-redesign/screenshots/after-text-200-' + (path || 'home').replaceAll('/','-') + '-320x568.png', fullPage: true });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const hidden = await page.locator('.app-main').evaluate(main => {
      const nav = document.querySelector('.bottom-nav')!.getBoundingClientRect();
      const children = [...main.querySelectorAll('button, p, input, summary')].filter(node => node.getClientRects().length && !node.closest('dialog') && !node.closest('details:not([open])'));
      const last = children.at(-1)?.getBoundingClientRect();
      return Boolean(last && last.bottom > nav.top + 1);
    });
    expect(hidden, path + ': poslední obsah').toBe(false);
  }
  await page.setViewportSize({ width: 320, height: 360 });
  await noOverflow(page);
});
