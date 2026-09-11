import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

import {
  createCalleAccountProbe,
  createLiveSmokePreflight,
  createProductionExclusionProbe,
  type LiveSmokePreflightProbe,
} from "./live-smoke-preflight.js";

const pass = Object.freeze({ outcome: "PASS" as const });
const blocked = Object.freeze({ outcome: "BLOCKED" as const });
const exactOrigin = /^https:\/\/[^/?#]+$/u;

export function persistentWebhookEnabled(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  const value = environment["SIMULATOR_PERSISTENT_WEBHOOK"];
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  throw new Error("Persistent webhook mode must be explicitly true or unset");
}

/** Read-only evidence for the configured resting policy; never updates a Twilio number. */
export async function verifyLiveSmokeRestingConfiguration(input: {
  readonly keepWebhook: boolean;
  readonly publicOrigin: string;
  readonly rejectUrl?: string;
  readonly readConfiguration: () => Promise<unknown>;
  readonly request: typeof fetch;
}): Promise<boolean> {
  try {
    if (input.keepWebhook) {
      if (!exactOrigin.test(input.publicOrigin)) return false;
      const health = await input.request(`${input.publicOrigin}/healthz`, {
        method: "GET",
        headers: { "ngrok-skip-browser-warning": "1" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!health.ok) return false;
      const value: unknown = await health.json();
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const result = value as Readonly<Record<string, unknown>>;
      if (
        result["ready"] !== true ||
        result["mode"] !== "persistent-demo" ||
        result["publicOrigin"] !== input.publicOrigin
      )
        return false;
    }
    const response = await input.readConfiguration();
    if (response === null || typeof response !== "object" || Array.isArray(response)) return false;
    const value = response as Readonly<Record<string, unknown>>;
    return input.keepWebhook
      ? value["voice_url"] === `${input.publicOrigin}/twilio/voice` &&
          value["status_callback"] === `${input.publicOrigin}/twilio/status` &&
          value["voice_method"] === "POST" &&
          value["status_callback_method"] === "POST"
      : input.rejectUrl !== undefined &&
          value["voice_url"] === input.rejectUrl &&
          (value["status_callback"] === null || value["status_callback"] === "");
  } catch {
    return false;
  }
}

export function resolveLiveSmokeRepositoryRoot(): string {
  return path.resolve(import.meta.dirname, "../../../..");
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0)
    throw new Error("preflight dependency unavailable");
  return value;
}

function probe(operation: () => boolean | Promise<boolean>): LiveSmokePreflightProbe {
  return async () => {
    try {
      return (await operation()) ? pass : blocked;
    } catch {
      return blocked;
    }
  };
}

async function secretReference(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): Promise<string> {
  const value = await readFile(required(environment, name), "utf8");
  if (value.length === 0 || value.trim() !== value || value.includes("\n")) {
    throw new Error("secret reference unavailable");
  }
  return value;
}

async function productionArtifacts(repositoryRoot: string) {
  const artifacts: Array<Readonly<{ path: string; content: string }>> = [];
  for (const application of ["api", "worker", "web"] as const) {
    const root = path.join(repositoryRoot, "apps", application, "dist");
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop();
      if (directory === undefined) break;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(absolute);
        else if (/\.(?:c?m?js|html|json)$/iu.test(entry.name)) {
          artifacts.push(
            Object.freeze({
              path: path.relative(repositoryRoot, absolute).replaceAll("\\", "/"),
              content: await readFile(absolute, "utf8"),
            }),
          );
        }
      }
    }
  }
  return Object.freeze(artifacts);
}

export function createRuntimeLiveSmokePreflight(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly request?: typeof fetch;
  readonly repositoryRoot?: string;
}) {
  const environment = input.environment;
  const keepWebhook = persistentWebhookEnabled(environment);
  const request = input.request ?? fetch;
  const publicOrigin = environment["SIMULATOR_PUBLIC_BASE_URL"]?.trim() ?? "";
  return createLiveSmokePreflight({
    ...(keepWebhook
      ? { twilioRestingConfigurationLabel: "Persistent webhook receiver and Twilio POST read-back" }
      : {}),
    probes: {
      runtimeSecretReferences: probe(async () => {
        await Promise.all(
          [
            "CALLE_API_KEY_FILE",
            "TWILIO_AUTH_TOKEN_FILE",
            "TWILIO_ACCOUNT_SID_FILE",
            "TWILIO_NUMBER_SID_FILE",
            "SIMULATOR_AUTHORIZATION_SIGNING_KEY_FILE",
            "SIMULATOR_CALLBACK_IDENTITY_HMAC_KEY_FILE",
          ].map(async (name) => await access(required(environment, name), constants.R_OK)),
        );
        return true;
      }),
      durableRepositories: probe(async () => {
        const pool = new Pool({ connectionString: required(environment, "DATABASE_URL"), max: 1 });
        try {
          const result = await pool.query<{ authorization: string | null; facts: string | null }>(
            `SELECT to_regclass('public.live_simulator_authorizations')::text AS authorization,
                    to_regclass('public.live_simulator_provider_facts')::text AS facts`,
          );
          await access(
            required(environment, "SIMULATOR_CUSTODY_ROOT"),
            constants.R_OK | constants.W_OK,
          );
          return result.rows[0]?.authorization !== null && result.rows[0]?.facts !== null;
        } finally {
          await pool.end();
        }
      }),
      runGateAndKillSwitch: probe(async () => {
        const [gate, kill] = await Promise.all([
          readFile(required(environment, "SIMULATOR_RUN_GATE_FILE"), "utf8"),
          readFile(required(environment, "SIMULATOR_KILL_SWITCH_FILE"), "utf8"),
        ]);
        return gate === "CLOSED\n" && kill === "ALLOW\n";
      }),
      publicOrigin: probe(() => exactOrigin.test(publicOrigin)),
      twilioRestingConfiguration: probe(async () => {
        return await verifyLiveSmokeRestingConfiguration({
          keepWebhook,
          publicOrigin,
          ...(!keepWebhook
            ? { rejectUrl: required(environment, "TWILIO_RESTING_REJECT_URL") }
            : {}),
          request,
          readConfiguration: async () => {
            const [accountSid, numberSid, authToken] = await Promise.all([
              secretReference(environment, "TWILIO_ACCOUNT_SID_FILE"),
              secretReference(environment, "TWILIO_NUMBER_SID_FILE"),
              secretReference(environment, "TWILIO_AUTH_TOKEN_FILE"),
            ]);
            const response = await request(
              `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(numberSid)}.json`,
              {
                method: "GET",
                headers: {
                  authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
                },
                signal: AbortSignal.timeout(5_000),
              },
            );
            if (!response.ok) throw new Error("Twilio configuration read-back is unavailable");
            return await response.json();
          },
        });
      }),
      providerAccounts: createCalleAccountProbe({
        apiOrigin: required(environment, "CALLE_API_ORIGIN"),
        resolveApiKey: async () => await secretReference(environment, "CALLE_API_KEY_FILE"),
        fetch: request,
      }),
      ngrokCapturePolicy: probe(async () => {
        const value = JSON.parse(
          await readFile(required(environment, "NGROK_CAPTURE_ATTESTATION_FILE"), "utf8"),
        ) as { publicOrigin?: unknown; captureBodies?: unknown; replayEnabled?: unknown };
        return (
          value.publicOrigin === publicOrigin &&
          value.captureBodies === false &&
          value.replayEnabled === false
        );
      }),
      traceAndSignatureConfiguration: probe(async () => {
        const [signingKey, callbackKey] = await Promise.all([
          secretReference(environment, "SIMULATOR_AUTHORIZATION_SIGNING_KEY_FILE"),
          secretReference(environment, "SIMULATOR_CALLBACK_IDENTITY_HMAC_KEY_FILE"),
        ]);
        return (
          signingKey.length >= 32 && callbackKey.length >= 32 && exactOrigin.test(publicOrigin)
        );
      }),
      authorizedIdentities: probe(async () => {
        const allowlist = JSON.parse(
          required(environment, "SIMULATOR_TARGET_ALLOWLIST_JSON"),
        ) as unknown;
        return (
          allowlist !== null &&
          typeof allowlist === "object" &&
          Object.hasOwn(allowlist, required(environment, "SIMULATOR_ENDPOINT_ALIAS"))
        );
      }),
      productionExclusion: createProductionExclusionProbe({
        readArtifacts: async () =>
          await productionArtifacts(input.repositoryRoot ?? resolveLiveSmokeRepositoryRoot()),
      }),
    },
  });
}

export async function runRuntimeLiveSmokePreflight(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const result = await createRuntimeLiveSmokePreflight({ environment }).run();
  process.stdout.write(`${result.title}\n${result.runGateLabel}\n${result.emergencyStopLabel}\n`);
  for (const check of result.checks) process.stdout.write(`${check.outcome} ${check.label}\n`);
  process.exitCode = result.outcome === "PASS" ? 0 : 1;
}
