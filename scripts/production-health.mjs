import process from 'node:process';
import { URL } from 'node:url';

const appUrl = new URL(process.env.PRODUCTION_URL || 'https://iroaek.github.io/Zpevnik/');
const authUrl = (process.env.PRODUCTION_NEON_AUTH_URL || process.env.VITE_NEON_AUTH_URL || '').replace(/\/+$/, '');
const dataUrl = (process.env.PRODUCTION_NEON_DATA_API_URL || process.env.VITE_NEON_DATA_API_URL || '').replace(/\/+$/, '');
const testEmail = process.env.PRODUCTION_TEST_EMAIL || '';
const testPassword = process.env.PRODUCTION_TEST_PASSWORD || '';
const timeoutMs = 15_000;

async function checkedFetch(label, input, init = {}, accepted = (status) => status >= 200 && status < 400) {
  const response = await globalThis.fetch(input, { ...init, signal: globalThis.AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!accepted(response.status)) throw new Error(`${label} odpověděl HTTP ${response.status}.`);
  globalThis.console.log(`✓ ${label}: HTTP ${response.status}`);
  return response;
}

async function checkDataApiProtection(configuredDataUrl) {
  const response = await globalThis.fetch(`${configuredDataUrl}/rpc/get_my_profile`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
    signal: globalThis.AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  const authenticationRejected = [400, 401, 403].includes(response.status)
    && /missing authentication credentials|authorization bearer token|jwt|unauthorized|forbidden/i.test(body);
  if (!authenticationRejected) throw new Error(`Neon Data API ochrana odpověděla HTTP ${response.status} bez očekávaného odmítnutí autentizace.`);
  globalThis.console.log(`✓ Neon Data API ochrana: HTTP ${response.status}`);
}

function requireConfigured(name, value) {
  if (!value) throw new Error(`${name} není nastavené v GitHub Actions Variables.`);
  return value;
}

async function checkPwa() {
  const page = await checkedFetch('PWA', appUrl, { headers: { Accept: 'text/html' } });
  const html = await page.text();
  if (!/<main\b|id=["']root["']/i.test(html)) throw new Error('PWA neobsahuje kořen aplikace.');
  const manifestMatch = html.match(/<link[^>]+rel=["'][^"']*manifest[^"']*["'][^>]+href=["']([^"']+)/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*manifest/i);
  const manifestUrl = new URL(manifestMatch?.[1] || 'manifest.webmanifest', appUrl);
  const manifestResponse = await checkedFetch('PWA manifest', manifestUrl, { headers: { Accept: 'application/manifest+json, application/json' } });
  const manifest = await manifestResponse.json();
  if (!manifest.start_url || !Array.isArray(manifest.icons) || manifest.icons.length === 0) throw new Error('PWA manifest není úplný.');
  await checkedFetch('Service worker', new URL('sw.js', appUrl));
}

async function checkNeon() {
  const configuredAuthUrl = requireConfigured('VITE_NEON_AUTH_URL', authUrl);
  const configuredDataUrl = requireConfigured('VITE_NEON_DATA_API_URL', dataUrl);
  await checkedFetch('Neon Auth JWKS', `${configuredAuthUrl}/.well-known/jwks.json`, { headers: { Accept: 'application/json' } });
  await checkDataApiProtection(configuredDataUrl);

  if (!testEmail || !testPassword) {
    globalThis.console.warn('⚠ Přihlašovací smoke test je přeskočený. Nastavte Secrets PRODUCTION_TEST_EMAIL a PRODUCTION_TEST_PASSWORD.');
    return;
  }

  const login = await checkedFetch('Neon Auth přihlášení', `${configuredAuthUrl}/sign-in/email`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: appUrl.origin },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  const body = await login.json().catch(() => null);
  const token = login.headers.get('set-auth-jwt')
    || body?.token
    || body?.session?.token
    || body?.data?.token;
  if (!token || typeof token !== 'string') throw new Error('Přihlášení nevrátilo JWT pro ověření Data API.');

  const profile = await checkedFetch('Neon profil po přihlášení', `${configuredDataUrl}/rpc/get_my_profile`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const profileBody = await profile.json().catch(() => null);
  if (!profileBody) throw new Error('Neon Data API nevrátilo profil testovacího účtu.');
}

try {
  globalThis.console.log(`Kontroluji produkci ${appUrl.toString()}`);
  await checkPwa();
  await checkNeon();
  globalThis.console.log('✓ Produkční kontrola byla úspěšná.');
} catch (error) {
  globalThis.console.error(`✗ Produkční kontrola selhala: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
