import { z } from "zod";

import { resolveDatabaseUrl } from "@/config/database-url";

const localBaseUrl = "http://localhost:3000";
const productionCallEBaseUrl = "https://api.heycall-e.com";

const optionalText = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.string().trim().optional(),
);

const optionalHttpUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "must use http or https",
    })
    .optional(),
);

const optionalDatabaseUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z
    .url()
    .refine(
      (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      { message: "must use postgres or postgresql" },
    )
    .optional(),
);

const optionalEmailList = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.email()).max(20))
    .optional(),
);

const optionalEmailSender = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z
    .string()
    .trim()
    .max(320)
    .refine((value) => {
      const bracketedAddress = value.match(/<([^<>]+)>$/u)?.[1];
      return z.email().safeParse(bracketedAddress ?? value).success;
    }, "must be an email address or a Name <email@example.com> sender")
    .optional(),
);

const optionalPort = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.coerce.number().int().min(1).max(65_535).optional(),
);

const booleanText = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

const rawServerEnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: optionalDatabaseUrl,
    BETTER_AUTH_SECRET: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim().length === 0
          ? undefined
          : value,
      z.string().min(32).optional(),
    ),
    BETTER_AUTH_URL: optionalHttpUrl,
    FIELDCLOSE_PUBLIC_BASE_URL: optionalHttpUrl,
    GITHUB_CLIENT_ID: optionalText,
    GITHUB_CLIENT_SECRET: optionalText,
    RESEND_API_KEY: optionalText,
    FIELDCLOSE_AUTH_EMAIL_FROM: optionalEmailSender,
    SMTP_HOST: optionalText,
    SMTP_PORT: optionalPort,
    SMTP_USERNAME: optionalText,
    SMTP_PASSWORD: optionalText,
    SMTP_FROM: optionalEmailSender,
    SMTP_USE_TLS: booleanText("false"),
    SMTP_USE_SSL: booleanText("false"),
    FIELDCLOSE_PROTECTED_OPERATOR_EMAILS: optionalEmailList,
    FIELDCLOSE_DEMO_MODE: booleanText("true"),
    FIELDCLOSE_LIVE_CALLS_ENABLED: booleanText("false"),
    CALL_E_API_KEY: optionalText,
    CALL_E_BASE_URL: optionalHttpUrl,
  })
  .superRefine((environment, context) => {
    if (Boolean(environment.GITHUB_CLIENT_ID) !== Boolean(environment.GITHUB_CLIENT_SECRET)) {
      context.addIssue({
        code: "custom",
        message:
          "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be configured together",
        path: ["GITHUB_CLIENT_ID"],
      });
    }

    if (Boolean(environment.RESEND_API_KEY) !== Boolean(environment.FIELDCLOSE_AUTH_EMAIL_FROM)) {
      context.addIssue({
        code: "custom",
        message:
          "RESEND_API_KEY and FIELDCLOSE_AUTH_EMAIL_FROM must be configured together",
        path: ["RESEND_API_KEY"],
      });
    }

    const smtpFields = [
      environment.SMTP_HOST,
      environment.SMTP_PORT,
      environment.SMTP_USERNAME,
      environment.SMTP_PASSWORD,
      environment.SMTP_FROM,
    ];
    const configuredSmtpFieldCount = smtpFields.filter(
      (value) => value !== undefined,
    ).length;

    if (configuredSmtpFieldCount > 0 && configuredSmtpFieldCount < smtpFields.length) {
      context.addIssue({
        code: "custom",
        message:
          "SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM must be configured together",
        path: ["SMTP_HOST"],
      });
    }

    if (environment.SMTP_USE_TLS && environment.SMTP_USE_SSL) {
      context.addIssue({
        code: "custom",
        message: "SMTP_USE_TLS and SMTP_USE_SSL cannot both be true",
        path: ["SMTP_USE_TLS"],
      });
    }

    if (
      configuredSmtpFieldCount === smtpFields.length &&
      environment.RESEND_API_KEY &&
      environment.FIELDCLOSE_AUTH_EMAIL_FROM
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Configure either SMTP delivery or Resend delivery, not both",
        path: ["SMTP_HOST"],
      });
    }

    if (environment.NODE_ENV === "production") {
      const requireHttps = (value: string | undefined, field: string) => {
        if (value && new URL(value).protocol !== "https:") {
          context.addIssue({
            code: "custom",
            message: `${field} must use HTTPS in production`,
            path: [field],
          });
        }
      };

      requireHttps(environment.BETTER_AUTH_URL, "BETTER_AUTH_URL");
      requireHttps(
        environment.FIELDCLOSE_PUBLIC_BASE_URL,
        "FIELDCLOSE_PUBLIC_BASE_URL",
      );
      requireHttps(environment.CALL_E_BASE_URL, "CALL_E_BASE_URL");

      if (
        !environment.BETTER_AUTH_URL &&
        !environment.FIELDCLOSE_PUBLIC_BASE_URL
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Production requires an HTTPS BETTER_AUTH_URL or FIELDCLOSE_PUBLIC_BASE_URL",
          path: ["BETTER_AUTH_URL"],
        });
      }

      if (
        configuredSmtpFieldCount === smtpFields.length &&
        !environment.SMTP_USE_TLS &&
        !environment.SMTP_USE_SSL
      ) {
        context.addIssue({
          code: "custom",
          message:
            "SMTP delivery requires SMTP_USE_TLS or SMTP_USE_SSL in production",
          path: ["SMTP_HOST"],
        });
      }
    }
  });

export function parseServerEnvironment(
  source: Record<string, string | undefined>,
) {
  const environment = rawServerEnvironmentSchema.parse(source);
  const baseUrl =
    environment.BETTER_AUTH_URL ??
    environment.FIELDCLOSE_PUBLIC_BASE_URL ??
    localBaseUrl;

  return {
    nodeEnvironment: environment.NODE_ENV,
    databaseUrl: resolveDatabaseUrl(
      environment.DATABASE_URL,
      environment.NODE_ENV,
    ),
    baseUrl,
    authSecret: environment.BETTER_AUTH_SECRET,
    githubOAuth:
      environment.GITHUB_CLIENT_ID && environment.GITHUB_CLIENT_SECRET
        ? {
            clientId: environment.GITHUB_CLIENT_ID,
            clientSecret: environment.GITHUB_CLIENT_SECRET,
          }
        : null,
    authEmail:
      environment.SMTP_HOST &&
      environment.SMTP_PORT &&
      environment.SMTP_USERNAME &&
      environment.SMTP_PASSWORD &&
      environment.SMTP_FROM
        ? {
            provider: "smtp" as const,
            host: environment.SMTP_HOST,
            port: environment.SMTP_PORT,
            username: environment.SMTP_USERNAME,
            password: environment.SMTP_PASSWORD,
            from: environment.SMTP_FROM,
            useTls: environment.SMTP_USE_TLS,
            useSsl: environment.SMTP_USE_SSL,
          }
        : environment.RESEND_API_KEY && environment.FIELDCLOSE_AUTH_EMAIL_FROM
          ? {
            provider: "resend" as const,
            apiKey: environment.RESEND_API_KEY,
            from: environment.FIELDCLOSE_AUTH_EMAIL_FROM,
          }
        : null,
    protectedOperatorEmails:
      environment.FIELDCLOSE_PROTECTED_OPERATOR_EMAILS ?? [],
    demoMode: environment.FIELDCLOSE_DEMO_MODE,
    liveCallsFlagEnabled: environment.FIELDCLOSE_LIVE_CALLS_ENABLED,
    callECredentialsConfigured: Boolean(environment.CALL_E_API_KEY),
    callE: environment.CALL_E_API_KEY
      ? {
          apiKey: environment.CALL_E_API_KEY,
          baseUrl: environment.CALL_E_BASE_URL ?? productionCallEBaseUrl,
        }
      : null,
  } as const;
}

export type ServerEnvironment = ReturnType<typeof parseServerEnvironment>;

export function resolveAuthTrustedOrigins(environment: ServerEnvironment) {
  const origins = new Set([environment.baseUrl]);

  if (environment.nodeEnvironment === "development") {
    const baseUrl = new URL(environment.baseUrl);

    if (baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1") {
      const loopbackAlias = new URL(baseUrl);
      loopbackAlias.hostname =
        baseUrl.hostname === "localhost" ? "127.0.0.1" : "localhost";
      origins.add(loopbackAlias.origin);
    }
  }

  return [...origins];
}

const developmentAuthSecret =
  "fieldclose-development-only-secret-never-use-in-production";

export function resolveAuthSecret(environment: ServerEnvironment) {
  if (environment.authSecret) {
    return environment.authSecret;
  }

  if (environment.nodeEnvironment !== "production") {
    return developmentAuthSecret;
  }

  return undefined;
}
