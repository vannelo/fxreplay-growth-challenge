import { defineConfig, devices } from '@playwright/test';
import { ORIGIN, PORT } from './tests/e2e/constants';

// Tests run against the PRODUCTION build (never `astro dev`), served by the Node adapter (ADR-008).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: ORIGIN, trace: 'retain-on-failure' },
  webServer: {
    command: `E2E=1 npx astro build && PORT=${PORT} node dist/server/entry.mjs`,
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }, { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } }],
});
