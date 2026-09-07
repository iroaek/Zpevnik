/* global console, process, navigator, indexedDB, fetch, URL, setTimeout, caches */
// Dedicated synthetic HTTP auth/data service + REAL production client and PWA.
// Offline phases have neither route fulfilment nor an online server.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { build, preview } from 'vite';

const phase = process.argv.includes('--before') ? 'before' : 'after';
const buildId = phase === 'before' ? 'offline-old' : 'offline-new';
const root = path.resolve('tmp/offline-fix');
const evidence = path.resolve('docs/offline-fix');
await mkdir(root, { recursive: true }); await mkdir(evidence, { recursive: true });
const appOrigin = 'http://127.0.0.1:4187';
const authOrigin = 'http://127.0.0.1:4186';
const appUrl = `${appOrigin}/Zpevnik/`;
const profileDirectory = phase === 'before' ? path.join(root, `persistent-profile-${Date.now()}`) : (await readFile(path.join(root, 'profile-path.txt'), 'utf8')).trim();
if (phase === 'before') await writeFile(path.join(root, 'profile-path.txt'), profileDirectory);
const logs = [];
const results = [];
const offlineSetlistName = `Offline zkouška ${new Date().toISOString().slice(11, 19)}`;
const record = (step, details = {}) => { const entry = { phase, at: new Date().toISOString(), build: buildId, step, ...details }; logs.push(entry); console.log(JSON.stringify(entry)); };
const profile = { id: '11111111-1111-4111-8111-111111111111', auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'offline@example.test', display_name: 'Testovací člen', status: 'approved', role: 'member', created_at: '2026-09-01T09:00:00.000Z', reviewed_at: '2026-09-01T10:00:00.000Z', last_seen_at: null };
let privateKey;
try { privateKey = createPrivateKey(await readFile(path.join(root, 'test-only-key.pem'))); }
catch { privateKey = generateKeyPairSync('ed25519').privateKey; await writeFile(path.join(root, 'test-only-key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' })); }
const publicKey = createPublicKey(privateKey);
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-offline-key', alg: 'EdDSA', use: 'sig' };
const opaqueSession = 'synthetic-opaque-session-offline-fix';
let packageRow = null, packageChunk = null, cloudState = null;
let accountStatus = 'approved', jwtRole = 'user', apiFailure = 0, deviceRevoked = false;
let offlineNetwork = false;
const user = () => ({ id: profile.auth_user_id, email: profile.email, name: profile.display_name, emailVerified: true, role: jwtRole, createdAt: profile.created_at, updatedAt: profile.created_at });
function token(role = jwtRole) {
  const iat = Math.floor(Date.now() / 1000);
  const input = [ { alg: 'EdDSA', typ: 'JWT', kid: jwk.kid }, { iss: authOrigin, aud: authOrigin, sub: profile.auth_user_id, email: profile.email, emailVerified: true, role, banned: false, iat, exp: iat + 12 } ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}
function authorized(request) {
  try {
    const value = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const parts = value.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return verify(null, Buffer.from(parts.slice(0, 2).join('.')), publicKey, Buffer.from(parts[2], 'base64url')) && claims.exp > Date.now() / 1000 && claims.sub === profile.auth_user_id;
  } catch { return false; }
}
const backend = createServer(async (request, response) => {
  const url = new URL(request.url, authOrigin);
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': appOrigin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': request.headers['access-control-request-headers'] ?? '*', 'access-control-expose-headers': 'set-auth-jwt', 'cache-control': 'no-store' };
  const send = (status, body, extra = {}) => { response.writeHead(status, { ...headers, ...extra }); response.end(status === 204 ? '' : JSON.stringify(body)); if (request.method !== 'OPTIONS') record('http', { endpoint: url.pathname, status }); };
  if (offlineNetwork) { response.destroy(); return; }
  if (request.method === 'OPTIONS') return send(204, null);
  let input = ''; for await (const chunk of request) input += chunk;
  const body = input ? JSON.parse(input) : {};
  if (url.pathname.startsWith('/auth/')) {
    if (url.pathname.endsWith('/.well-known/jwks.json')) return send(200, { keys: [jwk] });
    if (url.pathname.endsWith('/sign-in/email') || url.pathname.endsWith('/sign-in/email-otp')) {
      if (body.email !== profile.email || (body.password !== undefined ? body.password !== 'Synthetic-password-2468' : body.otp !== '123456')) return send(401, { code: 'INVALID_CREDENTIALS' });
      jwtRole = 'user';
      return send(200, { token: opaqueSession, user: user(), redirect: false }, { 'set-auth-jwt': token(), 'set-cookie': `test_session=${opaqueSession}; HttpOnly; Path=/; SameSite=Lax` });
    }
    if (url.pathname.endsWith('/get-session')) {
      const hasSession = request.headers.cookie?.includes(`test_session=${opaqueSession}`) || request.headers.authorization === `Bearer ${opaqueSession}`;
      return send(200, hasSession ? { user: user(), session: { id: 'synthetic-session', token: opaqueSession, userId: profile.auth_user_id, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() } } : null, hasSession ? { 'set-auth-jwt': token() } : {});
    }
    if (url.pathname.endsWith('/token')) {
      if (apiFailure) return send(apiFailure, { code: 'synthetic_temporarily_unavailable' });
      if (request.headers.authorization !== `Bearer ${opaqueSession}` && !request.headers.cookie?.includes(`test_session=${opaqueSession}`)) return send(401, { code: 'session_not_found' });
      return send(200, { token: token() });
    }
    if (url.pathname.endsWith('/sign-out')) return send(200, { success: true }, { 'set-cookie': 'test_session=; Max-Age=0; Path=/' });
    if (url.pathname.endsWith('/email-otp/reset-password') && (body.otp !== '654321' || body.password !== 'Synthetic-password-2468')) return send(400, { code: 'INVALID_OTP' });
    return send(200, { success: true });
  }
  if (!authorized(request)) return send(401, { code: 'expired_or_missing_jwt' });
  if (apiFailure) return send(apiFailure, { code: 'synthetic_api_failure' });
  const resource = url.pathname.split('/').pop();
  if (resource === 'ensure_my_profile') { jwtRole = accountStatus === 'approved' ? profile.role : accountStatus; return send(200, { ...profile, status: accountStatus }); }
  if (resource === 'profiles') return send(200, [{ ...profile, status: accountStatus }]);
  if (accountStatus !== 'approved') return send(403, { code: 'not_approved' });
  if (resource === 'register_my_device') return send(200, !deviceRevoked);
  if (resource === 'content_packages') return send(200, packageRow ? [packageRow] : []);
  if (resource === 'content_package_chunks') return send(200, packageChunk ? [packageChunk] : []);
  if (resource === 'user_app_state') { if (request.method === 'POST') cloudState = body.state; return send(request.method === 'POST' ? 204 : 200, cloudState ? [{ state: cloudState }] : []); }
  return send(200, url.pathname.includes('/rpc/') ? null : []);
});
await new Promise(resolve => backend.listen(4186, '127.0.0.1', resolve));
Object.assign(process.env, { VITE_REQUIRE_SECURE_ACCESS: 'true', VITE_NEON_AUTH_URL: `${authOrigin}/auth`, VITE_NEON_DATA_API_URL: `${authOrigin}/rest/v1`, VITE_PUBLIC_BASE_URL: appUrl, VITE_BUILD_ID: buildId });
const outDir = path.join(root, `${phase}-dist`);
let hosting, context;
async function dbRead(page, store, key) {
  return page.evaluate(async ({ store, key }) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('cesky-zpevnik'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await new Promise((resolve, reject) => { const r = key === null ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); } finally { db.close(); }
  }, { store, key });
}
async function durableSnapshot(page) {
  const version = await page.evaluate(() => new Promise((resolve, reject) => { const r = indexedDB.open('cesky-zpevnik'); r.onsuccess = () => { resolve(r.result.version); r.result.close(); }; r.onerror = () => reject(r.error); }));
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { version, deviceHash: hash(await dbRead(page, 'metadata', 'deviceId')), contentHash: hash(await dbRead(page, 'personalSongContent', null)), contentRecords: (await dbRead(page, 'personalSongContent', null)).length };
}
async function preparePackage(page) {
  const state = await dbRead(page, 'state', 'current');
  const template = JSON.parse(await readFile('src/generated/catalog.json', 'utf8')).songs[0];
  const entries = [1, 2].map(index => {
    const content = `{title: Offline cvičení ${index}}\n[H7/F#]Krátký test [Bmaj7]zní.\n[C]Tichý tón [G]dozní.`;
    const song = { ...template, id: `personal-offline-${index}`, title: `Offline cvičení ${index}`, sortTitle: `Offline cvičení ${index}`, authors: ['Syntetický autor'], firstLine: 'Krátký test zní.', personalOnly: true, chordProPath: `indexeddb:personal-offline-${index}`, sourceIdentifier: `songs_data/offline-fixture-${index}.txt`, source: 'Syntetický test offline', rightsStatus: 'synthetic', license: 'CC0-1.0', attribution: 'Syntetický test offline', contentBytes: Buffer.byteLength(content), scoreAssets: [] };
    delete song.contentSha256; return { song, content };
  });
  const manifest = { schemaVersion: 1, scope: 'members', version: createHash('sha256').update('offline-fixture-v1').digest('hex'), generatedAt: profile.created_at, songCount: 2, contentBytes: entries.reduce((n, entry) => n + entry.song.contentBytes, 0) };
  const bytes = Buffer.from(JSON.stringify({ application: 'cesky-digitalni-zpevnik', data: state, personalSongs: entries, libraryScope: 'members', libraryManifest: manifest }));
  const hash = createHash('sha256').update(bytes).digest('hex');
  packageRow = { scope: 'members', version: manifest.version, manifest, package_bytes: bytes.length, chunk_count: 1, sha256: hash };
  packageChunk = { chunk_index: 0, byte_size: bytes.length, sha256: hash, data_base64: bytes.toString('base64') };
}
async function launch(offline = false, directory = profileDirectory) {
  const value = await chromium.launchPersistentContext(directory, { headless: true, viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', offline, reducedMotion: 'reduce' });
  value.setDefaultTimeout(20000);
  record('browser_process_started', { offline, preservedProfile: directory === profileDirectory });
  return value;
}
async function dismissGuide(page) { const skip = page.getByRole('button', { name: 'Přeskočit', exact: true }); if (await skip.isVisible()) await skip.click(); }
async function login(page, otp = false) {
  await page.getByRole('heading', { name: 'Přihlášení', exact: true }).waitFor();
  if (otp) await page.getByRole('button', { name: 'Přihlásit se kódem', exact: true }).click();
  await page.getByLabel('E-mail', { exact: true }).fill(profile.email);
  if (otp) {
    await page.getByRole('button', { name: 'Poslat přihlašovací kód' }).click();
    await page.getByLabel('Šestimístný kód').fill('123456'); await page.getByRole('button', { name: 'Ověřit kód', exact: true }).click();
    await page.getByLabel('Kód pro nastavení hesla').fill('654321');
    await page.getByLabel('Nové heslo', { exact: true }).fill('Synthetic-password-2468');
    await page.getByLabel('Nové heslo znovu', { exact: true }).fill('Synthetic-password-2468');
    await page.getByRole('button', { name: 'Uložit nové heslo' }).click();
  } else {
    await page.getByLabel('Heslo', { exact: true }).fill('Synthetic-password-2468'); await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click();
  }
  await page.getByRole('heading', { name: accountStatus === 'approved' ? 'Český zpěvník' : 'Účet čeká na schválení', exact: true }).waitFor({ timeout: 25000 }); await dismissGuide(page);
}
async function exerciseLoginBranches() {
  for (const otp of [false, true]) {
    const loginContext = await launch(false, path.join(root, `login-${otp ? 'otp' : 'password'}-${Date.now()}`));
    try {
      const loginPage = loginContext.pages()[0]; await loginPage.goto(appUrl, { waitUntil: 'domcontentloaded' });
      await login(loginPage, otp);
      const saved = await dbRead(loginPage, 'offlineAuth', 'current');
      expect(saved.payload.subject).toBe(profile.id);
      expect(await dbRead(loginPage, 'account', 'neonSession')).toBeTruthy();
      results.push({ test: otp ? 'OTP + required password setup' : 'password login', result: 'PASS' });
      record('login_verified', { branch: otp ? 'otp-and-password-setup' : 'password', grantPersisted: true });
    } finally { await loginContext.close(); }
  }
  accountStatus = 'pending';
  const pendingContext = await launch(false, path.join(root, `pending-${Date.now()}`));
  try {
    const pendingPage = pendingContext.pages()[0]; await pendingPage.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await login(pendingPage);
    expect(await dbRead(pendingPage, 'offlineAuth', 'current')).toBeUndefined();
    expect((await dbRead(pendingPage, 'personalSongContent', null)).length).toBe(0);
    results.push({ test: 'pending account denied grant and songs', result: 'PASS' });
    accountStatus = 'approved';
    await pendingPage.getByRole('button', { name: 'Zkontrolovat schválení' }).click();
    await pendingPage.getByRole('heading', { name: 'Český zpěvník', exact: true }).waitFor();
    expect((await dbRead(pendingPage, 'offlineAuth', 'current')).payload.subject).toBe(profile.id);
    results.push({ test: 'new approval in existing session issues grant', result: 'PASS' });
  } finally { accountStatus = 'approved'; await pendingContext.close(); }
}
async function networkProof(page) {
  const start = logs.filter(item => item.step === 'http').length;
  const blocked = await page.evaluate(async () => { try { await fetch('/Zpevnik/offline-network-probe', { cache: 'no-store' }); return false; } catch { return true; } });
  expect(blocked).toBe(true);
  expect(logs.filter(item => item.step === 'http').length).toBe(start);
  record('network_proof', { uncachedFetchFailed: blocked, backendAcceptingRequests: false });
}
try {
  if (!process.argv.includes('--skip-build')) {
    let baseline = {};
    if (phase === 'before') {
      // Reproducible old build without modifying the working tree or checking
      // out the user's files. Only local git objects are read.
      const reference = 'd53ed1d';
      const configFile = path.join(root, 'vite-before.config.mts');
      const config = execFileSync('git', ['show', `${reference}:vite.config.ts`], { encoding: 'utf8' }).replaceAll("'./scripts/", "'../../scripts/");
      await writeFile(configFile, config);
      const originals = new Map();
      for (const file of execFileSync('git', ['ls-tree', '-r', '--name-only', reference, 'src'], { encoding: 'utf8' }).trim().split(/\r?\n/)) {
        if (/\.(tsx?|css|json)$/.test(file) && !file.includes('.test.')) originals.set(path.resolve(file).replaceAll('\\', '/'), execFileSync('git', ['show', `${reference}:${file}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
      }
      baseline = { configFile, plugins: [{ name: 'offline-original-source', enforce: 'pre', load(id) { return originals.get(id.split('?')[0].replaceAll('\\', '/')); } }] };
    }
    await build({ ...baseline, mode: 'production', build: { outDir } });
  }
  hosting = await preview({ mode: 'production', build: { outDir }, preview: { host: '127.0.0.1', port: 4187, strictPort: true } });
  context = await launch();
  let page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', error => record('page_error', { code: error.name, message: error.message.slice(0, 300) }));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  if (phase === 'before') {
    if (!await page.getByRole('heading', { name: 'Přihlášení', exact: true }).isVisible()) {
      await context.clearCookies(); await page.reload();
    }
    await login(page);
  }
  else await page.getByRole('heading', { name: 'Český zpěvník', exact: true }).waitFor({ timeout: 25000 });
  await preparePackage(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.getByRole('navigation', { name: 'Hlavní navigace' }).getByRole('button', { name: 'Offline', exact: true }).click(); await dismissGuide(page);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  if (phase === 'before') {
    await page.getByText('Správa obsahu a zařízení', { exact: true }).click();
    await page.getByRole('button', { name: /^(Stáhnout knihovnu|Nainstalovat novou knihovnu)$/ }).click();
    await expect(page.getByLabel('Splněné podmínky')).toHaveText('2/3', { timeout: 20000 });
    expect(await dbRead(page, 'offlineAuth', 'current')).toBeUndefined();
    expect((await dbRead(page, 'personalSongContent', null)).length).toBe(2);
    const baseline = await durableSnapshot(page);
    expect(baseline.version).toBe(9);
    await writeFile(path.join(root, 'profile-baseline.json'), JSON.stringify(baseline));
    record('preserved_installation_baseline', baseline);
    await page.screenshot({ path: path.join(evidence, 'before-2-of-3.png'), fullPage: true });
    record('reproduced', { code: 'signed_role_stale_after_ensure_my_profile', grantStored: false, contentRecords: 2, readiness: '2/3' });
    results.push({ test: 'baseline real production client, stale signed role', result: 'REPRODUCED' });
  } else {
    // Install the changed worker over the original preserved profile.
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration(); await r?.update();
      if (r?.installing) await new Promise(resolve => { const worker = r.installing; worker.addEventListener('statechange', () => { if (worker.state === 'installed' || worker.state === 'redundant') resolve(); }); });
      if (r?.waiting) await new Promise(resolve => { navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }); r.waiting.postMessage({ type: 'SKIP_WAITING' }); });
    });
    const previousShell = JSON.parse(await readFile(path.join(root, 'before-dist/app-shell.json'), 'utf8'));
    const previousReader = previousShell.resources.find(item => /assets\/SongReader-.*\.js$/.test(item.path));
    await context.setOffline(true);
    const oldChunk = await page.request.get(`${appUrl}${previousReader.path}`).catch(() => null);
    // Browser fetch, unlike Playwright's independent API client, uses the worker.
    const retained = await page.evaluate(async url => { const r = await fetch(url, { cache: 'no-store' }); return { ok: r.ok, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength }; }, `${appUrl}${previousReader.path}`);
    expect(retained.ok).toBe(true); expect(retained.type).toMatch(/javascript/); expect(retained.bytes).toBeGreaterThan(1000);
    // The old file is absent from the new hosting directory.
    expect(oldChunk === null || oldChunk.status() === 404 || oldChunk.headers()['content-type']?.includes('text/html')).toBe(true);
    record('previous_lazy_chunk_available_offline', { path: previousReader.path, bytes: retained.bytes });
    await context.setOffline(false);
    await page.reload({ waitUntil: 'domcontentloaded' }); await dismissGuide(page);
    await page.getByRole('button', { name: 'Dokončit offline přípravu', exact: true }).waitFor();
    const baseline = JSON.parse(await readFile(path.join(root, 'profile-baseline.json'), 'utf8'));
    const upgraded = await durableSnapshot(page);
    expect(upgraded).toEqual({ ...baseline, version: 10 });
    record('upgrade_preserved_content_and_device', { fromVersion: baseline.version, toVersion: upgraded.version, contentRecords: upgraded.contentRecords, sameDevice: true, contentByteIdentical: true });
    const currentShell = JSON.parse(await readFile(path.join(outDir, 'app-shell.json'), 'utf8'));
    // This public chunk is a STATIC dependency of App, despite its name.
    const requiredEngine = currentShell.resources.find(item => /assets\/pdf-engine-.*\.js$/.test(item.path));
    expect(requiredEngine).toBeTruthy();
    const backup = await page.evaluateHandle(async url => {
      const saved = [];
      for (const name of await caches.keys()) {
        if (!name.includes('precache')) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (new URL(request.url).pathname !== new URL(url).pathname) continue;
          const response = await cache.match(request);
          saved.push({ name, request, response }); await cache.delete(request);
        }
      }
      return saved;
    }, `${appUrl}${requiredEngine.path}`);
    try {
      await page.getByRole('button', { name: 'Dokončit offline přípravu', exact: true }).click();
      await expect(page.getByText(/\(shell_incomplete\)/)).toBeVisible();
      await expect(page.getByLabel('Splněné podmínky')).toHaveText('2/3');
    } finally {
      // Fault injection restores the exact cached public Response. No grant,
      // song, user-state record or real user's PWA profile is modified here.
      await page.evaluate(async saved => { for (const item of saved) await (await caches.open(item.name)).put(item.request, item.response); }, backup);
      await backup.dispose();
    }
    results.push({ test: 'missing mandatory JS chunk reports shell_incomplete instead of ready', result: 'PASS' });
    await exerciseLoginBranches();
    await page.getByRole('button', { name: 'Dokončit offline přípravu', exact: true }).click();
    await expect(page.getByText('Oprávnění, soubory aplikace i texty jsou uložené a ověřené.', { exact: true })).toBeVisible({ timeout: 25000 });
    await expect(page.getByRole('heading', { name: 'Připraveno bez internetu', exact: true })).toBeVisible({ timeout: 25000 });
    const grant = await dbRead(page, 'offlineAuth', 'current');
    expect(grant.payload.subject).toBe(profile.id);
    record('grant_persisted', { provider: grant.provider, signatureVerified: true, deviceIdPresent: Boolean(grant.payload.deviceId), expiresAt: grant.payload.offlineValidUntil });
    const clientEvents = (await dbRead(page, 'diagnostics', null)).filter(value => value.details?.build === buildId)
      .map(value => ({ at: value.occurredAt, code: value.event, phase: value.details.phase, build: value.details.build, status: value.details.status }));
    expect(clientEvents.some(value => value.code === 'offline_grant_valid')).toBe(true);
    record('client_diagnostics', { events: clientEvents });
    await page.screenshot({ path: path.join(evidence, 'after-prepared.png'), fullPage: true });
    // A: reload in the same page. Expire the server-issued access token by real elapsed time.
    const claims = JSON.parse(Buffer.from(grant.token.split('.')[1], 'base64url').toString());
    offlineNetwork = true;
    await new Promise(resolve => hosting.httpServer.close(resolve)); hosting = null;
    backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve));
    await context.setOffline(true);
    await page.goto(`${appUrl}songs/personal-offline-1`);
    await expect(page.locator('.chord-sheet')).toContainText('Krátký test');
    await page.reload(); await expect(page.locator('.chord-sheet')).toContainText('Krátký test');
    await networkProof(page);
    results.push({ test: 'A same-page offline reload', result: 'PASS' });
    await context.close(); context = null;
    const remaining = Math.max(0, claims.exp * 1000 - Date.now() + 1200);
    if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
    expect(Date.now()).toBeGreaterThan(claims.exp * 1000);
    // B: new browser PROCESS with a real preserved profile; offline before navigation.
    context = await launch(true); page = context.pages()[0] ?? await context.newPage();
    const responses = []; page.on('response', response => { if (response.ok()) responses.push({ pathname: new URL(response.url()).pathname, serviceWorker: response.fromServiceWorker() }); });
    await page.goto(appUrl); await dismissGuide(page);
    await expect(page.getByRole('heading', { name: 'Český zpěvník', exact: true })).toBeVisible({ timeout: 20000 });
    await page.goto(`${appUrl}songs/personal-offline-2`);
    await expect(page.locator('.chord-sheet')).toContainText('Krátký test');
    await expect(page.locator('.offline-auth-banner')).toContainText('Offline režim');
    // The existing reader deliberately persists a song's transpose only when
    // the user enables its own arrangement. Exercise that real UI preference.
    await page.getByRole('button', { name: 'Otevřít nastavení zobrazení', exact: true }).click();
    await page.getByRole('checkbox', { name: /Vlastní aranžmá této písně/ }).check();
    await page.getByRole('button', { name: 'Hotovo', exact: true }).click();
    const previousTranspose = Number(await page.getByLabel('Posun v půltónech').innerText());
    await page.getByRole('button', { name: 'Zvýšit o půltón' }).click();
    const expectedTranspose = previousTranspose + 1 > 0 ? `+${previousTranspose + 1}` : `${previousTranspose + 1}`;
    await expect(page.getByLabel('Posun v půltónech')).toHaveText(expectedTranspose);
    const removeFavorite = page.getByRole('button', { name: 'Odebrat z oblíbených', exact: true });
    if (await removeFavorite.isVisible()) await removeFavorite.click();
    await page.getByRole('button', { name: 'Přidat do oblíbených', exact: true }).click();
    await expect.poll(async () => {
      const state = await dbRead(page, 'state', 'current');
      return state.favorites.includes('personal-offline-2') && state.songReaderPreferences['personal-offline-2']?.transpose === previousTranspose + 1;
    }).toBe(true);
    await page.screenshot({ path: path.join(evidence, 'after-cold-start-expired-access-token.png'), fullPage: true });
    await page.goto(`${appUrl}songs`);
    const search = page.getByRole('searchbox').first(); await search.fill('Offline cvičení 2');
    await expect(page.getByText('Offline cvičení 2', { exact: true }).first()).toBeVisible();
    await page.goto(`${appUrl}setlists`);
    const details = page.locator('.new-setlist-details'); await details.waitFor();
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
    const form = page.getByLabel('Název nového setlistu');
    await form.fill(offlineSetlistName); await page.getByRole('button', { name: 'Vytvořit', exact: true }).click();
    await expect(page.getByRole('tab', { name: new RegExp(offlineSetlistName) })).toBeVisible();
    await expect.poll(async () => (await dbRead(page, 'state', 'current')).setlists.some(value => value.name === offlineSetlistName)).toBe(true);
    await networkProof(page);
    expect(responses.filter(value => !value.serviceWorker)).toEqual([]);
    record('cold_start_evidence', { accessTokenExpired: Date.now() > claims.exp * 1000, grantStillValid: Date.now() < Date.parse(grant.payload.offlineValidUntil), successfulResponseCount: responses.length, allSuccessfulResponsesFromServiceWorker: true, paths: [...new Set(responses.map(value => value.pathname))] });
    await context.close(); context = await launch(true); page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${appUrl}songs/personal-offline-2`); await expect(page.locator('.chord-sheet')).toContainText('Krátký test');
    await expect(page.getByRole('button', { name: 'Odebrat z oblíbených', exact: true })).toBeVisible();
    await expect(page.getByLabel('Posun v půltónech')).toHaveText(expectedTranspose);
    await page.goto(`${appUrl}setlists`); await expect(page.getByRole('tab', { name: new RegExp(offlineSetlistName) })).toBeVisible();
    await networkProof(page);
    results.push({ test: 'B persistent profile, update, start_url, deep link, expired access token, second offline restart', result: 'PASS' });
    offlineNetwork = false;
    await new Promise(resolve => backend.listen(4186, '127.0.0.1', resolve));
    hosting = await preview({ mode: 'production', build: { outDir }, preview: { host: '127.0.0.1', port: 4187, strictPort: true } });
    await context.setOffline(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: new RegExp(offlineSetlistName) })).toBeVisible();
    await expect.poll(() => Boolean(cloudState?.setlists.some(value => value.name === offlineSetlistName)), { timeout: 20000 }).toBe(true);
    expect(cloudState.favorites).toContain('personal-offline-2');
    expect(cloudState.songReaderPreferences['personal-offline-2'].transpose).toBe(previousTranspose + 1);
    results.push({ test: 'reconnection uploads offline favorites, arrangement and setlist without loss', result: 'PASS' });
    record('reconnection_verified', { offlineChangesSynced: true });
  }
} catch (error) {
  record('failure', { code: error.name, message: error.message.slice(0, 800) });
  if (context?.pages()[0]) await context.pages()[0].screenshot({ path: path.join(evidence, `${phase}-failure.png`), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close();
  if (hosting) await new Promise(resolve => hosting.httpServer.close(resolve));
  if (backend.listening) { backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); }
  await writeFile(path.join(evidence, `${phase}-browser-evidence.json`), JSON.stringify({ results, logs, phone: 'NEOVĚŘENO NA ZAŘÍZENÍ' }, null, 2));
}
