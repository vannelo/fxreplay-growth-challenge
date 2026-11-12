import { defineConfig, devices } from '@playwright/test';
import { ORIGIN, PORT, SINK_ORIGIN, SINK_PORT } from './tests/e2e/constants';

// Tests run against the PRODUCTION build (never `astro dev`), served by the Node adapter (ADR-008).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: ORIGIN, trace: 'retain-on-failure' },
  webServer: [
    // PostHog stand-in: records events from the browser and the server.
    { command: `SINK_PORT=${SINK_PORT} node tests/e2e/sink.mjs`, url: `${SINK_ORIGIN}/__events`, reuseExistingServer: !process.env.CI },
    {
      command: `npx astro build && PORT=${PORT} node dist/server/entry.mjs`,
      url: ORIGIN,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // Analytics points at the sink (build-time public vars, read by browser and server).
      env: { E2E: '1', PUBLIC_POSTHOG_KEY: 'phc_test', PUBLIC_POSTHOG_HOST: SINK_ORIGIN, PUBLIC_APP_ENV: 'test' },
    },
  ],
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }, { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } }],
});
