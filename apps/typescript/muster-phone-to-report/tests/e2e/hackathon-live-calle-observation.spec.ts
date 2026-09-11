import { expect, test, type Page } from "@playwright/test";

const capability = {
  enabled: true,
  runtimeProfile: "development",
  supportedScenarioRevisions: [
    { scenarioId: "synthetic-normal", revision: 2 },
    { scenarioId: "synthetic-abnormal", revision: 2 },
    { scenarioId: "synthetic-ambiguous", revision: 2 },
    { scenarioId: "synthetic-truncated", revision: 2 },
    { scenarioId: "synthetic-recovery", revision: 2 },
  ],
};

function liveProjection(input: {
  readonly resourceVersion: number;
  readonly stage: "scheduled" | "calling" | "extracting" | "terminal";
  readonly terminalOutcome?: "observation_recorded" | "evidence_incomplete" | "recovery_candidate";
  readonly operationId?: string;
  readonly scenarioId?: string;
  readonly predecessorOperationId?: string;
}) {
  const terminal = input.stage === "terminal";
  const incomplete = input.terminalOutcome === "evidence_incomplete";
  const readingInventory = [
    ["zone-01", "North house air temperature", "71.5", "degF"],
    ["zone-02", "Propagation bench temperature", "68.0", "degF"],
    ["zone-03", "Greenhouse relative humidity", "68", "percent"],
    ["zone-04", "Irrigation reservoir level", "82", "percent"],
  ] as const;
  return {
    operationId: input.operationId ?? "operation-live-browser-001",
    resourceVersion: input.resourceVersion,
    stage: input.stage,
    terminal,
    terminalOutcome: input.terminalOutcome ?? null,
    scenarioId: input.scenarioId ?? "synthetic-normal",
    scenarioRevision: 2,
    provenance: "SIMULATED",
    transcript: terminal
      ? [
          {
            speaker: "device",
            text: "Four-zone greenhouse report.",
          },
        ]
      : [],
    evidence: terminal
      ? {
          quality: incomplete ? "invalid" : "complete",
          opaqueReference: "custody-ref-browser-001",
        }
      : null,
    readings: terminal
      ? readingInventory.map(([zoneId, label, value, unit], index) => ({
          zoneId,
          label,
          value: incomplete && index === 0 ? null : value,
          unit: incomplete && index === 0 ? null : unit,
          status: incomplete && index === 0 ? "UNKNOWN" : "OK",
          disposition: incomplete && index === 0 ? "ambiguous" : "grounded",
        }))
      : [],
    reconciliation: terminal
      ? readingInventory.map(([zoneId], index) => ({
          zoneId,
          disposition: incomplete && index === 0 ? "ambiguous" : "matched",
        }))
      : [],
    auxiliaryStatus: terminal
      ? {
          sound: incomplete ? "unknown" : "normal",
          power: "mains_available",
          battery: "normal",
          output: "off",
        }
      : null,
    predecessorOperationId: input.predecessorOperationId ?? null,
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

test("offers bounded live entry while deterministic replay remains default and no-answer stays replay-only", async ({
  page,
}) => {
  await enableLiveCapability(page);
  await page.goto("/simulator.html");

  await expect(page.getByRole("radio", { name: "Deterministic replay" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Live observation" })).toBeEnabled();
  await page.getByRole("radio", { name: "Live observation" }).check();
  await expect(
    page.getByText("pnpm simulator:authorize --scenario synthetic-normal"),
  ).toBeVisible();
  await expect(page.getByLabel("One-use permit")).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Run live observation" })).toBeDisabled();

  await page.getByRole("radio", { name: /^No-answer four-zone greenhouse lifecycle\b/u }).check();
  await expect(page.getByText(/replay-only/iu)).toBeVisible();
  await expect(page.getByRole("button", { name: "Run live observation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Replay simulated scenario" })).toBeEnabled();
});

test("one activation progresses to transcript-first completion and refresh recovery performs GET only", async ({
  page,
}) => {
  let postCount = 0;
  let getCount = 0;
  await enableLiveCapability(page);
  await page.route("**/api/v1/live-simulator/operations", async (route) => {
    postCount += 1;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      headers: {
        location: "/api/v1/live-simulator/operations/operation-live-browser-001",
        "retry-after": "1",
      },
      body: JSON.stringify({ operationId: "operation-live-browser-001", resourceVersion: 0 }),
    });
  });
  await page.route(
    "**/api/v1/live-simulator/operations/operation-live-browser-001",
    async (route) => {
      getCount += 1;
      const projection =
        getCount === 1
          ? liveProjection({ resourceVersion: 1, stage: "calling" })
          : liveProjection({
              resourceVersion: getCount + 1,
              stage: "terminal",
              terminalOutcome: "observation_recorded",
            });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(projection),
      });
    },
  );
  await page.goto("/simulator.html");
  await page.getByRole("radio", { name: "Live observation" }).check();
  await page.getByLabel("One-use permit").fill("browser-one-use-permit");
  await page.getByRole("button", { name: "Run live observation" }).click();

  await expect(page.getByRole("heading", { name: "Calling synthetic endpoint" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live simulated observation complete" }),
  ).toBeFocused();
  await expect(page.getByLabel("One-use permit")).toHaveValue("");
  await expect(page.getByText("operation-live-browser-001")).toBeVisible();
  await expect(page.locator('[data-provenance="simulated"]').last()).toContainText("SIMULATED");
  expect(
    await page
      .locator('[data-evidence-role="source-transcript"], [data-evidence-role="derived-readings"]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-evidence-role")),
      ),
  ).toEqual(["source-transcript", "derived-readings"]);
  expect(page.url()).not.toContain("browser-one-use-permit");
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain("browser-one-use-permit");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Live simulated observation complete" }),
  ).toBeVisible();
  expect(postCount).toBe(1);
  expect(getCount).toBeGreaterThan(1);
});

test("recovered abnormal identity is consumed before an explicitly authorized recovery run", async ({
  page,
}) => {
  const abnormalOperationId = "operation-abnormal-a";
  const recoveryOperationId = "operation-recovery-b";
  const submittedScenarios: string[] = [];
  let abnormalGetCount = 0;
  let recoveryGetCount = 0;
  await enableLiveCapability(page);
  await page.route("**/api/v1/live-simulator/operations", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    const body = request.postDataJSON() as { readonly scenarioId: string };
    submittedScenarios.push(body.scenarioId);
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      headers: {
        location: `/api/v1/live-simulator/operations/${recoveryOperationId}`,
      },
      body: JSON.stringify({ operationId: recoveryOperationId, resourceVersion: 0 }),
    });
  });
  await page.route(`**/api/v1/live-simulator/operations/${abnormalOperationId}`, async (route) => {
    abnormalGetCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        liveProjection({
          operationId: abnormalOperationId,
          scenarioId: "synthetic-abnormal",
          resourceVersion: 4,
          stage: "terminal",
          terminalOutcome: "observation_recorded",
        }),
      ),
    });
  });
  await page.route(`**/api/v1/live-simulator/operations/${recoveryOperationId}`, async (route) => {
    recoveryGetCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        liveProjection({
          operationId: recoveryOperationId,
          scenarioId: "synthetic-recovery",
          predecessorOperationId: abnormalOperationId,
          resourceVersion: 1,
          stage: "terminal",
          terminalOutcome: "recovery_candidate",
        }),
      ),
    });
  });

  await page.goto("/simulator.html");
  await page.evaluate(
    (identity) => {
      sessionStorage.setItem("muster.simulator.live-operation-id", JSON.stringify(identity));
    },
    {
      operationId: abnormalOperationId,
      scenarioId: "synthetic-abnormal",
      scenarioRevision: 2,
    },
  );
  await page.reload();

  await expect(page.getByText(abnormalOperationId)).toBeVisible();
  expect(abnormalGetCount).toBeGreaterThan(0);
  expect(submittedScenarios).toEqual([]);

  await page
    .getByRole("radio", { name: /^Recovery-candidate four-zone greenhouse report\b/u })
    .check();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("muster.simulator.live-operation-id")))
    .toBeNull();
  await page.getByLabel("Recovery predecessor operation ID").fill(abnormalOperationId);
  await page.getByLabel("One-use permit").fill("permit-for-recovery-b");
  await expect(page.getByRole("button", { name: "Run live observation" })).toBeEnabled();
  await page.getByRole("button", { name: "Run live observation" }).click();

  await expect(page.getByText(recoveryOperationId)).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Live simulated recovery observed—human confirmation required",
    }),
  ).toBeVisible();
  expect(recoveryGetCount).toBeGreaterThan(0);
  expect(submittedScenarios).toEqual(["synthetic-recovery"]);
});

test("preserves the last authoritative projection through dependency failure and GET-only retry", async ({
  page,
}) => {
  let getCount = 0;
  await enableLiveCapability(page);
  await page.route("**/api/v1/live-simulator/operations", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      headers: { location: "/api/v1/live-simulator/operations/operation-live-browser-001" },
      body: JSON.stringify({ operationId: "operation-live-browser-001", resourceVersion: 0 }),
    });
  });
  await page.route(
    "**/api/v1/live-simulator/operations/operation-live-browser-001",
    async (route) => {
      getCount += 1;
      if (getCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(liveProjection({ resourceVersion: 2, stage: "extracting" })),
        });
        return;
      }
      if (getCount === 2) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "dependency_unavailable",
              message: "Status is temporarily unavailable.",
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          liveProjection({
            resourceVersion: 3,
            stage: "terminal",
            terminalOutcome: "evidence_incomplete",
          }),
        ),
      });
    },
  );
  await page.goto("/simulator.html");
  await page.getByRole("radio", { name: "Live observation" }).check();
  await page.getByLabel("One-use permit").fill("permit-for-recovery-test");
  await page.getByRole("button", { name: "Run live observation" }).click();
  await expect(
    page.getByRole("heading", { name: "Interpreting retained transcript evidence" }),
  ).toBeVisible();
  await expect(page.getByText("operation-live-browser-001")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Status check interrupted");
  await expect(
    page.getByRole("region", { name: "Live observation result" }).getByText("2", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry status" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Live simulated observation incomplete—no operational decision made",
    }),
  ).toBeFocused();
  for (const label of [
    "North house air temperature",
    "Propagation bench temperature",
    "Greenhouse relative humidity",
    "Irrigation reservoir level",
  ]) {
    await expect(page.getByText(label, { exact: false }).last()).toBeVisible();
  }
  expect(getCount).toBe(3);
});

test("remains usable at 320px, 200%-equivalent layout, reduced motion, and forced colors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await enableLiveCapability(page);
  await page.goto("/simulator.html");
  await expect(page.getByRole("heading", { name: "Simulator Lab" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Live observation" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.setViewportSize({ width: 640, height: 720 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640);
  await page.getByRole("radio", { name: "Live observation" }).focus();
  await expect(page.getByRole("radio", { name: "Live observation" })).toBeFocused();
});
