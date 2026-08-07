import { describe, expect, it } from "vitest";

import {
  parseServerEnvironment,
  resolveAuthTrustedOrigins,
  resolveAuthSecret,
} from "@/config/environment";

describe("server environment", () => {
  it("defaults an unconfigured environment to safe local demo values", () => {
    const environment = parseServerEnvironment({});

    expect(environment).toMatchObject({
      nodeEnvironment: "development",
      baseUrl: "http://localhost:3000",
      demoMode: true,
      liveCallsFlagEnabled: false,
      protectedOperatorEmails: [],
      githubOAuth: null,
      authEmail: null,
      callECredentialsConfigured: false,
      callE: null,
    });
  });

  it("treats blank optional secrets as absent", () => {
    const environment = parseServerEnvironment({
      BETTER_AUTH_SECRET: "",
      GITHUB_CLIENT_ID: "  ",
      GITHUB_CLIENT_SECRET: "",
      RESEND_API_KEY: "",
      FIELDCLOSE_AUTH_EMAIL_FROM: " ",
      CALL_E_API_KEY: "",
    });

    expect(environment.authSecret).toBeUndefined();
    expect(environment.githubOAuth).toBeNull();
    expect(environment.authEmail).toBeNull();
    expect(environment.callECredentialsConfigured).toBe(false);
    expect(environment.callE).toBeNull();
  });

  it("builds server-only CALL-E configuration from the API key", () => {
    const environment = parseServerEnvironment({
      FIELDCLOSE_PUBLIC_BASE_URL: "https://fieldclose.example",
      CALL_E_API_KEY: "test-api-key",
      CALL_E_BASE_URL: "https://api.heycall-e.example",
    });

    expect(environment.callE).toEqual({
      apiKey: "test-api-key",
      baseUrl: "https://api.heycall-e.example",
    });
  });

  it("normalizes a bounded protected-operator email allowlist", () => {
    const environment = parseServerEnvironment({
      FIELDCLOSE_PROTECTED_OPERATOR_EMAILS:
        " Owner@Example.com, operator@example.com ",
    });

    expect(environment.protectedOperatorEmails).toEqual([
      "owner@example.com",
      "operator@example.com",
    ]);
  });

  it("rejects malformed protected-operator email entries", () => {
    expect(() =>
      parseServerEnvironment({
        FIELDCLOSE_PROTECTED_OPERATOR_EMAILS: "owner@example.com,not-an-email",
      }),
    ).toThrow();
  });

  it("rejects partial GitHub OAuth configuration", () => {
    expect(() =>
      parseServerEnvironment({
        GITHUB_CLIENT_ID: "github-client-id",
      }),
    ).toThrow(/configured together/);
  });

  it("builds Resend email configuration only from a complete sender pair", () => {
    const environment = parseServerEnvironment({
      RESEND_API_KEY: "resend-test-api-key",
      FIELDCLOSE_AUTH_EMAIL_FROM: "FieldClose <access@fieldclose.example>",
    });

    expect(environment.authEmail).toEqual({
      provider: "resend",
      apiKey: "resend-test-api-key",
      from: "FieldClose <access@fieldclose.example>",
    });

    expect(() =>
      parseServerEnvironment({
        RESEND_API_KEY: "resend-test-api-key",
      }),
    ).toThrow(/configured together/);
  });

  it("builds SMTP email configuration with explicit TLS semantics", () => {
    const environment = parseServerEnvironment({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USERNAME: "access@example.com",
      SMTP_PASSWORD: "smtp-test-credential",
      SMTP_FROM: "FieldClose <access@example.com>",
      SMTP_USE_TLS: "true",
      SMTP_USE_SSL: "false",
    });

    expect(environment.authEmail).toEqual({
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      username: "access@example.com",
      password: "smtp-test-credential",
      from: "FieldClose <access@example.com>",
      useTls: true,
      useSsl: false,
    });
  });

  it("rejects partial, ambiguous, or conflicting SMTP configuration", () => {
    expect(() =>
      parseServerEnvironment({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
      }),
    ).toThrow(/must be configured together/);

    expect(() =>
      parseServerEnvironment({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USERNAME: "access@example.com",
        SMTP_PASSWORD: "smtp-test-credential",
        SMTP_FROM: "access@example.com",
        SMTP_USE_TLS: "true",
        SMTP_USE_SSL: "true",
      }),
    ).toThrow(/cannot both be true/);

    expect(() =>
      parseServerEnvironment({
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USERNAME: "access@example.com",
        SMTP_PASSWORD: "smtp-test-credential",
        SMTP_FROM: "access@example.com",
        RESEND_API_KEY: "resend-test-api-key",
        FIELDCLOSE_AUTH_EMAIL_FROM: "access@example.com",
      }),
    ).toThrow(/either SMTP delivery or Resend delivery/);
  });

  it("rejects unsafe base URL and non-PostgreSQL database schemes", () => {
    expect(() =>
      parseServerEnvironment({
        BETTER_AUTH_URL: "javascript:alert(1)",
      }),
    ).toThrow(/http or https/);
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "https://database.example.com",
      }),
    ).toThrow(/postgres or postgresql/);
  });

  it("uses a placeholder only outside production runtime", () => {
    const development = parseServerEnvironment({ NODE_ENV: "development" });
    const production = parseServerEnvironment({
      NODE_ENV: "production",
      DATABASE_URL:
        "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose",
      BETTER_AUTH_URL: "https://fieldclose.example",
    });

    expect(resolveAuthSecret(development)).toContain("development-only");
    expect(resolveAuthSecret(production)).toBeUndefined();
  });

  it("trusts only equivalent loopback origins during local development", () => {
    const development = parseServerEnvironment({
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://localhost:3001",
    });

    expect(resolveAuthTrustedOrigins(development)).toEqual([
      "http://localhost:3001",
      "http://127.0.0.1:3001",
    ]);
  });

  it("does not add loopback aliases outside development", () => {
    const production = parseServerEnvironment({
      NODE_ENV: "production",
      DATABASE_URL:
        "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose",
      BETTER_AUTH_URL: "https://fieldclose.example",
    });

    expect(resolveAuthTrustedOrigins(production)).toEqual([
      "https://fieldclose.example",
    ]);
  });

  it("requires an HTTPS base URL in production", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose",
        BETTER_AUTH_URL: "http://fieldclose.example",
      }),
    ).toThrow(/HTTPS in production/);

    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose",
        FIELDCLOSE_PUBLIC_BASE_URL: "http://fieldclose.example",
      }),
    ).toThrow(/HTTPS in production/);

    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose",
        BETTER_AUTH_URL: "https://fieldclose.example",
        CALL_E_API_KEY: "production-call-e-key",
        CALL_E_BASE_URL: "http://api.heycall-e.example",
      }),
    ).toThrow(/CALL_E_BASE_URL must use HTTPS in production/);

    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose",
      }),
    ).toThrow(/HTTPS BETTER_AUTH_URL or FIELDCLOSE_PUBLIC_BASE_URL/);
  });

  it("requires DATABASE_URL in production", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
        BETTER_AUTH_URL: "https://fieldclose.example",
      }),
    ).toThrow(/DATABASE_URL is required in production/);
  });

  it("requires TLS for SMTP delivery in production", () => {
    const base = {
      NODE_ENV: "production" as const,
      DATABASE_URL:
        "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose",
      BETTER_AUTH_URL: "https://fieldclose.example",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USERNAME: "access@example.com",
      SMTP_PASSWORD: "smtp-test-credential",
      SMTP_FROM: "access@example.com",
    };

    expect(() =>
      parseServerEnvironment({
        ...base,
        SMTP_USE_TLS: "false",
        SMTP_USE_SSL: "false",
      }),
    ).toThrow(/SMTP_USE_TLS or SMTP_USE_SSL in production/);

    expect(() =>
      parseServerEnvironment({
        ...base,
        SMTP_USE_TLS: "true",
        SMTP_USE_SSL: "false",
      }),
    ).not.toThrow();
  });

  it("allows HTTP base URLs outside production", () => {
    const development = parseServerEnvironment({
      NODE_ENV: "development",
      BETTER_AUTH_URL: "http://localhost:3000",
    });

    expect(development.baseUrl).toBe("http://localhost:3000");
    expect(development.databaseUrl).toBe(
      "postgresql://fieldclose:fieldclose@127.0.0.1:5432/fieldclose",
    );
  });
});
