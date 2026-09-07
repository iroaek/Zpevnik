// Local visual QA only. Uses the real application and a separate browser profile.
/* global process, console, indexedDB, navigator */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const phase = process.argv[2] || 'after';
const base = 'http://127.0.0.1:4173/Zpevnik/';
const output = 'docs/ui-redesign/screenshots';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
const page = await context.newPage();
await page.goto(base);
await page.getByLabel('Jméno nebo přezdívka').fill('Zkušební hudebník');
await page.getByRole('button', { name: 'Vytvořit profil a pokračovat' }).click();
await page.getByRole('heading', { name: 'Český zpěvník', exact: true }).waitFor();
const catalog = await (await context.request.get(`${base}content/catalog.json`)).json();
const song = catalog.songs[0];
await page.evaluate(async ({ id }) => {
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open('cesky-zpevnik'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const tx = db.transaction('state', 'readwrite');
  const store = tx.objectStore('state');
  const request = store.get('current');
  request.onsuccess = () => { const state = request.result; state.recentSongIds = [id]; state.favorites = [id]; state.settings.theme = 'dark'; state.settings.motion = 'off'; state.setlists = [{ id: 'qa-setlist', name: 'Večerní zkouška', songIds: [id], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]; store.put(state, 'current'); };
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; }); db.close();
}, { id: song.id });
await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
await page.reload();
await page.goto(base + 'offline');
await page.getByRole('heading', { name: 'Offline příprava není dokončena' }).waitFor();
await page.screenshot({ path: output + '/' + phase + '-offline-incomplete-390x844.png', fullPage: true });
for (const [name, path, ready] of [['home', '', 'h1'], ['library', 'songs', '.song-card'], ['song', `songs/${song.id}`, '.chord-sheet'], ['setlists', 'setlists', '.setlists-page']]) {
  await page.goto(base + path);
  await page.locator(ready).first().waitFor();
  await page.screenshot({ path: `${output}/${phase}-${name}-390x844.png`, fullPage: true });
  console.log(`${phase}: ${name}`);
}
await page.goto(base + 'offline');
await page.getByRole('heading', { name: /^(Připraveno bez internetu|Offline příprava není dokončena)$/ }).waitFor();
const download = page.getByRole('button', { name: 'Stáhnout písně', exact: true });
if (await download.isVisible()) await download.click();
await page.getByRole('heading', { name: 'Připraveno bez internetu' }).waitFor();
await page.reload();
await page.getByRole('heading', { name: 'Připraveno bez internetu' }).waitFor();
await page.screenshot({ path: `${output}/${phase}-offline-ready-390x844.png`, fullPage: true });
await browser.close();
