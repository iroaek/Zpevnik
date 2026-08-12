import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { personalLibraryPlugin } from './scripts/lib/personal-library.js';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const publicBaseUrl = new URL(process.env.VITE_PUBLIC_BASE_URL || process.env.CF_PAGES_URL || environment.VITE_PUBLIC_BASE_URL || 'https://zpevnik.example.invalid/');
  const basePath = `${publicBaseUrl.pathname.replace(/\/+$/, '')}/`.replace(/\/{2,}/g, '/');

  return {
    base: basePath,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const moduleId = id.replaceAll('\\', '/');
            if (!moduleId.includes('/node_modules/')) return undefined;
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(moduleId)) return 'react-core';
            if (moduleId.includes('/node_modules/@neondatabase/')) return 'neon-data';
            if (/\/node_modules\/(zod|idb)\//.test(moduleId)) return 'validation-storage';
            if (/\/node_modules\/(pdfjs-dist|sql\.js|csv-parse)\//.test(moduleId)) return 'pdf-engine';
            if (/\/node_modules\/(opensheetmusicdisplay|jszip|fast-xml-parser)\//.test(moduleId)) return 'music-renderer';
            if (moduleId.includes('/node_modules/qrcode/')) return 'qr-renderer';
            return undefined;
          },
        },
      },
    },
    plugins: [
      personalLibraryPlugin(process.cwd(), mode !== 'mobile'),
      {
        name: 'public-base-html',
        transformIndexHtml(html) {
          return html
            .replaceAll('%PUBLIC_BASE_URL%', publicBaseUrl.toString())
            .replaceAll('%PUBLIC_BASE_PATH%', basePath);
        },
      },
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icons/apple-touch-icon-lazec.png'],
        manifest: {
          id: basePath,
          name: 'Český digitální zpěvník',
          short_name: 'Zpěvník',
          description: 'Mobilní offline zpěvník s akordy, setlisty a notovými party.',
          lang: 'cs',
          start_url: basePath,
          scope: basePath,
          display: 'standalone',
          display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
          orientation: 'any',
          background_color: '#171310',
          theme_color: '#7a321f',
          categories: ['music', 'education', 'entertainment'],
          icons: [
            { src: 'icons/icon-lazec-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-lazec-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-lazec-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          shortcuts: [
            { name: 'Písně', short_name: 'Písně', url: basePath, icons: [{ src: 'icons/icon-lazec-192.png', sizes: '192x192' }] },
            { name: 'Offline obsah', short_name: 'Offline', url: `${basePath}offline`, icons: [{ src: 'icons/icon-lazec-192.png', sizes: '192x192' }] },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,mjs,css,html,png,svg,json,woff2,wasm}'],
          globIgnores: [
            'qr/**/*',
            'icons/**/*',
            'content/catalog.json',
            'content/songs/**/*',
            'content/scores/**/*',
            'personal-library/**/*',
            'assets/opensheetmusicdisplay*.js',
            'assets/jszip*.js',
            'assets/music-renderer*.js',
            'assets/pdf-engine*.js',
          ],
          navigateFallback: `${basePath}index.html`,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: /\/content\/catalog\.json$/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'zpevnik-catalog-runtime-v2',
                networkTimeoutSeconds: 5,
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              urlPattern: /\/assets\/(?:opensheetmusicdisplay|jszip|music-renderer|pdf-engine)[^/]*\.js$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'zpevnik-score-renderer-v2',
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },
        devOptions: { enabled: true, navigateFallback: `${basePath}index.html` },
      }),
    ],
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      coverage: { reporter: ['text', 'html'] },
    },
  };
});
