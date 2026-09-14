import { expect, test, type Page } from "@playwright/test";

interface RequestEvidence {
  readonly nonLocal: string[];
  readonly replay: string[];
  replayStarted: boolean;
}

const requestEvidence = new WeakMap<Page, RequestEvidence>();

function startReplayRequestCheck(page: Page): void {
  const evidence = requestEvidence.get(page);
  if (evidence === undefined) throw new Error("Request evidence was not initialized");
  evidence.replayStarted = true;
}

test.beforeEach(async ({ baseURL, page }) => {
  if (baseURL === undefined) throw new Error("Playwright base URL is required");
  const localOrigin = new URL(baseURL).origin;
  const evidence: RequestEvidence = { nonLocal: [], replay: [], replayStarted: false };
  requestEvidence.set(page, evidence);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== localOrigin) evidence.nonLocal.push(request.url());
    if (evidence.replayStarted) evidence.replay.push(request.url());
  });
  await page.goto("/simulator.html");
  await expect(page.getByText("No external call will be placed")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(requestEvidence.get(page)?.nonLocal, "Simulator Lab contacted a non-local origin").toEqual(
    [],
  );
  expect(requestEvidence.get(page)?.replay, "Replay initiated a network request").toEqual([]);
});

test("replays the abnormal fixture with visible evidence and honest provenance", async ({
  page,
}) => {
  await expect(page.getByRole("heading", { name: "Simulator Lab", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mode" })).toContainText("Deterministic replay");
  await expect(page.getByRole("region", { name: "Mode" })).toContainText(
    "Live observation is unavailable in this build. Deterministic replay remains available.",
  );
  await expect(
    page.getByLabel("Simulated data—not physical hardware evidence").first(),
  ).toContainText("SIMULATED");
  const abnormalScenario = page.getByRole("radio", {
    name: /^Abnormal four-zone greenhouse report\b/u,
  });
  await expect(abnormalScenario).toHaveAttribute("aria-describedby", /scenario-disclosure/iu);

  await abnormalScenario.check();
  startReplayRequestCheck(page);
  await page.getByRole("button", { name: "Replay simulated scenario" }).click();

  await expect(page.getByRole("heading", { name: "Threshold exceeded" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Run status" })).toContainText(
    "Interpretation recorded",
  );
  const evidence = page.getByRole("region", { name: "Evidence" });
  await expect(evidence).toContainText("95.0 degrees Fahrenheit");
  await expect(evidence).toContainText("91 percent");
  await expect(evidence).toContainText("Source span");
  await expect(page.getByRole("region", { name: "Result" })).toContainText(
    "Expected-zone reconciliation",
  );
  await expect(page.getByRole("region", { name: "Result" })).toContainText("simulator-tested");
  await expect(page.getByText(/does not prove physical hardware behavior/iu)).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Interpretation recorded");
  await expect(page.locator('[data-evidence-role="source"]')).toHaveCount(1);
  await expect(page.locator('[data-evidence-role="interpretation"]')).toHaveCount(1);
  expect(
    await page
      .locator('[data-evidence-role="source"], [data-evidence-role="interpretation"]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-evidence-role")),
      ),
  ).toEqual(["source", "interpretation"]);
});

test("keeps ambiguous evidence incomplete with no operational decision", async ({ page }) => {
  await page.getByRole("radio", { name: /^Ambiguous four-zone greenhouse report\b/u }).check();
  startReplayRequestCheck(page);
  await page.getByRole("button", { name: "Replay simulated scenario" }).click();

  const result = page.getByRole("region", { name: "Result" });
  await expect(
    result.getByRole("heading", {
      name: "Observation incomplete—no operational decision made",
    }),
  ).toBeFocused();
  await expect(result).toContainText("Zone 1 has contradictory values");
  await expect(result).toContainText("Low confidence");
  await expect(result).not.toContainText(/^Healthy$/u);
  await expect(result).not.toContainText(/^Normal$/u);
  await expect(page.getByRole("region", { name: "Evidence" })).toContainText("SIMULATED");
  await expect(page.getByRole("alert")).toContainText("No operational decision");
});
