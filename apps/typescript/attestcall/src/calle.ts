/**
 * CALL-E integration layer.
 *
 * This is the only module that talks to CALL-E. It uses the real
 * `@call-e/calle` SDK (`CalleClient.calls.createAndWait`) when running live,
 * and a deterministic fixture when running in demo mode so judges (and CI)
 * can exercise the full flow with ZERO live calls and no credentials.
 *
 * The live and demo paths return the exact same `Call` shape, so all
 * downstream logic (disposition, audit, dashboard) is identical.
 */
import { CalleClient, type Call, type CreateCallInput } from "@call-e/calle";
import { ATTESTATION_RESULT_SCHEMA, type AttestationRequest } from "./types.js";
import { buildAttestationTask } from "./attest.js";
import { loadFixture } from "./fixtures.js";

export interface CalleRunOptions {
  /** When true, no real call is placed; a deterministic fixture is returned. */
  demo: boolean;
  /** API key (required for live). */
  apiKey?: string;
  /** Base URL override (optional). */
  baseUrl?: string;
  /** Idempotency key derived from the authorization, not the attempt. */
  idempotencyKey: string;
  /** Which fixture scenario to use in demo mode. */
  fixtureScenario?: string;
  /** Poll timeout for live calls. */
  timeoutMs?: number;
}

/**
 * Place (or simulate) one attestation call and return CALL-E's Call result.
 */
export async function placeAttestationCall(
  request: AttestationRequest,
  options: CalleRunOptions,
): Promise<Call> {
  const task = buildAttestationTask(request);

  const input: CreateCallInput = {
    task,
    recipient: {
      phone: request.vendorPhone,
      region: request.region ?? "US",
      locale: request.locale ?? "en-US",
    },
    resultSchema: ATTESTATION_RESULT_SCHEMA as unknown as Record<string, unknown>,
    metadata: {
      app: "attestcall",
      framework: request.framework,
      vendor: request.vendorName,
      reference_id: request.referenceId ?? null,
    },
  };

  if (options.demo) {
    // Deterministic, no network, no credentials. Same shape as a live Call.
    return loadFixture(options.fixtureScenario ?? "compliant", request);
  }

  if (!options.apiKey) {
    throw new Error(
      "CALLE_API_KEY is required for live calls. Set DEMO_MODE=true to run without credentials.",
    );
  }

  const client = new CalleClient({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });

  // Real CALL-E invocation: creates the call, dials, and waits for a terminal result.
  const call = await client.calls.createAndWait(input, {
    idempotencyKey: options.idempotencyKey,
    timeoutMs: options.timeoutMs ?? 600_000,
  });

  return call;
}
