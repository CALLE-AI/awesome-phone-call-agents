import { expect, test } from "@playwright/test";

test("explains FieldClose before asking for an account", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("FieldClose");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "HVAC closeout command center",
    }),
  ).toBeVisible();
  await expect(page.getByText("Public demo · No phone call")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Explore demo workspace" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Work requiring operator attention",
    }),
  ).toBeAttached();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Closeout progress stays explicit",
    }),
  ).toBeAttached();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Every automated step is bounded",
    }),
  ).toBeAttached();
});

test("moves the public preview selection to the clicked section", async ({
  page,
}) => {
  await page.goto("/");

  const previewNavigation = page.getByRole("navigation", {
    name: "Operations preview",
  });
  const overviewLink = previewNavigation.getByRole("link", {
    name: "Overview",
  });
  const casesLink = previewNavigation.getByRole("link", {
    name: "Closeout cases",
  });
  const qualityLink = previewNavigation.getByRole("link", {
    name: "Quality review",
  });
  const publicNavigation = page.getByRole("navigation", {
    name: "Public navigation",
  });
  const publicOverviewLink = publicNavigation.getByRole("link", {
    name: "Overview",
  });
  const publicQueueLink = publicNavigation.getByRole("link", {
    name: "Case queue",
  });
  const publicWorkflowLink = publicNavigation.getByRole("link", {
    name: "Workflow",
  });

  await expect(overviewLink).toHaveAttribute("aria-current", "page");
  await casesLink.click();
  await expect(page).toHaveURL(/#queue$/u);
  await expect(casesLink).toHaveAttribute("aria-current", "page");
  await expect(overviewLink).not.toHaveAttribute("aria-current", "page");
  await expect(publicQueueLink).toHaveAttribute("aria-current", "page");
  await expect(publicOverviewLink).not.toHaveAttribute("aria-current", "page");

  await publicWorkflowLink.click();
  await expect(page).toHaveURL(/#workflow$/u);
  await expect(publicWorkflowLink).toHaveAttribute("aria-current", "page");
  await expect(qualityLink).toHaveAttribute("aria-current", "page");
});

test("keeps the public case queue complete without an inner desktop scrollbar", async ({
  page,
}) => {
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const queue = page.locator(".ops-table-wrap");
    await expect(queue).toBeVisible();
    expect(
      await queue.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
});

test("redirects the legacy project guide to the merged workflow", async ({
  page,
}) => {
  await page.goto("/about");

  await expect(page).toHaveURL(/\/#workflow$/u);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Closeout progress stays explicit",
    }),
  ).toBeVisible();
});

test("offers password, email-code, and account-registration paths in the drawer", async ({
  page,
}) => {
  await page.goto("/?auth=signin");

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Sign in to FieldClose" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email or username")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Email code" }).click();
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send sign-in code" }),
  ).toBeVisible();

  const createAccountTab = page.getByRole("tab", { name: "Create account" });
  await expect(createAccountTab).toHaveAttribute("type", "button");
  await expect(createAccountTab).toHaveCSS("text-transform", "uppercase");
  await expect(createAccountTab).toHaveCSS("text-decoration-line", "none");
  await page.evaluate(() => {
    document.documentElement.dataset.authTabTransition = "same-document";
  });
  await createAccountTab.click();
  await expect(page).toHaveURL("/?auth=signin");
  await expect(page.locator("html")).toHaveAttribute(
    "data-auth-tab-transition",
    "same-document",
  );
  const signInTab = page.getByRole("tab", { name: "Sign in" });
  await expect(signInTab).toHaveAttribute("type", "button");
  await signInTab.click();
  await expect(page).toHaveURL("/?auth=signin");
  await page.getByRole("tab", { name: "Create account" }).click();
  await expect(page).toHaveURL("/?auth=signin");
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();

  await page.route("**/api/auth/sign-up/email", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        token: null,
        user: {
          id: "auth-e2e-user",
          name: "Evaluator",
          email: "evaluator@example.com",
          emailVerified: false,
        },
      }),
    });
  });
  await page.getByLabel("Your name").fill("Evaluator");
  await page.getByLabel("Username").fill("evaluator");
  await page.getByLabel("Work email").fill("evaluator@example.com");
  await page.getByLabel("Password", { exact: true }).fill("ExamplePass123!");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resend verification code" }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
});

test("distinguishes unavailable account service from invalid password", async ({
  page,
}) => {
  await page.goto("/?auth=signin");
  await page.getByLabel("Email or username").fill("operator@example.com");
  await page.getByLabel("Password", { exact: true }).fill("ExamplePass123!");

  await page.route("**/api/auth/sign-in/email", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 503,
      body: JSON.stringify({
        code: "AUTH_SERVICE_UNAVAILABLE",
        message: "Account service unavailable",
      }),
    });
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".signin-error")).toHaveText(
    "The account service is temporarily unavailable. Your details are still in the form; try again in a moment.",
  );

  await page.unroute("**/api/auth/sign-in/email");
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 401,
      body: JSON.stringify({
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      }),
    });
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".signin-error")).toHaveText(
    "The email, username, or password did not match.",
  );
});

test("identifies and highlights only the registration fields that need attention", async ({
  page,
}) => {
  await page.goto("/?auth=signup");

  await page.getByLabel("Your name").fill("A");
  await page.getByLabel("Username").fill("not allowed");
  await page.getByLabel("Work email").fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.locator(".signin-error")).toContainText(
    "Your name, Username, Work email, and Password",
  );
  await expect(page.getByLabel("Your name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Username")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Work email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("#signup-password-help")).toHaveCount(0);
  await expect(page.locator("#signup-password-error")).toBeVisible();
  await expect(page.locator("#signup-username-error")).toContainText(
    "letters, numbers, dots, or underscores",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.getByLabel("Your name").fill("Evaluator");
  await page.getByLabel("Username").fill("evaluator");
  await page.getByLabel("Work email").fill("evaluator@example.com");
  await page.getByLabel("Password", { exact: true }).fill("ExamplePass123!");
  await expect(page.locator("#signup-password-help")).toBeVisible();

  await page.route("**/api/auth/sign-up/email", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 400,
      body: JSON.stringify({
        code: "USERNAME_IS_ALREADY_TAKEN",
        message: "Username is already taken",
      }),
    });
  });
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByLabel("Username")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("#signup-username-error")).toHaveText(
    "This username is already in use. Choose another.",
  );
  await expect(page.getByLabel("Work email")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );

  await page.unroute("**/api/auth/sign-up/email");
  await page.getByLabel("Username").fill("available_name");
  await page.route("**/api/auth/sign-up/email", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 500,
      body: JSON.stringify({
        code: "FAILED_TO_CREATE_USER",
        message: "Failed to create user",
      }),
    });
  });
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.locator(".signin-error")).toHaveText(
    "The account service could not complete this request. Your details are still in the form; try again in a moment.",
  );
  await expect(page.locator("[aria-invalid='true']")).toHaveCount(0);
});

test("supports URL-backed drawer close and mobile layout without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("summary[aria-label='Open navigation']").click();
  await page
    .getByRole("navigation", { name: "Mobile public navigation" })
    .getByRole("link", { name: "Sign in" })
    .click();

  await expect(page).toHaveURL("/?auth=signin");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto("/?auth=signin");
  const closeLink = page.getByRole("link", { name: "Close account access" });
  await expect(closeLink).toHaveAttribute("href", "/");
  await closeLink.click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto("/?auth=signin");
  await expect(
    page.getByRole("link", { name: "Close account access" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("dialog")).toBeHidden();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/?auth=signin");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
