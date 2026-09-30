import { expect, test, type Page, type Route } from "@playwright/test";

import { OBSERVATION_REVIEWED_ORACLE } from "@muster/testing";

import {
  createFleetHealthTestRuntime,
  startFleetHealthTestPostgres,
  type FleetHealthTestPostgres,
  type FleetHealthTestRuntime,
} from "./support/fleet-health-test-runtime.js";

/**
 * Test strategy: prove the same two Phase 5 behaviors in the built Vite preview while every API
 * request is forwarded to the disposable real boundary. Deliberately not tested: pixel-perfect
 * rendering, browser-engine colors, real hardware/provider behavior, or completion-time SLOs.
 * SIMULATED evidence stays visible, but its endpoint state remains operationally not observed.
 */

let postgres: FleetHealthTestPostgres;
let runtime: FleetHealthTestRuntime | undefined;
let observationPostCount = 0;

async function forwardApi(route: Route): Promise<void> {
  const source = new URL(route.request().url());
  if (
    route.request().method() === "POST" &&
    /^\/api\/v1\/endpoints\/[^/]+\/observations$/u.test(source.pathname)
  ) {
    observationPostCount += 1;
  }
  const response = await route.fetch({
    url: `${runtime?.baseUrl}${source.pathname}${source.search}`,
  });
  await route.fulfill({ response });
}

async function openRealFleet(page: Page, expectCurrentHeartbeat = true): Promise<void> {
  await page.route("**/api/v1/**", forwardApi);
  await page.goto("/");
  await expect(page).toHaveURL(/\/fleet$/u);
  await expect(page.getByLabel("Muster")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fleet Health", level: 1 })).toBeVisible();
  if (expectCurrentHeartbeat) {
    await expect(page.getByRole("heading", { name: "Scheduler heartbeat: Current" })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Boiler room monitor" })).toBeVisible();
  await expect(page.getByText("Incident status unavailable")).toBeVisible();
}

test.beforeAll(async () => {
  postgres = await startFleetHealthTestPostgres();
});

test.afterAll(async () => {
  await postgres.close();
});

test.beforeEach(async () => {
  observationPostCount = 0;
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await runtime?.close();
  runtime = undefined;
});

test("enters branded Fleet Health, refreshes during one POST, and renders oracle-backed completion", async ({
  page,
}) => {
  runtime = await createFleetHealthTestRuntime({
    connectionString: postgres.connectionString,
    scenario: "complete",
    deferManualTerminal: true,
  });
  await openRealFleet(page);

  await expect(page.getByText("SIMULATED").first()).toBeVisible();
  await page.getByRole("button", { name: "Run observation" }).click();
  await expect(page.getByText("Observation queued")).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Calling endpoint|Observation queued/u)).toBeVisible();
  runtime.releaseManualTerminal();

  await expect(page.getByText("Observation complete")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("list", { name: "Observation readings" })).toContainText(
    OBSERVATION_REVIEWED_ORACLE[0]?.values[0] ?? "missing-oracle",
  );
  await expect(page.getByRole("list", { name: "Observation readings" })).toContainText(
    OBSERVATION_REVIEWED_ORACLE[0]?.values[1] ?? "missing-oracle",
  );
  await expect(page.getByText("Operational state", { exact: true }).locator("..")).toContainText(
    "Not observed",
  );
  await expect(page.getByText("No complete observation")).toHaveCount(0);
  await expect(page.getByText("SIMULATED").last()).toBeVisible();
  expect(observationPostCount).toBe(1);
});

test("shows exact incomplete copy after provider failure while prior complete history stays non-green", async ({
  page,
}) => {
  runtime = await createFleetHealthTestRuntime({
    connectionString: postgres.connectionString,
    scenario: "provider_failure_after_complete",
  });
  await openRealFleet(page);
  const priorComplete = page.getByText("Last complete observation").locator("..");
  await expect(priorComplete).not.toContainText("No complete observation");

  await page.getByRole("button", { name: "Run observation" }).click();
  await expect(page.getByText("Observation incomplete—no operational decision made")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Operational state", { exact: true }).locator("..")).toContainText(
    "Not observed",
  );
  await expect(priorComplete).not.toContainText("No complete observation");
  await expect(page.getByText("SIMULATED").last()).toBeVisible();
  await expect(page.getByText(/^Healthy$|^Normal$/u)).toHaveCount(0);
  expect(observationPostCount).toBe(1);
});

test.describe("real admission failures", () => {
  for (const failure of [
    {
      scenario: "admission_conflict_after_complete",
      message: /Observation could not start/u,
    },
    {
      scenario: "admission_dependency_unavailable_after_complete",
      message: "Observation service is temporarily unavailable",
    },
  ] as const) {
    test(`${failure.scenario} retains prior facts and permits an explicit safe retry`, async ({
      page,
    }) => {
      runtime = await createFleetHealthTestRuntime({
        connectionString: postgres.connectionString,
        scenario: failure.scenario,
      });
      await openRealFleet(page);
      const lastAttempt = page.getByText("Last attempt", { exact: true }).locator("..");
      const lastComplete = page
        .getByText("Last complete observation", { exact: true })
        .locator("..");
      const previousAttempt = await lastAttempt.textContent();
      const previousComplete = await lastComplete.textContent();
      expect(previousAttempt).not.toContain("No attempt recorded");
      expect(previousComplete).not.toContain("No complete observation");

      await page.getByRole("button", { name: "Run observation" }).click();
      await expect(page.getByText(failure.message)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByRole("button", { name: "Retry observation" })).toBeEnabled();
      await expect(lastAttempt).toHaveText(previousAttempt ?? "missing prior attempt");
      await expect(lastComplete).toHaveText(previousComplete ?? "missing prior complete");
      await expect(
        page.getByText(
          /Observation queued|Calling endpoint|Interpreting evidence|Observation complete/u,
        ),
      ).toHaveCount(0);
      expect(observationPostCount).toBe(1);
    });
  }
});

test.describe("brand, responsive accessibility, and fail-closed state matrix", () => {
  for (const matrixCase of [
    { heartbeat: "current", mode: "narrow" },
    { heartbeat: "missing", mode: "zoom" },
    { heartbeat: "stale", mode: "forced-colors" },
    { heartbeat: "unavailable", mode: "baseline" },
  ] as const) {
    test(`keeps a simulated endpoint operationally inert with ${matrixCase.heartbeat} heartbeat at ${matrixCase.mode}`, async ({
      page,
    }) => {
      if (matrixCase.mode === "narrow") {
        await page.setViewportSize({ width: 320, height: 900 });
      }
      if (matrixCase.mode === "zoom") {
        // Native 200% browser zoom halves the CSS viewport exposed to responsive layout.
        await page.setViewportSize({ width: 640, height: 900 });
      }
      if (matrixCase.mode === "forced-colors") {
        await page.emulateMedia({ forcedColors: "active" });
      }
      runtime = await createFleetHealthTestRuntime({
        connectionString: postgres.connectionString,
        scenario: "state_matrix",
        heartbeatState: matrixCase.heartbeat,
        staleEndpoint: true,
      });
      await openRealFleet(page, false);

      await expect(page.getByLabel("Muster")).toBeVisible();
      await expect(
        page.getByText("Operational state", { exact: true }).locator(".."),
      ).toContainText("Not observed");
      await expect(page.getByText(/^Healthy$|^Normal$|^Normal observed$/u)).toHaveCount(0);
      await expect(page.getByText("SIMULATED").first()).toBeVisible();
      const heartbeat =
        matrixCase.heartbeat === "current"
          ? "Scheduler heartbeat: Current"
          : matrixCase.heartbeat === "stale"
            ? "Scheduler heartbeat: Stale"
            : "Scheduler heartbeat unavailable. Observation scheduling status is unknown.";
      await expect(page.getByText(heartbeat, { exact: true })).toBeVisible();
      if (matrixCase.mode === "forced-colors") {
        expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
      }
      if (matrixCase.mode === "zoom") {
        expect(await page.evaluate(() => window.innerWidth * 2)).toBe(1_280);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
});
