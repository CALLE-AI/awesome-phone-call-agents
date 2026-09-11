import { defineConfig } from "@playwright/test";

import { parseBrowserPort } from "./tools/toolchain/browser-port.js";

const browserPort = parseBrowserPort(process.env["MUSTER_BROWSER_PORT"]);
const browserOrigin = `http://127.0.0.1:${String(browserPort)}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] === "true" ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 120_000,
  webServer: {
    command:
      "corepack pnpm --filter @muster/testing --filter @muster/api --filter @muster/worker build && corepack pnpm --filter @muster/web build:demo && node apps/web/node_modules/vite/bin/vite.js preview apps/web --outDir dist-demo --host 127.0.0.1 --port " +
      String(browserPort) +
      " --strictPort",
    url: `${browserOrigin}/simulator.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: browserOrigin,
    trace: "retain-on-failure",
  },
});
