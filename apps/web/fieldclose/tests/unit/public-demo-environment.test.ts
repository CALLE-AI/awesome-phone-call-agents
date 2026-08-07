import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const verifierPath = resolve(
  process.cwd(),
  "scripts/verify-public-demo-environment.mjs",
);

function safePublicDemoEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FIELDCLOSE_DEMO_MODE: "true",
    FIELDCLOSE_LIVE_CALLS_ENABLED: "false",
    FIELDCLOSE_PROTECTED_OPERATOR_EMAILS: "",
    CALL_E_API_KEY: "",
    DATABASE_URL:
      "postgresql://demo:password@ep-example-pooler.us-east-2.aws.neon.tech/fieldclose?sslmode=require",
    BETTER_AUTH_SECRET: "test-only-auth-secret-at-least-32-characters",
    BETTER_AUTH_URL: "https://fieldclose-demo.example.com",
    FIELDCLOSE_PUBLIC_BASE_URL: "https://fieldclose-demo.example.com",
    FIELDCLOSE_DATA_KEY: Buffer.alloc(32, 1).toString("base64"),
    FIELDCLOSE_LOOKUP_KEY: Buffer.alloc(32, 2).toString("base64"),
    FIELDCLOSE_PHONE_KEY_VERSION: "public-demo-v1",
    RESEND_API_KEY: "re_test_only",
    FIELDCLOSE_AUTH_EMAIL_FROM: "FieldClose <demo@example.com>",
    SMTP_HOST: "",
    SMTP_PORT: "",
    SMTP_USERNAME: "",
    SMTP_PASSWORD: "",
    SMTP_FROM: "",
    SMTP_USE_TLS: "false",
    SMTP_USE_SSL: "false",
  };
}

function runVerifier(environment: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [verifierPath], {
    encoding: "utf8",
    env: environment,
  });
}

describe("public fake-only deployment environment", () => {
  it("accepts a complete fake-only deployment configuration", () => {
    const result = runVerifier(safePublicDemoEnvironment());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Public fake-only deployment configuration is safe to build.",
    );
  });

  it("rejects CALL-E credentials in the public project", () => {
    const result = runVerifier({
      ...safePublicDemoEnvironment(),
      CALL_E_API_KEY: "must-not-deploy",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "CALL_E_API_KEY must be absent from the public demo.",
    );
  });
});
