import { expect, test } from "@playwright/test";

const operationId = "operation-review-focus-001";
const cleanupPath = "/api/v1/live-demo-review/sessions/review-session-focus-001";

function terminalReviewProjection() {
  const inventory = [
    ["zone-01", "North house air temperature", "71.5", "degF"],
    ["zone-02", "Propagation bench temperature", "68.0", "degF"],
    ["zone-03", "Greenhouse relative humidity", "68", "percent"],
    ["zone-04", "Irrigation reservoir level", "82", "percent"],
  ] as const;
  const readings = inventory.map(([zoneId, label, value, unit]) => ({
    zoneId,
    label,
    value,
    unit,
    status: "OK",
    disposition: "grounded",
  }));
  return {
    operationId,
    resourceVersion: 7,
    stage: "terminal",
    terminal: true,
    terminalOutcome: "observation_recorded",
    scenarioId: "synthetic-normal",
    scenarioRevision: 2,
    provenance: "SIMULATED",
    transcript: [{ speaker: "device", text: "Synthetic protected transcript." }],
    evidence: { quality: "complete", opaqueReference: "opaque-custody" },
    readings,
    reconciliation: readings.map(({ zoneId }) => ({ zoneId, disposition: "matched" })),
    auxiliaryStatus: {
      sound: "normal",
      power: "mains_available",
      battery: "normal",
      output: "off",
    },
    predecessorOperationId: null,
  };
}

test("Finish purges the exact review tuple and moves focus to the announced cleanup outcome", async ({
  page,
}) => {
  await page.route("**/api/v1/live-simulator/capability", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: false,
        runtimeProfile: "development",
        supportedScenarioRevisions: [],
      }),
    });
  });
  await page.route(`**/api/v1/live-simulator/operations/${operationId}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "x-muster-review-capability": "closed",
        "x-muster-review-ready-at": "2099-09-02T12:00:00.000Z",
        "x-muster-review-expires-at": "2099-09-02T12:30:00.000Z",
        "x-muster-review-cleanup-path": cleanupPath,
      },
      body: JSON.stringify(terminalReviewProjection()),
    });
  });
  await page.route(`**${cleanupPath}`, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ outcome: "deleted", message: "Protected demo result deleted" }),
    });
  });

  await page.goto(
    `/simulator.html#operationId=${operationId}&scenarioId=synthetic-normal&scenarioRevision=2`,
  );
  const finish = page.getByRole("button", { name: "Finish demo and delete result" });
  await expect(finish).toBeVisible();
  await finish.focus();
  await expect(finish).toBeFocused();
  await finish.click();

  await expect(page.getByRole("heading", { name: "Protected demo result deleted" })).toBeFocused();
  await expect(page.getByText("Synthetic protected transcript.")).toHaveCount(0);
  await expect(finish).toHaveCount(0);
  await expect
    .poll(
      async () =>
        await page.evaluate(() => ({
          operation: sessionStorage.getItem("muster.simulator.live-operation-id"),
          expected: sessionStorage.getItem("muster.simulator.live-demo-review-expected"),
        })),
    )
    .toEqual({ operation: null, expected: null });
});
