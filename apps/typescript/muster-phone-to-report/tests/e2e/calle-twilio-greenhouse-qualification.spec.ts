import { expect, test, type Page } from "@playwright/test";

const capability = {
  enabled: true,
  runtimeProfile: "development",
  supportedScenarioRevisions: [{ scenarioId: "synthetic-normal", revision: 2 }],
};

const operationId = "operation-calle-qualification-001";
const maximumRecordedRequestCount = 100;

function isLoopbackOrLocalPreview(requestUrl: URL, localOrigin: string): boolean {
  if (requestUrl.origin === localOrigin) return true;
  const hostname = requestUrl.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

function completeProjection(resourceVersion = 4) {
  const readings = [
    ["zone-01", "North house air temperature", "71.5", "degF"],
    ["zone-02", "Propagation bench temperature", "68.0", "degF"],
    ["zone-03", "Greenhouse relative humidity", "68", "percent"],
    ["zone-04", "Irrigation reservoir level", "82", "percent"],
  ] as const;
  return {
    operationId,
    resourceVersion,
    stage: "terminal",
    terminal: true,
    terminalOutcome: "observation_recorded",
    scenarioId: "synthetic-normal",
    scenarioRevision: 2,
    provenance: "SIMULATED",
    transcript: [
      { speaker: "device", text: "Synthetic four-zone greenhouse report." },
      { speaker: "device", text: "All four synthetic zones reported within bounds." },
    ],
    evidence: { quality: "complete", opaqueReference: "custody-ref-qualification-001" },
    readings: readings.map(([zoneId, label, value, unit]) => ({
      zoneId,
      label,
      value,
      unit,
      status: "OK",
      disposition: "grounded",
    })),
    reconciliation: readings.map(([zoneId]) => ({ zoneId, disposition: "matched" })),
    auxiliaryStatus: {
      sound: "normal",
      power: "mains_available",
      battery: "normal",
      output: "off",
    },
    predecessorOperationId: null,
    dtmfActions: 0,
    twilioReconciliation: "1 matching call",
  };
}

async function enableLiveCapability(page: Page): Promise<void> {
  await page.route("**/api/v1/live-simulator/capability", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(capability),
    });
  });
}

async function routeOneCompleteOperation(page: Page): Promise<() => number> {
  let postCount = 0;
  let getCount = 0;
  await page.route("**/api/v1/live-simulator/operations", async (route) => {
    postCount += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      headers: { location: `/api/v1/live-simulator/operations/${operationId}` },
      body: JSON.stringify({ operationId, resourceVersion: 0 }),
    });
  });
  await page.route(`**/api/v1/live-simulator/operations/${operationId}`, async (route) => {
    getCount += 1;
    const projection =
      getCount === 1
        ? {
            ...completeProjection(1),
            stage: "calling",
            terminal: false,
            terminalOutcome: null,
            transcript: [],
            evidence: null,
            readings: [],
            reconciliation: [],
            auxiliaryStatus: null,
          }
        : completeProjection();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projection),
    });
  });
  return () => postCount;
}

test("AC-ENTRY-1 AC-HAPPY-3 keeps deterministic replay default and provides immediate provider-free fallback", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("Playwright base URL is required");
  const localOrigin = new URL(baseURL).origin;
  let externalRequestAttemptCount = 0;
  let livePostCount = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (!isLoopbackOrLocalPreview(requestUrl, localOrigin)) {
      externalRequestAttemptCount = Math.min(
        externalRequestAttemptCount + 1,
        maximumRecordedRequestCount,
      );
      await route.abort("blockedbyclient");
      return;
    }
    if (
      request.method() === "POST" &&
      requestUrl.pathname === "/api/v1/live-simulator/operations"
    ) {
      livePostCount = Math.min(livePostCount + 1, maximumRecordedRequestCount);
    }
    await route.fallback();
  });
  await enableLiveCapability(page);
  await page.goto("/simulator.html");

  const replayMode = page.getByRole("radio", { name: "Deterministic replay" });
  await expect(replayMode).toBeChecked();
  await page.getByRole("radio", { name: "Live observation" }).check();
  await replayMode.check();
  await page.getByRole("button", { name: "Replay simulated scenario" }).click();

  await expect(page.getByRole("heading", { name: "Observation complete" })).toBeFocused();
  await expect(
    page.getByLabel("Simulated data—not physical hardware evidence").last(),
  ).toContainText("SIMULATED");
  expect(livePostCount).toBe(0);
  expect(externalRequestAttemptCount).toBe(0);
});

test("AC-HAPPY-1 AC-HAPPY-2 renders the durable complete result with transcript before exactly four grounded Readings", async ({
  page,
}) => {
  await enableLiveCapability(page);
  const getPostCount = await routeOneCompleteOperation(page);
  await page.goto("/simulator.html");
  await page.getByRole("radio", { name: "Live observation" }).check();
  await page.getByLabel("One-use permit").fill("synthetic-one-use-permit");
  await page.getByRole("button", { name: "Run live observation" }).click();

  const result = page.getByRole("region", { name: "Live observation result" });
  await expect(page.getByRole("heading", { name: "Calling synthetic endpoint" })).toBeVisible();
  await expect(result.getByText(operationId)).toBeVisible();
  await expect(result.locator('[data-provenance="simulated"]')).toContainText("SIMULATED");
  await expect(
    page.getByRole("heading", { name: "Live simulated observation complete" }),
  ).toBeFocused();
  await expect(result.getByText(operationId)).toBeVisible();
  await expect(result.locator('[data-provenance="simulated"]')).toContainText("SIMULATED");
  await expect(
    result.getByText("Synthetic four-zone greenhouse report.", { exact: true }),
  ).toBeVisible();
  expect(
    await result
      .locator('[data-evidence-role="source-transcript"], [data-evidence-role="derived-readings"]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-evidence-role")),
      ),
  ).toEqual(["source-transcript", "derived-readings"]);
  const readings = result.locator("[data-reading-zone]");
  await expect(readings).toHaveCount(4);
  for (const reading of await readings.all()) await expect(reading).toContainText("grounded");
  await expect(result.getByText("0", { exact: true })).toBeVisible();
  await expect(result.getByText("1 matching call", { exact: true })).toBeVisible();
  expect(getPostCount()).toBe(1);
});

test("AC-ASYNC-1 refresh and remount recover the server-established operation by GET only", async ({
  page,
}) => {
  const operationRequests: { readonly method: string; readonly pathname: string }[] = [];
  await page.addInitScript(
    (identity) => {
      sessionStorage.setItem("muster.simulator.live-operation-id", JSON.stringify(identity));
    },
    {
      operationId,
      scenarioId: "synthetic-normal",
      scenarioRevision: 2,
    },
  );
  await enableLiveCapability(page);
  await page.route("**/api/v1/live-simulator/operations/**", async (route) => {
    const request = route.request();
    operationRequests.push({ method: request.method(), pathname: new URL(request.url()).pathname });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(completeProjection()),
    });
  });

  await page.goto("/simulator.html");
  await expect(page.getByText(operationId)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Live simulated observation complete" }),
  ).toBeVisible();

  expect(operationRequests.length).toBeGreaterThanOrEqual(2);
  expect(operationRequests.every(({ method }) => method === "GET")).toBe(true);
  expect(operationRequests.every(({ pathname }) => pathname.endsWith(`/${operationId}`))).toBe(
    true,
  );
});

test("AC-ENTRY-1 keeps replay and live controls accessible at 320px, zoom-equivalent sizing, reduced motion, and forced colors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await enableLiveCapability(page);
  await page.goto("/simulator.html");

  await expect(page.getByRole("heading", { name: "Simulator Lab", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mode" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Deterministic replay" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Live observation" })).toBeEnabled();
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.setViewportSize({ width: 640, height: 720 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const replayButton = page.getByRole("button", { name: "Replay simulated scenario" });
  await replayButton.focus();
  await expect(replayButton).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640);
});
