/* global console, document, URL */
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Run after the normal `npm run build`, never after build:e2e.
const inventory = JSON.parse(await readFile('dist/app-shell.json', 'utf8'));
for (const resource of inventory.resources) {
  assert(!resource.path.includes('..') && !resource.path.includes(':'));
  const bytes = await readFile('dist/' + resource.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.sha256, resource.path);
}
for (const file of await readdir('dist/assets')) {
  if (!file.endsWith('.js')) continue;
  const source = await readFile('dist/assets/' + file, 'utf8');
  assert(!/auth\.example\.test|data\.example\.test|personal-qa-|ui-qa-original-|qa-member/.test(source), 'QA fixture leaked into ' + file);
}
const server = await preview({ preview: { host: '127.0.0.1', port: 4177, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const errors = [], missingAssets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:4177/') && response.status() >= 400) missingAssets.push(response.status()); });
  // Do not contact a real auth/data server. Only an unauthenticated response is provided.
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4177') return route.continue();
    const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4177', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: 'null' });
  });
  await page.goto('http://127.0.0.1:4177/Zpevnik/');
  const login = page.getByRole('heading', { name: 'Přihlášení', exact: true });
  const configurationGate = page.getByRole('heading', { name: 'Server není připojený', exact: true });
  await login.or(configurationGate).waitFor().catch(async error => {
    console.log('Production smoke UI:', await page.locator('body').innerText(), 'page errors:', errors, 'missing assets:', missingAssets);
    await page.screenshot({ path: 'tmp/ui-redesign-production-failure.png', fullPage: true });
    throw error;
  });
  assert.equal(await page.locator('.home-shortcuts').count(), 0, 'Production must require the secure account');
  assert.equal(await page.getByLabel('Jméno nebo přezdívka').count(), 0, 'Local E2E profile must not replace production login');
  const configurationMissing = await configurationGate.isVisible();
  if (!configurationMissing) await page.getByRole('button', { name: 'Přihlásit se', exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await page.screenshot({ path: 'docs/ui-redesign/screenshots/after-production-' + (configurationMissing ? 'config' : 'login') + '-390x844.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(missingAssets, []);
  const result = { productionSecureGate: 'passed', configurationMissing, testFixturesAbsent: 'passed', appShellHashes: inventory.resources.length, browser: 'Chromium', missingAssets, consoleErrors: errors, remoteAuthentication: configurationMissing ? 'blocked: local production configuration lacks Neon Auth and Data API URLs' : 'not tested; requests intercepted as unauthenticated' };
  await writeFile('docs/ui-redesign/production-smoke-results.json', JSON.stringify(result, null, 2) + '\n');
  console.info('PASS: production secure gate, asset hashes, no QA fixture payloads, no missing local assets or page errors. ' + (configurationMissing ? 'BLOCKED: local production configuration lacks Neon Auth / Data API URLs.' : 'Remote authentication not tested.'));
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
