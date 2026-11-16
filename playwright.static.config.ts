import { defineConfig, devices } from '@playwright/test';

const PORT = 3300;

/**
 * Tests for the static export (Mode C). `pnpm test:static` exports the fixture catalog to
 * out-static/ and serves the folder with a plain file server: no Next.js, no database.
 */
export default defineConfig({
  testDir: './e2e-static',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `node scripts/serve-static.mjs out-static ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
