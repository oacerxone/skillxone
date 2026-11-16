import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * End-to-end tests run against a production build with the development fixtures loaded.
 * `pnpm test:e2e` bootstraps the database and builds first; this config only starts the server.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      // Chromium at a phone-sized viewport with touch, as the roadmap's 375 px check requires.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @skillxone/web exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Test accounts created by e2e/sessions.ts. Roles come from these allowlists on every request.
    env: { ADMIN_GITHUB_IDS: '990000003', MODERATOR_GITHUB_IDS: '990000002' },
  },
});
