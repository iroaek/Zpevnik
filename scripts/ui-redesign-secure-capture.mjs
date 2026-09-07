/* global console, process, document, URL, navigator, indexedDB, fetch */
import { chromium } from '@playwright/test';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { build, preview } from 'vite';
import { Buffer } from 'node:buffer';

// Test-only boundary responses. No real account, server or secret is used.
process.env.VITE_REQUIRE_SECURE_ACCESS = 'true';
process.env.VITE_NEON_AUTH_URL = 'https://auth.example.test';
process.env.VITE_NEON_DATA_API_URL = 'https://data.example.test';
process.env.VITE_PUBLIC_BASE_URL = 'http://127.0.0.1:4175/Zpevnik/';
const output = 'docs/ui-redesign/screenshots';
await mkdir(output, { recursive: true });
const profile = { id: '11111111-1111-4111-8111-111111111111', auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'spravce@example.test', display_name: 'Zkušební správce', status: 'approved', role: 'admin', created_at: '2026-09-01T09:00:00.000Z', reviewed_at: '2026-09-01T10:00:00.000Z', last_seen_at: new Date().toISOString() };
const pending = { ...profile, id: '22222222-2222-4222-8222-222222222222', auth_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'clen@example.test', display_name: 'Zkušební člen', status: 'pending', role: 'member', reviewed_at: null, last_seen_at: null };
const pair = generateKeyPairSync('ed25519'); const kid = 'local-visual-qa';
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' };
const now = Math.floor(Date.now() / 1000);
const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ iss: 'https://auth.example.test', aud: 'https://auth.example.test', sub: profile.auth_user_id, email: profile.email, emailVerified: true, role: profile.role, banned: false, iat: now, exp: now + 3600 })).toString('base64url');
const jwt = head + '.' + payload + '.' + sign(null, Buffer.from(head + '.' + payload), pair.privateKey).toString('base64url');
const user = { id: profile.auth_user_id, email: profile.email, name: profile.display_name, emailVerified: true, role: 'admin', createdAt: profile.created_at, updatedAt: profile.created_at };
const session = { session: { id: 'qa-session', token: jwt, userId: user.id, expiresAt: new Date((now + 3600) * 1000).toISOString() }, user };
const browser = await chromium.launch();
for (const phase of process.argv.includes('--after-only') ? ['after'] : ['before', 'after']) {
  const originals = new Map();
  if (phase === 'before') {
    const files = execFileSync('git', ['diff', '--name-only', '--', 'src'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(file => /\.(tsx?|css)$/.test(file) && !/\.test\./.test(file));
    for (const file of files) originals.set(path.resolve(file).replaceAll('\\', '/'), execFileSync('git', ['show', 'HEAD:' + file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  }
  const outDir = 'tmp/ui-redesign-secure-' + phase;
  await build({ mode: 'ui-qa', build: { outDir }, plugins: [{ name: 'local-original-ui-snapshot', enforce: 'pre', load(id) { return originals.get(id.split('?')[0].replaceAll('\\', '/')); } }] });
  const server = await preview({ mode: 'ui-qa', build: { outDir }, preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: phase === 'after' ? 'allow' : 'block' });
  let authenticated = false;
  let networkOffline = false;
  let packageRow = null; let packageChunk = null;
  const requests = [];
  await context.route('**/*', async route => {
    if (networkOffline) return route.abort('internetdisconnected');
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/__personal_library/')) return route.fulfill({ status: 404, body: '' });
    if (url.hostname === 'auth.example.test' || url.hostname === 'data.example.test') {
      requests.push(route.request().method() + ' ' + url.pathname);
      const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4175', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'set-auth-jwt', 'content-type': 'application/json' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      let body;
      if (url.hostname === 'auth.example.test') {
        if (url.pathname.endsWith('/get-session')) body = authenticated ? session : null;
        else if (url.pathname.endsWith('/jwks.json')) body = { keys: [jwk] };
        else if (url.pathname.endsWith('/sign-in/email')) { authenticated = true; body = { user, token: jwt, redirect: false }; headers['set-auth-jwt'] = jwt; }
        else if (url.pathname.endsWith('/token')) body = { token: jwt };
        else body = { success: true };
      } else {
        const resource = url.pathname.split('/').pop();
        if (resource === 'profiles') body = url.searchParams.has('auth_user_id') ? [profile] : url.searchParams.get('status') === 'eq.pending' ? [pending] : [profile, pending];
        else if (resource === 'content_packages') body = packageRow ? [packageRow] : [];
        else if (resource === 'content_package_chunks') body = packageChunk ? [packageChunk] : [];
        else if (url.pathname.includes('/rpc/')) body = resource === 'register_my_device' ? true : null;
        else body = [];
      }
      return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
    }
    if (url.hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => { pageErrors.push(error.message); console.log(phase + ' page error: ' + error.message); });
  await page.goto('http://127.0.0.1:4175/Zpevnik/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Přihlášení', exact: true }).waitFor({ timeout: 20000 }).catch(async error => { console.log('BODY', await page.locator('body').innerText(), 'REQUESTS', requests); await page.screenshot({ path: 'tmp/secure-failure.png', fullPage: true }); throw error; });
  await page.screenshot({ path: output + '/' + phase + '-login-390x844.png', fullPage: true });
  if (phase === 'after') {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => document.documentElement.style.fontSize = '32px');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: output + '/after-login-text-200-320x568.png', fullPage: true });
    if (overflow > 1) throw new Error('Login 200% overflow: ' + overflow);
    await page.setViewportSize({ width: 320, height: 360 });
    await page.getByRole('button', { name: 'Přihlásit se', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: output + '/after-login-small-viewport-320x360.png' });
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.getByLabel('E-mail', { exact: true }).fill(profile.email);
  await page.getByLabel('Heslo', { exact: true }).fill('Only-local-test-2468');
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
  await page.getByRole('heading', { name: 'Český zpěvník', exact: true }).waitFor({ timeout: 30000 });
  await page.goto('http://127.0.0.1:4175/Zpevnik/admin');
  await page.getByRole('heading', { name: 'Přehled administrace' }).waitFor();
  await page.getByRole('button', { name: /Registrovaní/ }).waitFor();
  const guide = page.getByRole('button', { name: 'Přeskočit', exact: true });
  if (await guide.isVisible()) await guide.click();
  await page.screenshot({ path: output + '/' + phase + '-admin-390x844.png', fullPage: true });
  if (phase === 'after') {
    for (const [width, height] of [[320,568],[360,800],[430,932],[844,390],[768,1024],[1440,900]]) {
      await page.setViewportSize({ width, height });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) throw new Error('Admin overflow ' + width + ': ' + overflow);
      await page.screenshot({ path: output + '/after-admin-' + width + 'x' + height + '.png', fullPage: true });
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => document.documentElement.style.fontSize = '32px');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error('Admin 200% overflow: ' + overflow);
    const columns = await page.locator('.admin-kpi-grid > button').evaluateAll(buttons => new Set(buttons.map(button => button.getBoundingClientRect().left)).size);
    if (columns !== 1) throw new Error('Admin 200% must reflow statistics into one column');
    await page.screenshot({ path: output + '/after-admin-text-200-320x568.png', fullPage: true });
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  }
  console.log(phase + ' secure UI captured; endpoints: ' + [...new Set(requests)].join(', '));

  if (phase === 'after') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const state = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('cesky-zpevnik'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const value = await new Promise((resolve, reject) => { const r = db.transaction('state').objectStore('state').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); db.close(); return value;
    });
    const template = JSON.parse(await readFile('src/generated/catalog.json', 'utf8')).songs[0];
    const content = '{title: Členské cvičení}\n[G]Krátký test [D]zní dál.\n[C]Tichý tón [G]dozní.';
    const memberSong = { ...template, id: 'personal-qa-member', title: 'Členské cvičení', sortTitle: 'Členské cvičení', authors: ['Testovací autor'], personalOnly: true, chordProPath: 'indexeddb:personal-qa-member', sourceIdentifier: 'songs_data/ui-qa-original.txt', source: 'Syntetický test UI', rightsStatus: 'synthetic', attribution: 'Syntetický test UI', contentBytes: Buffer.byteLength(content), scoreAssets: [] };
    delete memberSong.contentSha256;
    const manifest = { schemaVersion: 1, scope: 'admin', version: createHash('sha256').update(content).digest('hex'), generatedAt: new Date().toISOString(), songCount: 1, contentBytes: Buffer.byteLength(content) };
    const bytes = Buffer.from(JSON.stringify({ application: 'cesky-digitalni-zpevnik', data: state, personalSongs: [{ song: memberSong, content }], libraryScope: 'admin', libraryManifest: manifest }));
    const hash = createHash('sha256').update(bytes).digest('hex');
    packageRow = { scope: 'admin', version: manifest.version, manifest, package_bytes: bytes.length, chunk_count: 1, sha256: hash };
    packageChunk = { chunk_index: 0, byte_size: bytes.length, sha256: hash, data_base64: bytes.toString('base64') };
    await page.goto('http://127.0.0.1:4175/Zpevnik/offline');
    await page.getByRole('heading', { name: 'Offline příprava není dokončena' }).waitFor();
    await page.screenshot({ path: output + '/after-offline-member-incomplete-390x844.png', fullPage: true });
    await page.getByRole('button', { name: 'Stáhnout písně', exact: true }).click();
    await page.getByRole('heading', { name: 'Připraveno bez internetu' }).waitFor({ timeout: 20000 });
    await page.screenshot({ path: output + '/after-offline-member-ready-390x844.png', fullPage: true });
    await page.goto('http://127.0.0.1:4175/Zpevnik/songs/personal-qa-member');
    await page.locator('.chord-sheet').waitFor();
    await page.getByRole('button', { name: 'Přidat do oblíbených', exact: true }).click();
    await page.goto('http://127.0.0.1:4175/Zpevnik/setlists');
    await page.locator('.new-setlist-details').waitFor();
    const form = page.getByLabel('Název nového setlistu');
    if (!await form.isVisible()) await page.getByText('Nový setlist', { exact: true }).click();
    await form.fill('Offline zkouška');
    await page.getByRole('button', { name: 'Vytvořit', exact: true }).click();
    await page.getByRole('tab', { name: /Offline zkouška/ }).waitFor();
    networkOffline = true;
    await context.setOffline(true);
    await page.close();
    const cold = await context.newPage();
    cold.on('pageerror', error => pageErrors.push(error.message));
    await cold.goto('http://127.0.0.1:4175/Zpevnik/songs/personal-qa-member');
    await cold.locator('.chord-sheet').waitFor({ timeout: 20000 });
    // navigator.onLine may remain true on a new SW-controlled Chromium target;
    // prove disconnection with a failed uncached request and the offline-auth UI.
    console.log('Cold-start navigator.onLine:', await cold.evaluate(() => navigator.onLine));
    const networkBlocked = await cold.evaluate(async () => { try { await fetch('/Zpevnik/offline-network-probe', { cache: 'no-store' }); return false; } catch { return true; } });
    if (!networkBlocked) throw new Error('An uncached network request must fail during cold start');
    await cold.locator('.offline-auth-banner').getByText('Offline režim', { exact: true }).waitFor();
    await cold.getByRole('button', { name: 'Odebrat z oblíbených', exact: true }).waitFor();
    await cold.getByRole('button', { name: 'Zvýšit o půltón' }).click();
    if (await cold.getByLabel('Posun v půltónech').innerText() !== '+1') throw new Error('Cold start transposition failed');
    await cold.screenshot({ path: output + '/after-member-cold-start-390x844.png', fullPage: true });
    await cold.goto('http://127.0.0.1:4175/Zpevnik/setlists');
    await cold.getByRole('tab', { name: /Offline zkouška/ }).waitFor();
    await cold.locator('.new-setlist-details').waitFor();
    if (!await cold.getByLabel('Název nového setlistu').isVisible()) await cold.getByText('Nový setlist', { exact: true }).click();
    await cold.getByLabel('Název nového setlistu').fill('Seznam vytvořený offline');
    await cold.getByRole('button', { name: 'Vytvořit', exact: true }).click();
    await cold.getByRole('tab', { name: /Seznam vytvořený offline/ }).waitFor();
    networkOffline = false;
    await context.setOffline(false);
    await cold.reload();
    await cold.getByRole('tab', { name: /Offline zkouška/ }).waitFor();
    await cold.getByRole('tab', { name: /Seznam vytvořený offline/ }).waitFor();
    if (pageErrors.length) throw new Error('Secure UI console errors: ' + pageErrors.join(', '));
    console.log('PASS: signed Neon session fixture, verified private package, offline NEW TAB, transposition, favorite, setlist, reconnect. No production auth tested.');
  }

  await context.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
await browser.close();
