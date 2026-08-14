import { defineConfig } from '@playwright/test';

const viewports = [
  ['mobile-320x568', 320, 568],
  ['mobile-360x800', 360, 800],
  ['mobile-390x844', 390, 844],
  ['mobile-430x932', 430, 932],
  ['landscape-844x390', 844, 390],
] as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173/Zpevnik/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'allow',
  },
  outputDir: 'test-results/playwright',
  projects: [
    ...viewports.map(([name, width, height]) => ({
      name,
      use: { viewport: { width, height }, isMobile: true, hasTouch: true },
    })),
    {
      name: 'desktop-1440x900',
      use: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
    },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/Zpevnik/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
