import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export interface SimulatorHostKillSwitch {
  assertDispatchAllowed(): void;
}

export interface SimulatorHostConfiguration {
  readonly runtimeProfile: "development" | "test" | "ci";
  readonly enabled: true;
  readonly publicBaseUrl: string;
  readonly demoOrigin: string;
  readonly endpointAlias: string;
  readonly authorizationAudience: string;
  readonly callBudget: 1;
  readonly concurrency: 1;
  readonly timeoutMs: number;
  readonly providerTerminalTimeoutMs: number;
  readonly custodyRoot: string;
  readonly custodyMaxTranscriptBytes: number;
  readonly custodyMaxEntries: number;
  readonly connectionString: string;
  readonly jobsSchema: string;
  readonly organizationId: string;
  readonly listenHost: string;
  readonly listenPort: number;
  readonly apiToken: string;
  readonly targetAddress: string;
  readonly authorizedTargetDigest: string;
  readonly callbackIdentityHmacKey: string;
  readonly authorizationSigningKey: string;
  readonly twilioAuthToken: string;
  readonly killSwitch: SimulatorHostKillSwitch;
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const endpointAliasPattern = /^[a-z][a-z0-9-]{0,62}$/u;

function fail(): never {
  throw new Error("Simulator host configuration is invalid");
}

function required(environment: Readonly<Record<string, string | undefined>>, key: string): string {
  const value = environment[key]?.trim();
  if (value === undefined || value.length === 0) fail();
  return value;
}

function runtimeSecret(
  environment: Readonly<Record<string, string | undefined>>,
  directKey: string,
  fileKey: string,
): string {
  const direct = environment[directKey]?.trim();
  const reference = environment[fileKey]?.trim();
  if ((direct === undefined) === (reference === undefined)) fail();
  if (direct !== undefined) {
    if (direct.length === 0) fail();
    return direct;
  }
  if (reference === undefined || !isAbsolute(reference)) fail();
  try {
    const value = readFileSync(reference, "utf8");
    if (value.length === 0 || value.trim() !== value || value.includes("\n")) fail();
    return value;
  } catch {
    fail();
  }
}

function exactOne(value: string): 1 {
  if (value !== "1") fail();
  return 1;
}

function boundedInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) fail();
  return parsed;
}

function exactTarget(
  environment: Readonly<Record<string, string | undefined>>,
  alias: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(required(environment, "SIMULATOR_TARGET_ALLOWLIST_JSON"));
  } catch {
    fail();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) fail();
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (
    entries.length === 0 ||
    entries.some(
      ([key, value]) =>
        !endpointAliasPattern.test(key) ||
        typeof value !== "string" ||
        value.length === 0 ||
        value.trim() !== value ||
        value.length > 256,
    )
  ) {
    fail();
  }
  const target = (parsed as Record<string, unknown>)[alias];
  if (typeof target !== "string") fail();
  return target;
}

function createFileKillSwitch(filePath: string): SimulatorHostKillSwitch {
  if (!isAbsolute(filePath)) fail();
  return Object.freeze({
    assertDispatchAllowed(): void {
      try {
        if (readFileSync(filePath, "utf8") !== "ALLOW\n") {
          throw new Error("blocked");
        }
      } catch {
        throw new Error("Simulator host kill switch is active");
      }
    },
  });
}

export function loadSimulatorHostConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): SimulatorHostConfiguration {
  const runtimeProfile = environment["RUNTIME_PROFILE"];
  if (runtimeProfile !== "development" && runtimeProfile !== "test" && runtimeProfile !== "ci") {
    fail();
  }
  if (environment["SIMULATOR_HOST_ENABLED"] !== "true") fail();
  const publicBaseUrl = required(environment, "SIMULATOR_PUBLIC_BASE_URL");
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(publicBaseUrl);
  } catch {
    fail();
  }
  if (
    parsedBaseUrl.protocol !== "https:" ||
    parsedBaseUrl.username.length > 0 ||
    parsedBaseUrl.password.length > 0 ||
    parsedBaseUrl.search.length > 0 ||
    parsedBaseUrl.hash.length > 0 ||
    parsedBaseUrl.pathname !== "/" ||
    publicBaseUrl.endsWith("/")
  ) {
    fail();
  }
  const demoOrigin = required(environment, "SIMULATOR_DEMO_ORIGIN");
  let parsedDemoOrigin: URL;
  try {
    parsedDemoOrigin = new URL(demoOrigin);
  } catch {
    fail();
  }
  const loopbackHttp =
    parsedDemoOrigin.protocol === "http:" &&
    ["127.0.0.1", "::1", "localhost"].includes(parsedDemoOrigin.hostname);
  if (
    (parsedDemoOrigin.protocol !== "https:" && !loopbackHttp) ||
    parsedDemoOrigin.username.length > 0 ||
    parsedDemoOrigin.password.length > 0 ||
    parsedDemoOrigin.pathname !== "/" ||
    parsedDemoOrigin.search.length > 0 ||
    parsedDemoOrigin.hash.length > 0 ||
    parsedDemoOrigin.origin !== demoOrigin
  ) {
    fail();
  }
  const endpointAlias = required(environment, "SIMULATOR_ENDPOINT_ALIAS");
  const authorizationAudience = required(environment, "SIMULATOR_AUTHORIZATION_AUDIENCE");
  if (!endpointAliasPattern.test(endpointAlias) || !identifierPattern.test(authorizationAudience)) {
    fail();
  }
  const timeoutMs = Number(required(environment, "SIMULATOR_PROVIDER_TIMEOUT_MS"));
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) fail();
  const providerTerminalTimeoutMs = Number(
    required(environment, "SIMULATOR_PROVIDER_TERMINAL_TIMEOUT_MS"),
  );
  if (
    !Number.isSafeInteger(providerTerminalTimeoutMs) ||
    providerTerminalTimeoutMs < timeoutMs ||
    providerTerminalTimeoutMs > 180_000
  ) {
    fail();
  }

  const custodyRoot = required(environment, "SIMULATOR_CUSTODY_ROOT");
  const authorizationSigningKey = runtimeSecret(
    environment,
    "SIMULATOR_AUTHORIZATION_SIGNING_KEY",
    "SIMULATOR_AUTHORIZATION_SIGNING_KEY_FILE",
  );
  const callbackIdentityHmacKey = runtimeSecret(
    environment,
    "SIMULATOR_CALLBACK_IDENTITY_HMAC_KEY",
    "SIMULATOR_CALLBACK_IDENTITY_HMAC_KEY_FILE",
  );
  if (
    !isAbsolute(custodyRoot) ||
    Buffer.byteLength(authorizationSigningKey, "utf8") < 32 ||
    Buffer.byteLength(callbackIdentityHmacKey, "utf8") < 32
  ) {
    fail();
  }
  const jobsSchema = required(environment, "SIMULATOR_JOBS_SCHEMA");
  const organizationId = required(environment, "SIMULATOR_ORGANIZATION_ID");
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(jobsSchema) || !identifierPattern.test(organizationId)) {
    fail();
  }
  const listenHost = required(environment, "SIMULATOR_LISTEN_HOST");
  if (listenHost !== "127.0.0.1" && listenHost !== "::1" && listenHost !== "localhost") fail();

  const targetAddress = exactTarget(environment, endpointAlias);
  const digestIdentity = (value: string): string =>
    createHmac("sha256", callbackIdentityHmacKey).update(value, "utf8").digest("hex");
  return Object.freeze({
    runtimeProfile,
    enabled: true,
    publicBaseUrl,
    demoOrigin,
    endpointAlias,
    authorizationAudience,
    callBudget: exactOne(required(environment, "SIMULATOR_CALL_BUDGET")),
    concurrency: exactOne(required(environment, "SIMULATOR_CONCURRENCY")),
    timeoutMs,
    providerTerminalTimeoutMs,
    custodyRoot,
    custodyMaxTranscriptBytes: boundedInteger(
      required(environment, "SIMULATOR_CUSTODY_MAX_TRANSCRIPT_BYTES"),
      1,
      1_048_576,
    ),
    custodyMaxEntries: boundedInteger(
      required(environment, "SIMULATOR_CUSTODY_MAX_ENTRIES"),
      1,
      10_000,
    ),
    connectionString: required(environment, "DATABASE_URL"),
    jobsSchema,
    organizationId,
    listenHost,
    listenPort: boundedInteger(required(environment, "SIMULATOR_LISTEN_PORT"), 0, 65_535),
    apiToken: runtimeSecret(environment, "CALLE_API_KEY", "CALLE_API_KEY_FILE"),
    targetAddress,
    authorizedTargetDigest: digestIdentity(targetAddress),
    callbackIdentityHmacKey,
    authorizationSigningKey,
    twilioAuthToken: runtimeSecret(environment, "TWILIO_AUTH_TOKEN", "TWILIO_AUTH_TOKEN_FILE"),
    killSwitch: createFileKillSwitch(required(environment, "SIMULATOR_KILL_SWITCH_FILE")),
  });
}
