import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readExampleEnvironment() {
  const source = readFileSync(
    new URL("../../.env.example", import.meta.url),
    "utf8",
  );

  return new Map(
    source
      .split(/\r?\n/u)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/u.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

describe("example environment contract", () => {
  it("defaults the demo to fake-only operation", () => {
    const environment = readExampleEnvironment();

    expect(environment.get("FIELDCLOSE_DEMO_MODE")).toBe("true");
    expect(environment.get("FIELDCLOSE_LIVE_CALLS_ENABLED")).toBe("false");
  });

  it("does not commit authentication, provider, or cryptographic secrets", () => {
    const environment = readExampleEnvironment();

    expect(environment.get("BETTER_AUTH_SECRET")).toBe("");
    expect(environment.get("GITHUB_CLIENT_ID")).toBe("");
    expect(environment.get("GITHUB_CLIENT_SECRET")).toBe("");
    expect(environment.get("SMTP_HOST")).toBe("");
    expect(environment.get("SMTP_PORT")).toBe("");
    expect(environment.get("SMTP_USERNAME")).toBe("");
    expect(environment.get("SMTP_PASSWORD")).toBe("");
    expect(environment.get("SMTP_FROM")).toBe("");
    expect(environment.get("RESEND_API_KEY")).toBe("");
    expect(environment.get("FIELDCLOSE_AUTH_EMAIL_FROM")).toBe("");
    expect(environment.get("CALL_E_API_KEY")).toBe("");
    expect(environment.has("CALL_E_WEBHOOK_SECRET")).toBe(false);
    expect(environment.get("FIELDCLOSE_DATA_KEY")).toBe("");
    expect(environment.get("FIELDCLOSE_LOOKUP_KEY")).toBe("");
  });

  it("does not expose live-call configuration to browser bundles", () => {
    const environment = readExampleEnvironment();
    const browserVisibleKeys = [...environment.keys()].filter((key) =>
      key.startsWith("NEXT_PUBLIC_"),
    );

    expect(browserVisibleKeys).not.toContain("NEXT_PUBLIC_CALL_E_API_KEY");
    expect(browserVisibleKeys).not.toContain(
      "NEXT_PUBLIC_FIELDCLOSE_LIVE_CALLS_ENABLED",
    );
  });
});
