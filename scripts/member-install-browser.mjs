/* global console, process, navigator, indexedDB, fetch, URL, setTimeout, crypto, DOMException, window */
// Dedicated synthetic HTTP auth/data service + REAL production client and PWA.
// Offline phases have neither route fulfilment nor an online server.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { build, preview } from 'vite';

const phase = process.argv.includes('--before') ? 'before' : 'after';
const buildId = `member-install-${phase}`;
const root = path.resolve('tmp/member-install-20260915');
const evidence = path.resolve('docs/offline-fix/member-install-20260915');
await mkdir(root, { recursive: true }); await mkdir(evidence, { recursive: true });
const appOrigin = 'http://127.0.0.1:4287';
const authOrigin = 'http://127.0.0.1:4286';
const appUrl = `${appOrigin}/Zpevnik/`;
// Keep Chromium CacheStorage paths short on Windows; deeply nested userDataDir paths can fail Cache.put.
const profileRoot = path.join(tmpdir(), `zpm-${Date.now()}`); const profileDirectory = path.join(profileRoot, `${phase}-member`);
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
let offlineNetwork = false; let slow = false; let activeCase = ''; const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const user = () => ({ id: profile.auth_user_id, email: profile.email, name: profile.display_name, emailVerified: true, role: jwtRole, createdAt: profile.created_at, updatedAt: profile.created_at });
function token(role = jwtRole) {
  const iat = Math.floor(Date.now() / 1000);
  const input = [ { alg: 'EdDSA', typ: 'JWT', kid: jwk.kid }, { iss: authOrigin, aud: authOrigin, sub: profile.auth_user_id, email: profile.email, emailVerified: true, role, banned: false, iat, exp: iat + 20 } ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
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
  const send = (status, body, extra = {}) => {
    if (response.destroyed) return;
    const responseHeaders = { ...headers, ...extra };
    if (responseHeaders['content-type'] === null) delete responseHeaders['content-type'];
    response.writeHead(status, responseHeaders);
    response.end(status === 204 ? '' : JSON.stringify(body));
    if (request.method !== 'OPTIONS') record('http', { endpoint: url.pathname, status });
  };
  const sendDataJson = (_resource, body) => send(200, body);
  if (offlineNetwork) { response.destroy(); return; }
  if (request.method === 'OPTIONS') return send(204, null);
  let input = ''; for await (const chunk of request) input += chunk;
  const body = input ? JSON.parse(input) : {};
  if (url.pathname.startsWith('/auth/')) {
    if (url.pathname.endsWith('/.well-known/jwks.json')) { if (slow) await sleep(1500); return send(200, { keys: [jwk] }); }
    if (url.pathname.endsWith('/sign-in/email') || url.pathname.endsWith('/sign-in/email-otp')) {
      if (body.email !== profile.email || (body.password !== undefined ? body.password !== 'Synthetic-password-2468' : body.otp !== '123456')) return send(401, { code: 'INVALID_CREDENTIALS' });
      jwtRole = profile.role;
      return send(200, { token: opaqueSession, user: user(), redirect: false }, { 'set-cookie': `test_session=${opaqueSession}; HttpOnly; Path=/; SameSite=Lax` });
    }
    if (url.pathname.endsWith('/get-session')) {
      const hasSession = request.headers.cookie?.includes(`test_session=${opaqueSession}`);
      return send(200, hasSession ? { user: user(), session: { id: 'synthetic-session', token: opaqueSession, userId: profile.auth_user_id, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() } } : null, hasSession ? { 'set-auth-jwt': token() } : {});
    }
    if (url.pathname.endsWith('/token')) {
      if (apiFailure) return send(apiFailure, { code: 'synthetic_temporarily_unavailable' });
      if (!request.headers.cookie?.includes(`test_session=${opaqueSession}`)) return send(401, { code: 'session_not_found' });
      return send(200, { token: token() });
    }
    if (url.pathname.endsWith('/sign-out')) return send(200, { success: true }, { 'set-cookie': 'test_session=; Max-Age=0; Path=/' });
    if (url.pathname.endsWith('/email-otp/reset-password') && (body.otp !== '654321' || body.password !== 'Synthetic-password-2468')) return send(400, { code: 'INVALID_OTP' });
    return send(200, { success: true });
  }
  if (!authorized(request)) return send(401, { code: 'expired_or_missing_jwt' });
  if (apiFailure) return send(apiFailure, { code: 'synthetic_api_failure' });
  const resource = url.pathname.split('/').pop();
  if (resource === 'ensure_my_profile') { if (slow) await sleep(6000); jwtRole = accountStatus === 'approved' ? profile.role : accountStatus; return sendDataJson(resource, { ...profile, status: accountStatus }); }
  if (resource === 'profiles') return sendDataJson(resource, [{ ...profile, status: accountStatus }]);
  if (accountStatus !== 'approved') return send(403, { code: 'not_approved' });
  if (resource === 'register_my_device') { if (slow) await sleep(1500); return sendDataJson(resource, !deviceRevoked); }
  if (resource === 'content_packages') return send(200, packageRow ? [packageRow] : []);
  if (resource === 'content_package_chunks') return send(200, packageChunk ? [packageChunk] : []);
  if (resource === 'user_app_state') { if (request.method === 'POST') cloudState = body.state; return send(request.method === 'POST' ? 204 : 200, cloudState ? [{ state: cloudState }] : []); }
  return send(200, url.pathname.includes('/rpc/') ? null : []);
});

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
async function launch(offline = false, directory = profileDirectory, disableEd25519 = true) {
  const value = await chromium.launchPersistentContext(directory, { headless: true, viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', offline, reducedMotion: 'reduce' });
    value.setDefaultTimeout(25000);
  if (disableEd25519) await value.addInitScript(() => {
    const originalImport = crypto.subtle.importKey.bind(crypto.subtle);
    const originalVerify = crypto.subtle.verify.bind(crypto.subtle);
    const isEd25519 = algorithm => (typeof algorithm === 'string' ? algorithm : algorithm?.name)?.toLowerCase() === 'ed25519';
    Object.defineProperty(crypto.subtle, 'importKey', { configurable: true, value: (...args) => {
      if (isEd25519(args[2])) return Promise.reject(new DOMException('Synthetic browser capability: native Ed25519 unavailable', 'NotSupportedError'));
      return originalImport(...args);
    } });
    Object.defineProperty(crypto.subtle, 'verify', { configurable: true, value: (...args) => {
      if (isEd25519(args[0])) return Promise.reject(new DOMException('Synthetic browser capability: native Ed25519 unavailable', 'NotSupportedError'));
      return originalVerify(...args);
    } });
  });
  record('browser_process_started', { offline, preservedProfile: directory === profileDirectory });
  return value;
}
async function dismissGuide(page) {
  const skip = page.getByRole('button', { name: 'Přeskočit', exact: true });
  await skip.waitFor({ state: 'visible', timeout: 2000 }).catch(() => undefined);
  if (await skip.isVisible()) await skip.click();
  await expect(page.locator('.first-run-scrim')).toBeHidden();
}
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
async function diagnosticCodes(page) {
  return (await dbRead(page, 'diagnostics', null)).filter(item => item.category === 'auth').map(item => item.event);
}
async function freshCase(name, role, delay, disableEd25519, main = false) {
  activeCase = name; profile.role = role; profile.display_name = role === 'admin' ? 'Syntetický správce' : 'Testovací člen';
  slow = delay; cloudState = null;
  context = await launch(false, main ? profileDirectory : path.join(profileRoot, `${phase}-${name}`), disableEd25519);
  await context.addInitScript(() => {
    window.addEventListener('zpevnik:update-error', event => console.error('PWA_REGISTER_ERROR: ' + event.detail));
    window.addEventListener('unhandledrejection', event => console.error('UNHANDLED: ' + String(event.reason)));
  });
  const page = context.pages()[0] ?? await context.newPage();
  const cdp = await context.newCDPSession(page); await cdp.send('ServiceWorker.enable'); cdp.on('ServiceWorker.workerErrorReported', event => record('service_worker_error', { message: event.errorMessage.errorMessage, source: event.errorMessage.sourceURL }));
  page.on('request', request => { if (/workbox|sw\.js/.test(request.url())) record('sw_request', { path: new URL(request.url()).pathname }); });
  page.on('console', message => { if (message.type() === 'error') record('browser_console_error', { message: message.text().slice(0, 500) }); });
  page.on('requestfailed', request => record('request_failed', { path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  page.on('pageerror', error => record('page_error', { case: name, name: error.name, message: error.message.slice(0, 250) }));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await sleep(1000); record('service_worker_initial', { registrations: await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => ({scope:r.scope, active:r.active?.state, waiting:r.waiting?.state, installing:r.installing?.state}))) });
  await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => undefined), new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not activate within 20 seconds')), 20000))]));
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  const started = Date.now();
  await login(page);
  const grant = await dbRead(page, 'offlineAuth', 'current');
  const codes = await diagnosticCodes(page);
  record('login_result', { case: name, role, slowProfileMs: delay ? 6000 : 0, slowRegisterMs: delay ? 1500 : 0, slowJwksMs: delay ? 1500 : 0, nativeEd25519Disabled: disableEd25519, durationMs: Date.now() - started, grantPersisted: Boolean(grant), diagnosticCodes: codes });
  if (phase === 'before' && name !== 'admin-normal') {
    expect(grant).toBeUndefined();
    expect(codes).toContain('grant_issue_failed');
    results.push({ test: name, result: 'REPRODUCED', code: 'grant_issue_failed' });
    await page.screenshot({ path: path.join(evidence, `browser-${phase}-${name}.png`), fullPage: true });
  } else {
    expect(grant).toBeTruthy();
    expect(grant.profile.role).toBe(role);
    expect(grant.profile.auth_user_id).not.toBe(grant.profile.id);
    expect(grant.payload.subject).toBe(profile.id);
    expect(codes).toContain('offline_grant_valid');
    const parts = grant.token.split('.');
    expect(verify(null, Buffer.from(parts.slice(0, 2).join('.')), publicKey, Buffer.from(parts[2], 'base64url'))).toBe(true);
    results.push({ test: name, result: 'PASS', cryptographicSignatureVerified: true, durableReadbackVerified: true });
  }
  if (main) return page;
  await context.close(); context = null;
}
async function closeServers() {
  offlineNetwork = true;
  if (hosting) { hosting.httpServer.closeAllConnections(); await new Promise(resolve => hosting.httpServer.close(resolve)); hosting = null; }
  if (backend.listening) { backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); }
  record('servers_closed', { httpServersListening: false });
}
async function networkProof(page) {
  const count = logs.filter(item => item.step === 'http').length;
  const blocked = await page.evaluate(async () => { try { await fetch('/Zpevnik/uncached-member-network-proof', { cache: 'no-store' }); return false; } catch { return true; } });
  expect(blocked).toBe(true);
  expect(logs.filter(item => item.step === 'http').length).toBe(count);
  expect(backend.listening).toBe(false);
  expect(hosting).toBeNull();
  record('network_proof', { uncachedFetchFailed: true, serversClosed: true, routeFulfillment: false });
}
try {
  if (!process.argv.includes('--skip-build')) {
    let baseline = {};
    if (phase === 'before') {
      const originals = new Map();
      const reference = 'bd017a3';
      for (const file of execFileSync('git', ['ls-tree', '-r', '--name-only', reference, 'src'], { encoding: 'utf8' }).trim().split(/\r?\n/)) {
        if (/\.(tsx?|css|json)$/.test(file) && !file.includes('.test.')) originals.set(path.resolve(file).replaceAll('\\', '/'), execFileSync('git', ['show', `${reference}:${file}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
      }
      baseline = { plugins: [{ name: 'deployed-member-install-baseline', enforce: 'pre', load(id) { return originals.get(id.split('?')[0].replaceAll('\\', '/')); } }] };
    }
    await build({ ...baseline, mode: 'production', build: { outDir } });
  }
  await new Promise(resolve => backend.listen(4286, '127.0.0.1', resolve));
  hosting = await preview({ mode: 'production', build: { outDir }, preview: { host: '127.0.0.1', port: 4287, strictPort: true } });
  await freshCase('admin-normal', 'admin', false, false);
  if (phase === 'before') {
    await freshCase('member-slow-native', 'member', true, false);
    await freshCase('member-no-native-ed25519', 'member', false, true);
  } else {
    let page = await freshCase('member-slow-no-native-ed25519', 'member', true, true, true);
    slow = false;
    await preparePackage(page);
    await page.getByRole('navigation', { name: 'Hlavní navigace' }).getByRole('button', { name: 'Offline', exact: true }).click();
    await dismissGuide(page);
    await page.getByRole('button', { name: 'Dokončit offline přípravu', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Připraveno bez internetu', exact: true })).toBeVisible({ timeout: 30000 });
    expect((await dbRead(page, 'personalSongContent', null)).length).toBe(2);
    const grant = await dbRead(page, 'offlineAuth', 'current');
    const baseline = await durableSnapshot(page);
    const claims = JSON.parse(Buffer.from(grant.token.split('.')[1], 'base64url').toString());
    await page.screenshot({ path: path.join(evidence, 'browser-after-member-prepared.png'), fullPage: true });
    await context.close(); context = null;
    await closeServers();
    const remaining = Math.max(0, claims.exp * 1000 - Date.now() + 1200);
    record('waiting_real_token_expiry', { waitMs: remaining, accessTokenExpiresAt: new Date(claims.exp * 1000).toISOString() });
    if (remaining) await sleep(remaining);
    expect(Date.now()).toBeGreaterThan(claims.exp * 1000);
    context = await launch(true); page = context.pages()[0] ?? await context.newPage();
    const responses = []; page.on('response', response => { if (response.ok()) responses.push({ pathname: new URL(response.url()).pathname, serviceWorker: response.fromServiceWorker() }); });
    await page.goto(`${appUrl}songs/personal-offline-2`);
    await expect(page.locator('.chord-sheet')).toContainText('Krátký test');
    await expect(page.locator('.offline-auth-banner')).toContainText('Offline režim');
    await page.getByRole('button', { name: 'Přidat do oblíbených', exact: true }).click();
    await expect.poll(async () => (await dbRead(page, 'state', 'current')).favorites.includes('personal-offline-2')).toBe(true);
    await page.screenshot({ path: path.join(evidence, 'browser-after-offline-cold-member.png'), fullPage: true });
    await page.goto(`${appUrl}setlists`);
    const details = page.locator('.new-setlist-details'); await details.waitFor();
    if (await details.getAttribute('open') === null) await details.locator('summary').click();
    await page.getByLabel('Název nového setlistu').fill(offlineSetlistName);
    await page.getByRole('button', { name: 'Vytvořit', exact: true }).click();
    await expect(page.getByRole('tab', { name: new RegExp(offlineSetlistName) })).toBeVisible();
    await expect.poll(async () => (await dbRead(page, 'state', 'current')).setlists.some(item => item.name === offlineSetlistName)).toBe(true);
    await networkProof(page);
    expect(responses.filter(response => !response.serviceWorker)).toEqual([]);
    expect(await durableSnapshot(page)).toEqual(baseline);
    record('cold_start_verified', { role: 'member', freshBrowserProcess: true, samePersistentProfile: true, offlineBeforeNavigation: true, accessTokenExpired: Date.now() > claims.exp * 1000, offlineGrantStillValid: Date.now() < Date.parse(grant.payload.offlineValidUntil), nativeEd25519Disabled: true, successfulResponses: responses.length, allSuccessfulResponsesFromServiceWorker: true, deviceAndContentPreserved: true });
    results.push({ test: 'new offline process with expired online JWT, valid signed grant and legacy member ID', result: 'PASS' });
    await context.close(); context = await launch(true); page = context.pages()[0] ?? await context.newPage();
    await page.goto(`${appUrl}songs/personal-offline-2`);
    await expect(page.locator('.chord-sheet')).toContainText('Krátký test');
    await expect(page.getByRole('button', { name: 'Odebrat z oblíbených', exact: true })).toBeVisible();
    await page.goto(`${appUrl}setlists`);
    await expect(page.getByRole('tab', { name: new RegExp(offlineSetlistName) })).toBeVisible();
    await networkProof(page);
    results.push({ test: 'second offline process preserves favorite and setlist changes', result: 'PASS' });
  }
} catch (error) {
  record('failure', { case: activeCase, code: error.name, message: error.message.slice(0, 1200) });
  if (context?.pages()[0]) await context.pages()[0].screenshot({ path: path.join(evidence, `browser-${phase}-failure.png`), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close();
  await closeServers();
  await writeFile(path.join(evidence, `browser-${phase}.json`), JSON.stringify({ phase, build: buildId, baselineCommit: 'bd017a3f1b74be5efa4f6b198e1a99971b0b21c7', results, logs, limitations: ['Synthetic HTTP backend with real SDK and cryptographic signatures, not live user credentials.', 'Native Ed25519 absence is capability emulation in Chromium; physical Android/iOS installation not exercised.'], fixtureAuth: { signInJwtHeader: false, rawOpaqueBearerTokenEndpoint: 401, cookieGetSessionJwtHeader: true, jwtLifetimeSeconds: 20 } }, null, 2));
}