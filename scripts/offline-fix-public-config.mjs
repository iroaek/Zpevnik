/* global console, process, fetch, URL, AbortSignal */
// Read public app code/config and public JWKS only; no login and no song data.
import { writeFile, mkdir } from 'node:fs/promises';
const app = new URL('https://iroaek.github.io/Zpevnik/');
const report = { at: new Date().toISOString(), appOrigin: app.origin, appPath: app.pathname, checks: [], configuration: [], limitation: 'Public configuration only; no production session, grant or user data inspected.' };
try {
  const response = await fetch(app, { signal: AbortSignal.timeout(12000) });
  report.checks.push({ phase: 'app', status: response.status, contentType: response.headers.get('content-type') });
  const html = await response.text();
  const scripts = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|mjs))"/g)].map(match => new URL(match[1], app));
  const visited = new Set(); const authEndpoints = new Set();
  while (scripts.length && visited.size < 70) {
    const url = scripts.shift(); if (visited.has(url.href) || url.origin !== app.origin) continue;
    visited.add(url.href);
    const file = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!file.ok) continue;
    const code = await file.text();
    for (const match of code.matchAll(/https:\/\/[^\s"'`\\<>]+\.neon\.tech[^\s"'`\\<>]*/g)) {
      const endpoint = new URL(match[0]); report.configuration.push({ origin: endpoint.origin, path: endpoint.pathname });
      if (/\/auth\/?$/.test(endpoint.pathname)) authEndpoints.add(endpoint.href.replace(/\/$/, ''));
    }
    for (const match of code.matchAll(/["']((?:(?:\.\/)?assets\/|\.\/)[A-Za-z0-9_.-]+\.js)["']/g)) scripts.push(new URL(match[1], match[1].startsWith('assets/') ? app : url));
  }
  report.configuration = report.configuration.filter((value, index, values) => values.findIndex(other => other.origin === value.origin && other.path === value.path) === index);
  report.checkedModules = [...visited].map(url => new URL(url).pathname);
  for (const auth of authEndpoints) {
    const response = await fetch(`${auth}/.well-known/jwks.json`, { headers: { Origin: app.origin }, signal: AbortSignal.timeout(12000) });
    const body = response.ok ? await response.json() : null;
    report.checks.push({ phase: 'public_jwks', status: response.status, contentType: response.headers.get('content-type'), allowedOrigin: response.headers.get('access-control-allow-origin'), keys: body?.keys?.map(key => ({ kty: key.kty, crv: key.crv, alg: key.alg })) ?? [] });
  }
} catch (error) { report.checks.push({ phase: 'public_config', code: error.name }); process.exitCode = 1; }
await mkdir('docs/offline-fix', { recursive: true });
await writeFile('docs/offline-fix/public-configuration.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
