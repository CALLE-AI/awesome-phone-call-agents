import { expect, test, type Page, type Route } from "@playwright/test";

const workspaceId = "10000000-0000-4000-8000-000000000101";
const caseId = "10000000-0000-4000-8000-000000000102";
const attemptId = "10000000-0000-4000-8000-000000000103";
const protectedWorkspaceId = "10000000-0000-4000-8000-000000000201";
const liveCaseId = "10000000-0000-4000-8000-000000000202";
const liveAttemptId = "10000000-0000-4000-8000-000000000203";
const now = "2026-07-29T08:30:00.000Z";

test("creates, approves, simulates, and closes a fictional case through human disposition", async ({
  page,
}) => {
  const fixtures = await installWorkflowFixtures(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/workspace/demo-e2e/cases/new");

  await expect(
    page.getByRole("heading", { level: 1, name: "Closeout cases" }),
  ).toBeVisible();
  await expect(page.getByText("Demo data only.")).toBeVisible();

  await page.getByLabel("Work-order reference").fill("WO-E2E-1042");
  await page.getByRole("button", { name: "Create demo case" }).click();
  await expect(page).toHaveURL(
    `/workspace/demo-e2e/cases/${caseId}`,
  );

  await expect(page.getByText("Exact call brief")).toBeVisible();
  const exactBrief = page.locator(".brief-document");
  await expect(
    exactBrief.getByText("site manager · +*******0142", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("FAKE / NO NETWORK")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page
    .getByLabel("This fictional contact is authorized for the demo.")
    .check();
  await page
    .getByLabel("I reviewed the exact purpose and questions.")
    .check();
  await page
    .getByLabel("I understand no real phone call will be placed.")
    .check();
  await page.getByRole("button", { name: "Approve fake attempt" }).click();

  await expect(
    page.getByRole("heading", {
      name: "Choose the conversation outcome to exercise.",
    }),
  ).toBeVisible();
  await expect(page.getByText("No phone call", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run approved simulation" }).click();

  await expect(
    page.getByText("Ready for human closeout review", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The fictional authorized site role reported normal operation and no unresolved issue or return-visit request.",
    ),
  ).toBeVisible();
  await expect(
    page.locator(".next-action").getByText("closeout review", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This resolves the current FieldClose task only."),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page
    .getByRole("button", { name: "Record human disposition" })
    .click();

  await expect(page.getByText("Human disposition recorded")).toBeVisible();
  const recordedDisposition = page.locator(".disposition-panel-complete");
  await expect(
    recordedDisposition.getByText("Closeout review accepted"),
  ).toBeVisible();
  await expect(page.getByText("Case v2", { exact: true })).toBeVisible();
  await expect(
    page.locator(".case-heading-status").getByText("closed", { exact: true }),
  ).toBeVisible();
  expect(fixtures.getDispositionRequestCount()).toBe(1);
  await expect(recordedDisposition).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "Open audit" }).click();
  await expect(page).toHaveURL(`/workspace/demo-e2e/audit/${caseId}`);
  await expect(page.getByText("Append-only evidence")).toBeVisible();
  const auditTimeline = page.locator(".audit-timeline");
  await expect(
    auditTimeline.getByText("Demo Dispatcher", { exact: true }),
  ).toHaveCount(2);
  await expect(
    auditTimeline.getByText("case · human disposition recorded", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    auditTimeline.getByText("user-e2e", { exact: true }),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.goBack();
  await expect(page).toHaveURL(`/workspace/demo-e2e/cases/${caseId}`);
});

test("identifies an invalid E.164 field before creating a case", async ({
  page,
}) => {
  await installWorkflowFixtures(page);
  await page.goto("/workspace/demo-e2e/cases/new");

  const phone = page.getByLabel("Fictional E.164 number");
  await phone.fill("123");
  await page.getByRole("button", { name: "Create demo case" }).click();

  await expect(phone).toBeFocused();
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Enter an explicit E.164 number such as +12025550142."),
  ).toBeVisible();
  await expect(page).toHaveURL("/workspace/demo-e2e/cases/new");
});

test("restores the fixed fictional preset without creating or approving a case", async ({
  page,
}) => {
  const fixtures = await installWorkflowFixtures(page);
  await page.goto("/workspace/demo-e2e/cases/new");

  const restorePreset = page.getByRole("button", {
    name: "Restore fictional preset",
  });
  const operatingStatus = page.getByRole("checkbox", {
    name: /Observed operating status/u,
  });
  const unresolvedIssue = page.getByRole("checkbox", {
    name: /Unresolved issue/u,
  });
  const returnVisit = page.getByRole("checkbox", {
    name: /Return-visit request/u,
  });

  await expect(restorePreset).toBeVisible();
  await page.getByLabel("Work-order reference").fill("CHANGED-WORK-ORDER");
  await page.getByLabel("Contractor display name").fill("Changed contractor");
  await page.getByLabel("Fictional site label").fill("Changed site");
  await page.getByLabel("IANA timezone").selectOption("Asia/Shanghai");
  await page.getByLabel("Fictional E.164 number").fill("+12025550199");
  await page.getByLabel("Service date").fill("2026-08-13");
  await page.getByLabel("Equipment label").fill("Changed equipment");
  await unresolvedIssue.uncheck();

  await restorePreset.click();

  await expect(page.getByLabel("Work-order reference")).toHaveValue(
    "WO-DEMO-1042",
  );
  await expect(page.getByLabel("Contractor display name")).toHaveValue(
    "Example HVAC",
  );
  await expect(page.getByLabel("Fictional site label")).toHaveValue(
    "Fictional North Store",
  );
  await expect(page.getByLabel("IANA timezone")).toHaveValue(
    "America/Chicago",
  );
  await expect(page.getByLabel("Fictional E.164 number")).toHaveValue(
    "+12025550142",
  );
  await expect(page.getByLabel("Service date")).toHaveValue("2026-07-27");
  await expect(page.getByLabel("Equipment label")).toHaveValue(
    "Rooftop unit RTU-2",
  );
  await expect(operatingStatus).toBeChecked();
  await expect(unresolvedIssue).toBeChecked();
  await expect(returnVisit).toBeChecked();
  await expect(page).toHaveURL("/workspace/demo-e2e/cases/new");
  expect(fixtures.getCreateCaseRequestCount()).toBe(0);
});

test("keeps case creation available and readable on tablet and mobile", async ({
  page,
}) => {
  await installWorkflowFixtures(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/workspace/demo-e2e/cases");
  await expect(page.locator(".rail-empty")).toBeVisible();
  await expect(page.locator(".empty-workspace")).toBeHidden();
  const mobileNewCase = page.getByRole("button", {
    name: "Create the first case",
  });
  await expect(mobileNewCase).toBeVisible();
  await mobileNewCase.click();
  await expect(page).toHaveURL("/workspace/demo-e2e/cases/new");
  await expect(page.getByLabel("Work-order reference")).toHaveValue(
    "WO-DEMO-1042",
  );
  await expect(
    page.getByRole("heading", { name: "Prepare the closeout brief" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1024, height: 900 });
  const panelWidth = await page.locator(".workspace-panel").evaluate(
    (panel) => panel.getBoundingClientRect().width,
  );
  expect(panelWidth).toBeGreaterThan(800);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Create demo case" }).click();
  await expect(page).toHaveURL(`/workspace/demo-e2e/cases/${caseId}`);
  await expect(page.getByText("Exact call brief")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("presents an empty exceptions queue as a resolved operational state", async ({
  page,
}) => {
  await installWorkflowFixtures(page);
  await page.goto("/workspace/demo-e2e/exceptions");

  const exceptionsQueue = page.getByRole("complementary", {
    name: "Exceptions queue",
  });
  await expect(exceptionsQueue).toBeVisible();
  await expect(exceptionsQueue.getByText("Queue clear")).toBeVisible();
  await expect(
    exceptionsQueue.getByRole("heading", {
      name: "No exceptions need attention.",
    }),
  ).toBeVisible();

  const allCasesLink = exceptionsQueue.getByRole("link", {
    name: "View all closeout cases",
  });
  await expect(allCasesLink).toHaveAttribute(
    "href",
    "/workspace/demo-e2e/cases",
  );

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(allCasesLink).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("keeps mobile sign-out available and returns to the public home", async ({
  page,
}) => {
  await installWorkflowFixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/demo-e2e/cases");

  const signOut = page.getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  await signOut.click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", {
      name: "Close every completed job. Keep every decision human.",
    }),
  ).toBeVisible();
});

test("settles invalid case and workspace routes into safe unavailable states", async ({
  page,
}) => {
  await installWorkflowFixtures(page);
  const missingCaseId = "10000000-0000-4000-8000-000000000199";
  await page.route(`**/api/cases/${missingCaseId}**`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 404,
      json: { error: { code: "case_not_found" } },
    });
  });

  await page.goto(`/workspace/demo-e2e/cases/${missingCaseId}`);
  await expect(
    page.getByRole("heading", { name: "Case unavailable" }),
  ).toBeVisible();
  await expect(page.getByText("Loading case record")).toHaveCount(0);
  await expect(page.locator(".global-error")).toHaveCount(0);

  const malformedCaseId = "not-a-valid-case-id";
  await page.route(`**/api/cases/${malformedCaseId}**`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 400,
      json: { error: { code: "invalid_request" } },
    });
  });
  await page.goto(`/workspace/demo-e2e/cases/${malformedCaseId}`);
  await expect(
    page.getByRole("heading", { name: "Case unavailable" }),
  ).toBeVisible();
  await expect(page.locator(".global-error")).toHaveCount(0);

  await page.goto("/workspace/missing-workspace/cases");
  await expect(
    page.getByText(
      "This workspace is unavailable or you do not have permission to open it.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New case" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create the first case" }),
  ).toHaveCount(0);
});

test("keeps a protected live call explicit from authorization through asynchronous acceptance", async ({
  page,
}) => {
  await installLiveWorkflowFixtures(page);
  await page.goto("/workspace/demo-live-e2e/cases/new");

  await page
    .getByLabel("Active workspace")
    .selectOption(protectedWorkspaceId);
  await expect(page.getByText("Protected live calls")).toBeVisible();
  await page.getByRole("button", { name: "New case" }).click();
  await expect(page.getByText("Live mode can place one real CALL-E")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore fictional preset" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Work-order reference")).toHaveValue(
    /^WO-LIVE-[A-F0-9]{8}$/u,
  );

  await page.getByLabel("Work-order reference").fill("WO-LIVE-E2E");
  await page.getByLabel("Contractor display name").fill("Authorized HVAC");
  await page.getByLabel("Site label").fill("Consenting test site");
  await page.getByLabel("IANA timezone").selectOption("Asia/Shanghai");
  await page
    .getByLabel("Contact display name")
    .fill("Consenting site manager");
  await page.getByLabel("Authorized E.164 number").fill("+442079460000");
  await page
    .getByLabel("Authorization record")
    .fill("The consenting test participant confirmed this exact call.");
  await page.getByLabel("Equipment label").fill("Test rooftop unit");
  await page
    .getByLabel("Internal technician completion note")
    .fill("Synthetic protected UI fixture.");
  await page
    .getByLabel("Exact reference text the agent may say")
    .fill("A technician visited the test rooftop unit yesterday.");
  await page.getByRole("button", { name: "Create protected case" }).click();
  await expect(
    page.getByText("Enter an explicit US E.164 number beginning with +1."),
  ).toBeVisible();
  await page.getByLabel("Authorized E.164 number").fill("+12025550142");
  await page.getByRole("button", { name: "Create protected case" }).click();

  await expect(page.getByText("LIVE / EXTERNAL EFFECT")).toBeVisible();
  await page
    .getByLabel(
      "This contact and closeout purpose are authorized by my organization.",
    )
    .check();
  await page
    .getByLabel("I reviewed the exact recipient, purpose, and questions.")
    .check();
  await page
    .getByLabel(
      "I authorize one real CALL-E phone call within the displayed window.",
    )
    .check();
  await page
    .getByLabel(
      "I confirmed the recipient consents to this authorized AI-assisted call.",
    )
    .check();
  await page
    .getByRole("button", { name: "Authorize one live attempt" })
    .click();

  await expect(
    page.getByRole("heading", {
      name: "One click can place the approved phone call.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Place one approved CALL-E call" })
    .click();

  await expect(
    page.getByRole("heading", {
      name: "Checking CALL-E status.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Status polling active")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh provider status" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Refresh provider status" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Provider status needs manual review.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Manual review required")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh provider status" }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", {
      name: "Provider status needs manual review.",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function installWorkflowFixtures(page: Page) {
  let stage: "empty" | "draft" | "approved" | "completed" | "closed" =
    "empty";
  let createCaseRequestCount = 0;
  let dispositionRequestCount = 0;

  await page.route("**/api/auth/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/sign-out")) {
      await route.fulfill({
        contentType: "application/json",
        json: { success: true },
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: {
        session: {
          id: "session-e2e",
          userId: "user-e2e",
          expiresAt: "2026-07-29T16:30:00.000Z",
          token: "opaque-e2e-session",
          createdAt: now,
          updatedAt: now,
        },
        user: {
          id: "user-e2e",
          name: "Demo Dispatcher",
          email: "dispatcher@fieldclose.invalid",
          emailVerified: true,
          image: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });

  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          workspaces: [
            {
              id: workspaceId,
              slug: "demo-e2e",
              displayName: "Demo Dispatcher demo",
              kind: "demo",
              provider: "fake",
              liveCallsAllowed: false,
              role: "owner",
            },
          ],
        },
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: {
        "workspace": {
          id: workspaceId,
          slug: "demo-e2e",
          displayName: "Demo Dispatcher demo",
          kind: "demo",
          provider: "fake",
          liveCallsAllowed: false,
          ownerUserId: "user-e2e",
          role: "owner",
        },
      },
    });
  });

  await page.route("**/api/cases**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/cases" && request.method() === "POST") {
      createCaseRequestCount += 1;
      stage = "draft";
      await route.fulfill({
        contentType: "application/json",
        status: 201,
        json: { case: { id: caseId }, contact: { phoneMasked: "+*******0142" } },
      });
      return;
    }

    if (url.pathname === "/api/cases" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { cases: stage === "empty" ? [] : [caseSummary(stage)] },
      });
      return;
    }

    if (url.pathname.endsWith("/preview")) {
      await route.fulfill({ contentType: "application/json", json: preview() });
      return;
    }

    if (url.pathname.endsWith("/approve")) {
      stage = "approved";
      await route.fulfill({
        contentType: "application/json",
        json: {
          attempt: {
            id: attemptId,
            caseId,
            providerTaskStatus: "not_created",
            attemptOutcome: "not_determined",
            creationDisposition: "not_requested",
          },
          approval: {
            id: "10000000-0000-4000-8000-000000000104",
            caseVersion: 1,
            approvedAt: now,
            briefHash: "b".repeat(64),
            liveCallApproved: false,
          },
          reused: false,
        },
      });
      return;
    }

    if (url.pathname.endsWith("/disposition")) {
      const body = request.postDataJSON() as {
        workspaceId: string;
        expectedCaseVersion: number;
        taskId: string;
        outcome: string;
        resolutionNote: string | null;
      };
      expect(body).toEqual({
        workspaceId,
        expectedCaseVersion: 1,
        taskId: "10000000-0000-4000-8000-000000000106",
        outcome: "closeout_accepted",
        resolutionNote: null,
      });
      dispositionRequestCount += 1;
      stage = "closed";
      await route.fulfill({
        contentType: "application/json",
        json: {
          disposition: {
            id: "10000000-0000-4000-8000-000000000108",
            caseId,
            taskId: "10000000-0000-4000-8000-000000000106",
            outcome: "closeout_accepted",
            resolutionNote: null,
            recordedBy: "user-e2e",
            recordedAt: now,
          },
          case: { id: caseId, status: "closed", version: 2, updatedAt: now },
          task: {
            id: "10000000-0000-4000-8000-000000000106",
            status: "resolved",
          },
          audit: {
            id: "10000000-0000-4000-8000-000000000109",
            eventType: "case.human_disposition_recorded",
            occurredAt: now,
          },
          reused: false,
        },
      });
      return;
    }

    if (url.pathname === `/api/cases/${caseId}`) {
      await route.fulfill({
        contentType: "application/json",
        json: caseDetail(stage),
      });
      return;
    }

    await route.abort("failed");
  });

  await page.route("**/api/attempts/**", async (route: Route) => {
    stage = "completed";
    await route.fulfill({
      contentType: "application/json",
      json: {
        execution: {
          state: "completed",
          attempt: {
            id: attemptId,
            caseId,
            providerCallId: `fake:resolved_clear:${attemptId}`,
            providerTaskStatus: "completed",
            attemptOutcome: "answered",
            creationDisposition: "created",
            errorCode: null,
          },
          result: {
            id: "10000000-0000-4000-8000-000000000105",
            route: "ready_for_closeout_review",
            summary: "Fixture result",
            validationFailed: false,
          },
        },
      },
    });
  });

  return {
    getCreateCaseRequestCount: () => createCaseRequestCount,
    getDispositionRequestCount: () => dispositionRequestCount,
  };
}

async function installLiveWorkflowFixtures(page: Page) {
  let stage:
    | "empty"
    | "draft"
    | "approved"
    | "calling"
    | "reconciliation" = "empty";

  await page.route("**/api/auth/**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        session: {
          id: "session-live-e2e",
          userId: "user-live-e2e",
          expiresAt: "2026-07-29T16:30:00.000Z",
          token: "opaque-live-e2e-session",
          createdAt: now,
          updatedAt: now,
        },
        user: {
          id: "user-live-e2e",
          name: "Protected Operator",
          email: "protected-operator@fieldclose.invalid",
          emailVerified: true,
          image: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });

  await page.route("**/api/workspaces", async (route) => {
    const demoWorkspace = {
      id: workspaceId,
      slug: "demo-live-e2e",
      displayName: "Protected Operator demo",
      kind: "demo",
      provider: "fake",
      liveCallsAllowed: false,
      role: "owner",
    };
    const protectedWorkspace = {
      id: protectedWorkspaceId,
      slug: "protected-live-e2e",
      displayName: "Authorized CALL-E workspace",
      kind: "protected",
      provider: "call_e",
      liveCallsAllowed: true,
      role: "owner",
    };

    await route.fulfill({
      contentType: "application/json",
      json:
        route.request().method() === "GET"
          ? { workspaces: [demoWorkspace, protectedWorkspace] }
          : { "workspace": demoWorkspace },
    });
  });

  await page.route("**/api/cases**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/cases" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        mode: string;
        case: {
          contact: {
            authorizationBasis: string;
            authorizationNote: string;
          };
        };
      };
      expect(body.mode).toBe("live");
      expect(body.case.contact.authorizationBasis).toBe(
        "contractor_provided_authorized_contact",
      );
      expect(body.case.contact.authorizationNote).toContain("consenting");
      stage = "draft";
      await route.fulfill({
        contentType: "application/json",
        status: 201,
        json: {
          case: { id: liveCaseId },
          contact: { phoneMasked: "+*******0142" },
        },
      });
      return;
    }

    if (url.pathname === "/api/cases" && request.method() === "GET") {
      const selectedWorkspaceId = url.searchParams.get("workspaceId");
      await route.fulfill({
        contentType: "application/json",
        json: {
          cases:
            selectedWorkspaceId === protectedWorkspaceId && stage !== "empty"
              ? [liveCaseSummary(stage)]
              : [],
        },
      });
      return;
    }

    if (url.pathname.endsWith("/preview")) {
      expect(url.searchParams.get("mode")).toBe("live");
      await route.fulfill({
        contentType: "application/json",
        json: livePreview(),
      });
      return;
    }

    if (url.pathname.endsWith("/approve")) {
      const body = request.postDataJSON() as {
        mode: string;
        approval: { operatorAttestations: string[] };
      };
      expect(body.mode).toBe("live");
      expect(body.approval.operatorAttestations).toHaveLength(4);
      stage = "approved";
      await route.fulfill({
        contentType: "application/json",
        json: {
          attempt: {
            id: liveAttemptId,
            caseId: liveCaseId,
            providerTaskStatus: "not_created",
            attemptOutcome: "not_determined",
            creationDisposition: "not_requested",
          },
          approval: {
            id: "10000000-0000-4000-8000-000000000204",
            caseVersion: 1,
            approvedAt: now,
            briefHash: "d".repeat(64),
            liveCallApproved: true,
          },
          reused: false,
        },
      });
      return;
    }

    if (url.pathname === `/api/cases/${liveCaseId}`) {
      await route.fulfill({
        contentType: "application/json",
        json: liveCaseDetail(stage),
      });
      return;
    }

    await route.abort("failed");
  });

  await page.route("**/api/attempts/**", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;

    if (new URL(route.request().url()).pathname.endsWith("/refresh")) {
      expect(body).toEqual({ workspaceId: protectedWorkspaceId });
      stage = "reconciliation";
      await route.fulfill({
        contentType: "application/json",
        json: {
          execution: {
            state: "reconciliation_required",
            attempt: {
              id: liveAttemptId,
              caseId: liveCaseId,
              providerCallId: "call_live_e2e",
              providerTaskStatus: "in_progress",
              attemptOutcome: "not_determined",
              creationDisposition: "created",
              errorCode: "provider_result_timeout",
            },
            result: null,
          },
        },
      });
      return;
    }

    expect(body).toEqual({
      workspaceId: protectedWorkspaceId,
      mode: "live",
    });
    stage = "calling";
    await route.fulfill({
      contentType: "application/json",
      json: {
        execution: {
          state: "in_progress",
          attempt: {
            id: liveAttemptId,
            caseId: liveCaseId,
            providerCallId: "call_live_e2e",
            providerTaskStatus: "queued",
            attemptOutcome: "not_determined",
            creationDisposition: "created",
            errorCode: null,
          },
          result: null,
        },
      },
    });
  });
}

function liveCaseSummary(
  stage: "draft" | "approved" | "calling" | "reconciliation",
) {
  return {
    id: liveCaseId,
    workspaceId: protectedWorkspaceId,
    version: 1,
    status: stage === "reconciliation" ? "needs_attention" : stage,
    workOrderRef: "WO-LIVE-E2E",
    contractorDisplayName: "Authorized HVAC",
    siteLabel: "Consenting test site",
    timezone: "America/Chicago",
    contactRole: "site_manager",
    phoneMasked: "+*******0142",
    currentAttemptId: stage === "draft" ? null : liveAttemptId,
    providerTaskStatus:
      stage === "calling" || stage === "reconciliation"
        ? "queued"
        : stage === "approved"
          ? "not_created"
          : null,
    attemptOutcome: stage === "draft" ? null : "not_determined",
    creationDisposition:
      stage === "calling" || stage === "reconciliation"
        ? "created"
        : stage === "approved"
          ? "not_requested"
          : null,
    createdAt: now,
    updatedAt: now,
  };
}

function livePreview() {
  return {
    preview: {
      caseId: liveCaseId,
      caseVersion: 1,
      mode: "live",
      provider: "call_e",
      briefHash: "d".repeat(64),
      requiredAttestations: [
        "contact_authorized",
        "brief_reviewed",
        "live_call_authorized",
        "recipient_consent_confirmed",
      ],
      brief: {
        contractorDisplayName: "Authorized HVAC",
        workOrderRef: "WO-LIVE-E2E",
        recipient: {
          nameOrRole: "Consenting site manager",
          phoneMasked: "+*******0142",
          timezone: "America/Chicago",
        },
        disclosure:
          "I am an AI assistant calling on behalf of Authorized HVAC.",
        objective:
          "Collect approved closeout information for work order WO-LIVE-E2E.",
        allowedReferenceText:
          "A technician visited the test rooftop unit yesterday.",
        questions: [
          "observed_operating_status",
          "unresolved_issue",
          "return_visit_request",
        ],
        prohibitedActions: [
          "diagnose_equipment",
          "quote_or_negotiate",
          "approve_work",
          "promise_arrival_time",
          "authorize_payment",
        ],
        voicemailPolicy: "do_not_leave",
        maxBoundedClarificationsPerQuestion: 1,
      },
    },
  };
}

function liveCaseDetail(
  stage: "empty" | "draft" | "approved" | "calling" | "reconciliation",
) {
  const attempt =
    stage === "approved" || stage === "calling" || stage === "reconciliation"
      ? {
          id: liveAttemptId,
          mode: "live",
          provider: "call_e",
          providerCallId: stage === "approved" ? null : "call_live_e2e",
          providerTaskStatus:
            stage === "approved" ? "not_created" : "queued",
          attemptOutcome: "not_determined",
          creationDisposition:
            stage === "approved" ? "not_requested" : "created",
          errorCode:
            stage === "reconciliation" ? "provider_result_timeout" : null,
          requestedAt: stage === "approved" ? null : now,
          acceptedAt: stage === "approved" ? null : now,
          approval: {
            approvedAt: now,
            approvedBy: "user-live-e2e",
            liveCallApproved: true,
            operatorAttestations: [
              "contact_authorized",
              "brief_reviewed",
              "live_call_authorized",
              "recipient_consent_confirmed",
            ],
          },
        }
      : null;

  return {
    case: {
      id: liveCaseId,
      workspaceId: protectedWorkspaceId,
      version: 1,
      status: stage === "reconciliation" ? "needs_attention" : stage,
      workOrderRef: "WO-LIVE-E2E",
      contractorDisplayName: "Authorized HVAC",
      siteLabel: "Consenting test site",
      timezone: "America/Chicago",
      requestedFields: [
        "observed_operating_status",
        "unresolved_issue",
        "return_visit_request",
      ],
      visitContext: {
        serviceDate: "2026-07-28",
        equipmentLabel: "Test rooftop unit",
        technicianCompletionNote: "Synthetic protected UI fixture.",
        allowedReferenceText:
          "A technician visited the test rooftop unit yesterday.",
      },
      currentAttemptId: attempt ? liveAttemptId : null,
      contact: {
        displayName: "Consenting site manager",
        role: "site_manager",
        phoneMasked: "+*******0142",
        authorizationBasis:
          "contractor_provided_authorized_contact",
        authorizationNote:
          "The consenting test participant confirmed this exact call.",
        doNotCallAt: null,
      },
    },
    attempt,
    result: null,
    tasks: [],
    disposition: null,
    audit: [],
  };
}

function caseSummary(stage: "draft" | "approved" | "completed" | "closed") {
  return {
    id: caseId,
    workspaceId,
    version: stage === "closed" ? 2 : 1,
    status: stage,
    workOrderRef: "WO-E2E-1042",
    contractorDisplayName: "Example HVAC",
    siteLabel: "Fictional North Store",
    timezone: "America/Chicago",
    contactRole: "site_manager",
    phoneMasked: "+*******0142",
    currentAttemptId: stage === "draft" ? null : attemptId,
    providerTaskStatus:
      stage === "completed" || stage === "closed"
        ? "completed"
        : stage === "approved"
          ? "not_created"
          : null,
    attemptOutcome:
      stage === "completed" || stage === "closed" ? "answered" : null,
    creationDisposition:
      stage === "completed" || stage === "closed"
        ? "created"
        : stage === "approved"
          ? "not_requested"
          : null,
    createdAt: now,
    updatedAt: now,
  };
}

function preview() {
  return {
    preview: {
      caseId,
      caseVersion: 1,
      mode: "fake",
      provider: "fake",
      briefHash: "b".repeat(64),
      brief: {
        contractorDisplayName: "Example HVAC",
        workOrderRef: "WO-E2E-1042",
        recipient: {
          nameOrRole: "site manager",
          phoneMasked: "+*******0142",
          timezone: "America/Chicago",
        },
        disclosure: "I am an AI assistant calling on behalf of Example HVAC.",
        objective: "Collect approved closeout information for work order WO-E2E-1042.",
        allowedReferenceText:
          "A fictional technician visited to service rooftop unit RTU-2.",
        questions: [
          "observed_operating_status",
          "unresolved_issue",
          "return_visit_request",
        ],
        prohibitedActions: [
          "diagnose_equipment",
          "quote_or_negotiate",
          "approve_work",
          "promise_arrival_time",
          "authorize_payment",
        ],
        voicemailPolicy: "do_not_leave",
        maxBoundedClarificationsPerQuestion: 1,
      },
    },
  };
}

function caseDetail(
  stage: "empty" | "draft" | "approved" | "completed" | "closed",
) {
  const attempt =
    stage === "approved" || stage === "completed" || stage === "closed"
      ? {
          id: attemptId,
          mode: "fake",
          provider: "fake",
          providerCallId:
            stage === "completed" || stage === "closed"
              ? `fake:resolved_clear:${attemptId}`
              : null,
          providerTaskStatus:
            stage === "completed" || stage === "closed"
              ? "completed"
              : "not_created",
          attemptOutcome:
            stage === "completed" || stage === "closed"
              ? "answered"
              : "not_determined",
          creationDisposition:
            stage === "completed" || stage === "closed"
              ? "created"
              : "not_requested",
          errorCode: null,
          approval: {
            approvedAt: now,
            approvedBy: "user-e2e",
            liveCallApproved: false,
            operatorAttestations: [
              "contact_authorized",
              "brief_reviewed",
              "fictional_demo_only",
            ],
          },
        }
      : null;
  const result =
    stage === "completed" || stage === "closed"
      ? {
          id: "10000000-0000-4000-8000-000000000105",
          providerTaskStatus: "completed",
          contactVerification: "authorized_role",
          observedOperatingStatus: "operating_as_expected",
          unresolvedIssue: {
            value: "no",
            confidence: "high",
            evidenceRefs: ["fake-provider:unresolved-issue"],
          },
          returnVisitRequested: {
            value: "no",
            confidence: "high",
            evidenceRefs: ["fake-provider:return-visit-request"],
          },
          preferredWindows: [],
          outOfScopeTopics: [],
          escalationReasons: [],
          summary:
            "The fictional authorized site role reported normal operation and no unresolved issue or return-visit request.",
          route: "ready_for_closeout_review",
          normalizedAt: now,
        }
      : null;

  return {
    case: {
      id: caseId,
      workspaceId,
      version: stage === "closed" ? 2 : 1,
      status: stage,
      workOrderRef: "WO-E2E-1042",
      contractorDisplayName: "Example HVAC",
      siteLabel: "Fictional North Store",
      timezone: "America/Chicago",
      requestedFields: [
        "observed_operating_status",
        "unresolved_issue",
        "return_visit_request",
      ],
      visitContext: {
        serviceDate: "2026-07-28",
        equipmentLabel: "Rooftop unit RTU-2",
        technicianCompletionNote: "Filter replaced and unit restarted",
        allowedReferenceText:
          "A fictional technician visited to service rooftop unit RTU-2.",
      },
      currentAttemptId: attempt ? attemptId : null,
      contact: {
        displayName: null,
        role: "site_manager",
        phoneMasked: "+*******0142",
        authorizationBasis: "demo_fixture",
        authorizationNote: "Fictional demo fixture.",
        doNotCallAt: null,
      },
    },
    attempt,
    result,
    tasks:
      stage === "completed" || stage === "closed"
        ? [
            {
              id: "10000000-0000-4000-8000-000000000106",
              type: "closeout_review",
              reasonCodes: ["normalized_result_ready"],
              status: stage === "closed" ? "resolved" : "open",
              assignedTo: stage === "closed" ? "user-e2e" : null,
              createdAt: now,
              resolvedAt: stage === "closed" ? now : null,
              resolutionNote: null,
            },
          ]
        : [],
    disposition:
      stage === "closed"
        ? {
            id: "10000000-0000-4000-8000-000000000108",
            taskId: "10000000-0000-4000-8000-000000000106",
            outcome: "closeout_accepted",
            resolutionNote: null,
            recordedBy: "user-e2e",
            recordedAt: now,
          }
        : null,
    audit: [
      {
        id: "10000000-0000-4000-8000-000000000107",
        actorType: "operator",
        actorId: "user-e2e",
        eventType: "case.created",
        occurredAt: now,
        metadata: {},
      },
      ...(stage === "closed"
        ? [
            {
              id: "10000000-0000-4000-8000-000000000109",
              actorType: "operator",
              actorId: "user-e2e",
              eventType: "case.human_disposition_recorded",
              occurredAt: now,
              metadata: {
                outcome: "closeout_accepted",
                taskStatus: "resolved",
              },
            },
          ]
        : []),
    ],
  };
}
