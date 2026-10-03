import { Station, ConnectorType, CallLifecycleStatus, StationCallResult } from "./types";
import { buildTask, buildRecipientResultSchema } from "./callTask";

/**
 * Thrown for errors we can fully explain (missing/empty API key). The
 * caller can treat these as a definite, known outcome. Anything else that
 * escapes a provider call (network failure, an unexpected SDK exception)
 * is NOT wrapped in this and should be treated as an ambiguous/uncertain
 * outcome instead — see StationCheckState.outcomeUncertain.
 */
export class KnownCallError extends Error {}

export interface StartedCall {
  callId: string;
  provider: "calle" | "mock";
}

export interface CallSnapshot {
  status: CallLifecycleStatus;
  taskCompleted: boolean | null;
  completionConfidence: number | null;
  evidence: string[];
  /** Per-recipient structured result. null when CALL-E could not produce a schema-valid result. */
  structuredResult: StationCallResult | null;
  error?: string;
}

export interface CallProvider {
  readonly label: "calle" | "mock";
  startCheck(station: Station, connector: ConnectorType, apiKey?: string): Promise<StartedCall>;
  getSnapshot(callId: string, apiKey?: string): Promise<CallSnapshot>;
}

/**
 * Real CALL-E integration. Uses the documented Calls API contract:
 *   client.calls.create({ task, recipients, recipientResultSchema, metadata }, { idempotencyKey })
 *   client.calls.get(callId) / client.calls.waitForResult(...)
 * We create (not createAndWait) so the UI can show queued -> in_progress -> completed
 * status transitions live, per docs.heycall-e.com/calls#call-status.
 *
 * The @call-e/calle import is dynamic so the app runs (in demo mode) even in
 * environments where the package isn't installed yet.
 *
 * The API key is supplied by whoever is using the app, per request — never
 * read from a server-side env var, and never cached or persisted. This is
 * deliberate: it means a public deployment (e.g. on Vercel) needs no CALL-E
 * credential configured at all, and each visitor's live calls are billed to
 * their own CALL-E account, not the deploying developer's.
 */
export class CalleCallProvider implements CallProvider {
  readonly label = "calle" as const;

  private async getClient(apiKey?: string) {
    if (!apiKey || !apiKey.trim()) {
      throw new KnownCallError(
        "Enter your own CALL-E API key to place a live call (get one free at dashboard.heycall-e.com), or use demo mode.",
      );
    }
    const { CalleClient } = await import("@call-e/calle");
    return new CalleClient({ apiKey });
  }

  async startCheck(station: Station, connector: ConnectorType, apiKey?: string): Promise<StartedCall> {
    const client = await this.getClient(apiKey);
    const call = await client.calls.create(
      {
        task: buildTask(station, connector),
        recipients: [{ phones: [station.phone] }],
        recipientResultSchema: buildRecipientResultSchema(connector),
        metadata: {
          workflow: "chargecheck",
          station_id: station.id,
        },
      },
      {
        idempotencyKey: `chargecheck:${station.id}:${connector}:${todayKey()}`,
      },
    );
    return { callId: call.id, provider: "calle" };
  }

  async getSnapshot(callId: string, apiKey?: string): Promise<CallSnapshot> {
    const client = await this.getClient(apiKey);
    const call = await client.calls.get(callId);
    // The SDK types this as a generic JSON object since result schemas are
    // caller-defined; we know its shape matches StationCallResult because
    // we're the ones who supplied recipientResultSchema for this call.
    const recipientResult = (call.recipients?.[0]?.structuredResult ?? null) as StationCallResult | null;
    return {
      status: call.status,
      taskCompleted: call.taskCompleted ?? null,
      completionConfidence: call.completionConfidence?.score ?? null,
      evidence: call.evidence ?? [],
      structuredResult: recipientResult,
    };
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * DEMO / SIMULATION provider. Clearly labeled — never presented as a real call.
 * Simulates the same queued -> in_progress -> completed lifecycle over a
 * short, deterministic timeline per station so the UI and ranking logic can
 * be exercised end-to-end without dialing anyone.
 */
export class MockCallProvider implements CallProvider {
  readonly label = "mock" as const;

  private static SCRIPTS: Record<string, StationCallResult> = {
    "stn-a": {
      operational: "yes",
      available_chargers: 1,
      total_chargers: 2,
      requested_connector_available: "yes",
      queue_present: "no",
      estimated_wait_minutes: -1,
      price_per_kwh: "Rs 85/kWh",
      payment_requirements: "App required (GreenVolt app)",
      accessibility: "Accessible now",
      notes: "",
      answered_by: "human",
    },
    "stn-b": {
      operational: "no",
      available_chargers: -1,
      total_chargers: -1,
      requested_connector_available: "unknown",
      queue_present: "unknown",
      estimated_wait_minutes: -1,
      price_per_kwh: "",
      payment_requirements: "",
      accessibility: "",
      notes: "Charger reported out of service today.",
      answered_by: "human",
    },
    "stn-c": {
      operational: "yes",
      available_chargers: 0,
      total_chargers: 2,
      requested_connector_available: "no",
      queue_present: "yes",
      estimated_wait_minutes: 20,
      price_per_kwh: "Rs 80/kWh",
      payment_requirements: "Card or cash",
      accessibility: "Accessible, one vehicle waiting",
      notes: "Both chargers occupied; one vehicle waiting.",
      answered_by: "human",
    },
    "stn-d": {
      operational: "yes",
      available_chargers: 1,
      total_chargers: 1,
      requested_connector_available: "yes",
      queue_present: "no",
      estimated_wait_minutes: -1,
      price_per_kwh: "Rs 78/kWh",
      payment_requirements: "",
      accessibility: "Accessible now",
      notes: "",
      answered_by: "human",
    },
  };

  async startCheck(station: Station, _connector: ConnectorType, _apiKey?: string): Promise<StartedCall> {
    // No server-side state: the call id itself encodes stationId + start
    // time, so getSnapshot can compute elapsed time and outcome from the
    // id alone. This keeps the mock provider correct across separate
    // requests / dev-server module reloads / serverless invocations,
    // exactly like the real CALL-E provider (which is stateless by design
    // — status is always fetched fresh from CALL-E by callId).
    const callId = `mock_${station.id}_${Date.now()}`;
    return { callId, provider: "mock" };
  }

  async getSnapshot(callId: string, _apiKey?: string): Promise<CallSnapshot> {
    const parts = callId.split("_");
    if (parts[0] !== "mock" || parts.length < 3) {
      return {
        status: "failed",
        taskCompleted: false,
        completionConfidence: null,
        evidence: [],
        structuredResult: null,
        error: "Unrecognized mock call id",
      };
    }
    const stationId = parts[1];
    const startedAt = Number(parts[2]);
    const elapsed = Date.now() - startedAt;

    if (elapsed < 1500) {
      return {
        status: "queued",
        taskCompleted: null,
        completionConfidence: null,
        evidence: [],
        structuredResult: null,
      };
    }
    if (elapsed < 4000) {
      return {
        status: "in_progress",
        taskCompleted: null,
        completionConfidence: null,
        evidence: [],
        structuredResult: null,
      };
    }

    const scripted = MockCallProvider.SCRIPTS[stationId];
    return {
      status: "completed",
      taskCompleted: true,
      completionConfidence: 0.9,
      evidence: scripted?.notes ? [scripted.notes] : ["Recipient answered the availability questions."],
      structuredResult: scripted ?? null,
    };
  }
}

// Module-level singletons — stateless. Neither provider caches anything
// tied to a specific caller: the mock provider derives everything from the
// callId, and the real provider builds a fresh CalleClient from whatever
// apiKey is passed in on each call. That statelessness is what makes it
// safe to share these instances across requests from different users with
// different keys.
const sharedMockProvider = new MockCallProvider();
const sharedCalleProvider = new CalleCallProvider();

export function getCallProvider(demoMode: boolean): CallProvider {
  return demoMode ? sharedMockProvider : sharedCalleProvider;
}
