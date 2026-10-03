import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1050 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'artifacts/browser-tests',
  reporter: [['list'], ['json', { outputFile: 'artifacts/browser-results.json' }]],
});
