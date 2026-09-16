import { defineConfig, devices } from "@playwright/test";

const configuredBaseUrl = process.env.FIELDCLOSE_E2E_BASE_URL?.trim();
const baseURL = configuredBaseUrl || "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? undefined : "chrome",
      },
    },
  ],
  webServer: {
    command: "node scripts/start-e2e-server.mjs",
    url: baseURL,
    reuseExistingServer: Boolean(configuredBaseUrl),
    timeout: 120_000,
  },
});
