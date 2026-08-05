import { Buffer } from "node:buffer";

const smtpKeys = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "SMTP_FROM",
];

function text(source, key) {
  return source[key]?.trim() ?? "";
}

function isRootHttpsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function readOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isRemotePostgresUrl(value) {
  try {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      Boolean(url.username) &&
      Boolean(url.hostname) &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function requiresCertificateVerifiedDatabaseTls(value) {
  try {
    const sslModes = new URL(value).searchParams.getAll("sslmode");
    return (
      sslModes.length === 1 && sslModes[0]?.toLowerCase() === "verify-full"
    );
  } catch {
    return false;
  }
}

function isBase64Key(value) {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
    return false;
  }

  return Buffer.from(value, "base64").byteLength === 32;
}

export function validatePublicDemoEnvironment(source) {
  const errors = [];
  const authUrl = text(source, "BETTER_AUTH_URL");
  const publicUrl = text(source, "FIELDCLOSE_PUBLIC_BASE_URL");
  const dataKey = text(source, "FIELDCLOSE_DATA_KEY");
  const lookupKey = text(source, "FIELDCLOSE_LOOKUP_KEY");

  if (text(source, "FIELDCLOSE_DEMO_MODE") !== "true") {
    errors.push("FIELDCLOSE_DEMO_MODE must be exactly true.");
  }
  if (text(source, "FIELDCLOSE_LIVE_CALLS_ENABLED") !== "false") {
    errors.push("FIELDCLOSE_LIVE_CALLS_ENABLED must be exactly false.");
  }
  if (text(source, "CALL_E_API_KEY")) {
    errors.push("CALL_E_API_KEY must be absent from the public demo.");
  }
  if (text(source, "FIELDCLOSE_PROTECTED_OPERATOR_EMAILS")) {
    errors.push(
      "FIELDCLOSE_PROTECTED_OPERATOR_EMAILS must be empty in the public demo.",
    );
  }

  const databaseUrl = text(source, "DATABASE_URL");
  if (!isRemotePostgresUrl(databaseUrl)) {
    errors.push("DATABASE_URL must be a remote PostgreSQL connection URL.");
  } else if (!requiresCertificateVerifiedDatabaseTls(databaseUrl)) {
    errors.push("DATABASE_URL must require certificate-verified TLS.");
  }
  if (text(source, "BETTER_AUTH_SECRET").length < 32) {
    errors.push("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  if (!isRootHttpsUrl(authUrl)) {
    errors.push("BETTER_AUTH_URL must be the root of an HTTPS origin.");
  }
  if (!isRootHttpsUrl(publicUrl)) {
    errors.push(
      "FIELDCLOSE_PUBLIC_BASE_URL must be the root of an HTTPS origin.",
    );
  }
  const authOrigin = readOrigin(authUrl);
  const publicOrigin = readOrigin(publicUrl);
  if (authOrigin && publicOrigin && authOrigin !== publicOrigin) {
    errors.push(
      "BETTER_AUTH_URL and FIELDCLOSE_PUBLIC_BASE_URL must use the same origin.",
    );
  }

  if (!isBase64Key(dataKey)) {
    errors.push("FIELDCLOSE_DATA_KEY must be a base64-encoded 32-byte key.");
  }
  if (!isBase64Key(lookupKey)) {
    errors.push("FIELDCLOSE_LOOKUP_KEY must be a base64-encoded 32-byte key.");
  }
  if (dataKey && lookupKey && dataKey === lookupKey) {
    errors.push("FIELDCLOSE_DATA_KEY and FIELDCLOSE_LOOKUP_KEY must differ.");
  }
  if (!text(source, "FIELDCLOSE_PHONE_KEY_VERSION")) {
    errors.push("FIELDCLOSE_PHONE_KEY_VERSION must be set.");
  }

  const configuredSmtpFields = smtpKeys.filter((key) => text(source, key));
  const resendConfigured = Boolean(text(source, "RESEND_API_KEY"));
  const resendFromConfigured = Boolean(
    text(source, "FIELDCLOSE_AUTH_EMAIL_FROM"),
  );
  const completeSmtp = configuredSmtpFields.length === smtpKeys.length;
  const completeResend = resendConfigured && resendFromConfigured;

  if (configuredSmtpFields.length > 0 && !completeSmtp) {
    errors.push("The public demo SMTP configuration is incomplete.");
  }
  if (resendConfigured !== resendFromConfigured) {
    errors.push("The public demo Resend configuration is incomplete.");
  }
  if (completeSmtp === completeResend) {
    errors.push(
      "Configure exactly one public-demo email provider: SMTP or Resend.",
    );
  }

  return errors;
}

const errors = validatePublicDemoEnvironment(process.env);

if (errors.length) {
  console.error("Public fake-only deployment configuration is not safe:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Public fake-only deployment configuration is safe to build.");
}
