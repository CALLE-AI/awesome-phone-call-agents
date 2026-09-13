import { fileURLToPath } from "node:url";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createDatabase } from "@/persistence/database";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);
const authBaseUrl = "http://localhost:3000/api/auth";

describe("Better Auth account flows", () => {
  let container: StartedPostgreSqlContainer;
  let client: Sql;
  let auth: Awaited<typeof import("@/auth")>["auth"];
  let developmentEmailLog: ReturnType<typeof vi.spyOn>;
  const originalEnvironment = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USERNAME: process.env.SMTP_USERNAME,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM: process.env.SMTP_FROM,
    SMTP_USE_TLS: process.env.SMTP_USE_TLS,
    SMTP_USE_SSL: process.env.SMTP_USE_SSL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FIELDCLOSE_AUTH_EMAIL_FROM:
      process.env.FIELDCLOSE_AUTH_EMAIL_FROM,
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("fieldclose_auth_test")
      .withUsername("fieldclose")
      .withPassword("fieldclose")
      .start();

    const database = createDatabase(container.getConnectionUri());
    client = database.client;
    await migrate(database.db, { migrationsFolder });

    process.env.DATABASE_URL = container.getConnectionUri();
    Reflect.set(process.env, "NODE_ENV", "test");
    process.env.BETTER_AUTH_SECRET =
      "fieldclose-auth-integration-secret-at-least-32-characters";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USERNAME;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USE_TLS;
    delete process.env.SMTP_USE_SSL;
    delete process.env.RESEND_API_KEY;
    delete process.env.FIELDCLOSE_AUTH_EMAIL_FROM;

    developmentEmailLog = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.resetModules();
    ({ auth } = await import("@/auth"));
  });

  afterAll(async () => {
    developmentEmailLog?.mockRestore();

    const globalDatabase = globalThis as typeof globalThis & {
      fieldCloseDatabase?: ReturnType<typeof createDatabase>;
    };
    await globalDatabase.fieldCloseDatabase?.client.end();
    delete globalDatabase.fieldCloseDatabase;
    await client?.end();
    await container?.stop();

    restoreEnvironment(originalEnvironment);
  });

  it("registers, verifies, and signs in with username or one-time email code", async () => {
    const email = "operator.auth-test@fieldclose.invalid";
    const username = "operator.auth";
    const password = "CorrectHorseBattery1!";

    developmentEmailLog.mockClear();
    const signup = await postAuth("/sign-up/email", {
      name: "Auth Test Operator",
      email,
      username,
      displayUsername: username,
      password,
      callbackURL: "/",
    });

    expect(signup.status).toBe(200);
    expect(await signup.json()).toMatchObject({ token: null });

    const verificationCode = readLatestDevelopmentCode(developmentEmailLog);
    const [storedVerification] = await client<
      { value: string }[]
    >`
      select value
      from verification
      where identifier like ${`%${email}%`}
      order by created_at desc
      limit 1
    `;

    expect(storedVerification?.value).not.toContain(verificationCode);
    expect(storedVerification?.value).toMatch(/^[A-Za-z0-9_-]+:0$/u);

    const verify = await postAuth("/email-otp/verify-email", {
      email,
      otp: verificationCode,
    });

    expect(verify.status).toBe(200);
    expect(verify.headers.get("set-cookie")).toContain(
      "fieldclose.session_token",
    );

    const [registeredUser] = await client<
      {
        email_verified: boolean;
        username: string | null;
        display_username: string | null;
      }[]
    >`
      select email_verified, username, display_username
      from "user"
      where email = ${email}
    `;

    expect(registeredUser).toEqual({
      email_verified: true,
      username,
      display_username: username,
    });

    const usernameSignIn = await postAuth("/sign-in/username", {
      username,
      password,
      rememberMe: true,
      callbackURL: "/",
    });

    expect(usernameSignIn.status).toBe(200);
    expect(usernameSignIn.headers.get("set-cookie")).toContain(
      "fieldclose.session_token",
    );

    vi.resetModules();
    ({ auth } = await import("@/auth"));

    const emailPasswordSignInAfterRestart = await postAuth("/sign-in/email", {
      email,
      password,
      rememberMe: true,
      callbackURL: "/",
    });

    expect(emailPasswordSignInAfterRestart.status).toBe(200);
    expect(emailPasswordSignInAfterRestart.headers.get("set-cookie")).toContain(
      "fieldclose.session_token",
    );

    const usernameSignInAfterRestart = await postAuth("/sign-in/username", {
      username,
      password,
      rememberMe: true,
      callbackURL: "/",
    });

    expect(usernameSignInAfterRestart.status).toBe(200);
    expect(usernameSignInAfterRestart.headers.get("set-cookie")).toContain(
      "fieldclose.session_token",
    );

    developmentEmailLog.mockClear();
    const requestCode = await postAuth("/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    });

    expect(requestCode.status).toBe(200);
    const signInCode = readLatestDevelopmentCode(developmentEmailLog);

    const codeSignIn = await postAuth("/sign-in/email-otp", {
      email,
      otp: signInCode,
    });

    expect(codeSignIn.status).toBe(200);
    expect(codeSignIn.headers.get("set-cookie")).toContain(
      "fieldclose.session_token",
    );

    const reusedCode = await postAuth("/sign-in/email-otp", {
      email,
      otp: signInCode,
    });

    expect(reusedCode.status).toBe(400);
  });

  async function postAuth(path: string, body: Record<string, unknown>) {
    return auth.handler(
      new Request(`${authBaseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify(body),
      }),
    );
  }
});

function readLatestDevelopmentCode(
  emailLog: { mock: { calls: unknown[][] } },
) {
  const message = emailLog.mock.calls
    .map((entries) => String(entries[0]))
    .reverse()
    .find((entry: string) =>
      entry.startsWith("[FieldClose development auth email]"),
    );
  const code = message?.match(/\b(\d{6})\b/u)?.[1];

  if (!code) {
    throw new Error("Expected a six-digit development authentication code.");
  }

  return code;
}

function restoreEnvironment(
  values: Record<string, string | undefined>,
) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
