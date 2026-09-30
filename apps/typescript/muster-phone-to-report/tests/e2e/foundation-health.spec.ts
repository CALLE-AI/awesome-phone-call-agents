import { expect, test } from "@playwright/test";

test("routes root to accessible Fleet Health and preserves an honest load failure", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("Playwright base URL is required");
  let available = true;
  await page.route("**/api/v1/fleet", async (route) => {
    if (!available) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "dependency_unavailable", message: "Fleet unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        contractVersion: "1",
        generatedAt: "2026-08-08T21:00:00.000Z",
        schedulerHeartbeat: {
          status: "current",
          observedAt: "2026-08-08T20:59:00.000Z",
          checkOutcome: "ready",
          evidenceKind: "foundation_health_job_completion",
        },
        endpoints: [],
      }),
    });
  });

  await page.goto("/");
  await expect(page).toHaveURL(new URL("/fleet", baseURL).href);
  await expect(page.getByLabel("Muster")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fleet Health", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scheduler heartbeat: Current" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No configured endpoints were found" }),
  ).toBeVisible();

  available = false;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Fleet Health is unavailable");
});
