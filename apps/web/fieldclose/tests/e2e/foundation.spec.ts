import { expect, test } from "@playwright/test";

test("explains FieldClose before asking for an account", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("FieldClose");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Close every completed job. Keep every decision human.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Public demo · No phone call placed"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Create demo workspace" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "One call, controlled end to end.",
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

test("moves the public navigation selection to the clicked section", async ({
  page,
}) => {
  await page.goto("/");

  const publicNavigation = page.getByRole("navigation", {
    name: "Public navigation",
  });
  const productLink = publicNavigation.getByRole("link", {
    name: "Product",
  });
  const workflowLink = publicNavigation.getByRole("link", {
    name: "Workflow",
  });
  const qualityLink = publicNavigation.getByRole("link", {
    name: "Quality",
  });
  const outcomesLink = publicNavigation.getByRole("link", {
    name: "Outcomes",
  });

  await expect(productLink).toHaveAttribute("aria-current", "page");
  await workflowLink.click();
  await expect(page).toHaveURL(/#workflow$/u);
  await expect(workflowLink).toHaveAttribute("aria-current", "page");
  await expect(productLink).not.toHaveAttribute("aria-current", "page");

  await qualityLink.click();
  await expect(page).toHaveURL(/#guardrails$/u);
  await expect(qualityLink).toHaveAttribute("aria-current", "page");

  await outcomesLink.click();
  await expect(page).toHaveURL(/#outcomes$/u);
  await expect(outcomesLink).toHaveAttribute("aria-current", "page");
});

test("keeps the public closeout preview complete without horizontal overflow", async ({
  page,
}) => {
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const preview = page.locator(".public-product-preview");
    await expect(preview).toBeVisible();
    expect(
      await preview.evaluate(
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

  const signInTab = page.getByRole("tab", { name: "Sign in" });
  const createAccountTab = page.getByRole("tab", { name: "Create workspace" });
  const passwordMethod = page.getByRole("button", { name: "Password" });
  const emailCodeMethod = page.getByRole("button", { name: "Email code" });

  await expect(signInTab).toHaveAttribute("aria-selected", "true");
  await expect(signInTab).toHaveAttribute("tabindex", "0");
  await expect(createAccountTab).toHaveAttribute("aria-selected", "false");
  await expect(createAccountTab).toHaveAttribute("tabindex", "-1");
  await expect(passwordMethod).toHaveAttribute("aria-pressed", "true");
  await expect(emailCodeMethod).toHaveAttribute("aria-pressed", "false");
  expect(
    await signInTab.evaluate(
      (element) => getComputedStyle(element, "::after").opacity,
    ),
  ).toBe("1");

  await emailCodeMethod.click();
  await expect(passwordMethod).toHaveAttribute("aria-pressed", "false");
  await expect(emailCodeMethod).toHaveAttribute("aria-pressed", "true");
  const activeMethodBackground = await emailCodeMethod.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const inactiveMethodBackground = await passwordMethod.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(activeMethodBackground).not.toBe(inactiveMethodBackground);
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send sign-in code" }),
  ).toBeVisible();

  await expect(createAccountTab).toHaveAttribute("type", "button");
  await expect(createAccountTab).toHaveCSS("text-transform", "uppercase");
  await expect(createAccountTab).toHaveCSS("text-decoration-line", "none");
  await page.evaluate(() => {
    document.documentElement.dataset.authTabTransition = "same-document";
  });
  await signInTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(createAccountTab).toBeFocused();
  await expect(createAccountTab).toHaveAttribute("aria-selected", "true");
  await expect(signInTab).toHaveAttribute("aria-selected", "false");
  await expect(page).toHaveURL("/?auth=signin");
  await expect(page.locator("html")).toHaveAttribute(
    "data-auth-tab-transition",
    "same-document",
  );
  await expect(signInTab).toHaveAttribute("type", "button");
  await page.keyboard.press("ArrowLeft");
  await expect(signInTab).toBeFocused();
  await expect(signInTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL("/?auth=signin");
  await page.getByRole("tab", { name: "Create workspace" }).click();
  await expect(page).toHaveURL("/?auth=signin");
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();

  await page.route("**/api/auth/sign-up/email", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      username?: string;
    };
    expect(requestBody.username).toMatch(/^[a-z0-9_.]{3,30}$/u);
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
  await page.getByLabel("Work email").fill("evaluator@example.com");
  await page.getByLabel("Password", { exact: true }).fill("ExamplePass123!");
  await expect(
    page.getByLabel("Password requirements").getByText("8–128 characters"),
  ).toHaveAttribute("data-met", "true");
  await page.getByRole("button", { name: "Create demo workspace" }).click();

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
  await page.getByLabel("Work email").fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create demo workspace" }).click();

  await expect(page.locator(".signin-error")).toContainText(
    "Your name, Work email, and Password",
  );
  await expect(page.getByLabel("Your name")).toHaveAttribute(
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
  await expect(page.locator("#signup-password-help")).toBeVisible();
  await expect(page.locator("#signup-password-error")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.getByLabel("Your name").fill("Evaluator");
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
  await page.getByRole("button", { name: "Create demo workspace" }).click();

  await expect(page.getByLabel("Work email")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.locator("#signup-email-error")).toHaveText(
    "An account identifier for this email is unavailable. Use another email.",
  );

  await page.unroute("**/api/auth/sign-up/email");
  await page.getByLabel("Work email").fill("another-evaluator@example.com");
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
  await page.getByRole("button", { name: "Create demo workspace" }).click();

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
