/**
 * The operator timeline outlives any one Edge Function invocation. Each call
 * transition writes one append-only row, which makes a run legible without
 * relying on scattered function logs.
 */

export const CALL_EVENT_KINDS = [
  "materialised",
  "claimed",
  "dispatched",
  "polled",
  "webhook_received",
  "refetched",
  "ingested",
  "finalised",
] as const;

export type CallEventKind = typeof CALL_EVENT_KINDS[number];
export type CallEventDetail = Record<string, JsonValue>;
export type JsonValue = string | number | boolean | null | JsonValue[] | {
  [key: string]: JsonValue;
};

export type EventDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  fetch: typeof fetch;
};

function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.includes("supabase.co")) {
    throw new Error("must use ORMA_API_URL, not project host");
  }
  return base;
}

function eventHeaders(serviceRoleKey: string): HeadersInit {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    prefer: "return=minimal",
  };
}

function isEventKind(value: string): value is CallEventKind {
  return (CALL_EVENT_KINDS as readonly string[]).includes(value);
}

function nonBlankString(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFailureState(state: string): boolean {
  return /(?:fail|error|cancel)/i.test(state);
}

function assertTerminalDetail(detail: CallEventDetail): void {
  if (!nonBlankString(detail.state)) {
    throw new Error("finalised call event requires a terminal state");
  }

  if (isFailureState(detail.state) && !nonBlankString(detail.failure_reason)) {
    throw new Error("failed finalised call event requires a failure reason");
  }
}

/**
 * A materialised row explains why the run exists. The slot and the instant are
 * the two facts the materialiser decided, and a reader cannot name either
 * without them.
 */
function assertMaterialisedDetail(detail: CallEventDetail): void {
  if (!nonBlankString(detail.slot_id)) {
    throw new Error("materialised call event requires a slot id");
  }
  if (!nonBlankString(detail.scheduled_for)) {
    throw new Error("materialised call event requires the scheduled instant");
  }
}

/** Attempts one append makes before the caller hears about the failure. */
export const EVENT_APPEND_ATTEMPTS = 3;

/** The pause between those attempts, short enough to sit inside one tick. */
export const EVENT_APPEND_WAIT_MS = 250;

/** Injected so the checks run without a real pause. */
export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Appends the transition to the run's timeline.
 *
 * Callers must include the provider identifier, state, failure reason, or
 * other durable observation that explains this transition. Never put secrets
 * or unmasked numbers here.
 *
 * The append is retried twice more before the caller hears about it, so one
 * lost request does not lose the row and the failure still throws once the
 * attempts are spent. It is not exactly once. A request that landed while its
 * response was lost appends a second row, because `call_events` carries no key
 * that could refuse it.
 */
export async function recordCallEvent(
  callRunId: string,
  kind: CallEventKind,
  detail: CallEventDetail,
  deps: EventDeps,
  sleep: Sleep = defaultSleep,
): Promise<void> {
  if (!callRunId) throw new Error("call event requires a call run id");
  if (!isEventKind(kind)) {
    throw new Error(`unsupported call event kind: ${kind}`);
  }
  if (kind === "finalised") assertTerminalDetail(detail);
  if (kind === "materialised") assertMaterialisedDetail(detail);

  let lastError: unknown;
  for (let attempt = 1; attempt <= EVENT_APPEND_ATTEMPTS; attempt++) {
    try {
      await appendEvent(callRunId, kind, detail, deps);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < EVENT_APPEND_ATTEMPTS) await sleep(EVENT_APPEND_WAIT_MS);
    }
  }
  throw lastError;
}

/** One attempt. A validation failure never reaches here, because the checks
 * above run once and cannot be repaired by a retry.
 */
async function appendEvent(
  callRunId: string,
  kind: CallEventKind,
  detail: CallEventDetail,
  deps: EventDeps,
): Promise<void> {
  const response = await deps.fetch(
    `${apiBase(deps.apiUrl)}/rest/v1/call_events`,
    {
      method: "POST",
      headers: eventHeaders(deps.serviceRoleKey),
      body: JSON.stringify({ call_run_id: callRunId, kind, detail }),
    },
  );
  if (!response.ok) throw new Error("call event insert failed");
}

const testFn =
  (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void })
    .test;

if (typeof testFn === "function") {
  testFn(
    "records an append-only timeline row with durable detail",
    async () => {
      let request: Request | undefined;
      await recordCallEvent(
        "run-1",
        "dispatched",
        { calle_call_id: "call_123", state: "awaiting_result" },
        {
          apiUrl: "https://orma-api.nryn.dev",
          serviceRoleKey: "service-key",
          fetch: async (input, init) => {
            request = new Request(input, init);
            return new Response(null, { status: 201 });
          },
        },
      );
      if (!request || request.method !== "POST") {
        throw new Error("timeline must append with POST");
      }
      if (!request.url.endsWith("/rest/v1/call_events")) {
        throw new Error("timeline must write call_events");
      }
      const row = await request.json() as {
        call_run_id: string;
        kind: string;
        detail: CallEventDetail;
      };
      if (row.call_run_id !== "run-1" || row.kind !== "dispatched") {
        throw new Error("timeline row lost its transition");
      }
      if (row.detail.calle_call_id !== "call_123") {
        throw new Error("timeline row lost its durable detail");
      }
    },
  );

  testFn(
    "rejects an unknown transition before it reaches the database",
    async () => {
      let called = false;
      try {
        await recordCallEvent(
          "run-1",
          "logged" as CallEventKind,
          {},
          {
            apiUrl: "https://orma-api.nryn.dev",
            serviceRoleKey: "service-key",
            fetch: async () => {
              called = true;
              return new Response(null, { status: 201 });
            },
          },
        );
        throw new Error("unknown transition was accepted");
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "unsupported call event kind: logged"
        ) {
          throw error;
        }
      }
      if (called) throw new Error("unknown transition reached the database");
    },
  );

  testFn(
    "rejects an opaque terminal failure before it reaches the database",
    async () => {
      let called = false;
      try {
        await recordCallEvent(
          "run-1",
          "finalised",
          { state: "failed" },
          {
            apiUrl: "https://orma-api.nryn.dev",
            serviceRoleKey: "service-key",
            fetch: async () => {
              called = true;
              return new Response(null, { status: 201 });
            },
          },
        );
        throw new Error("opaque terminal failure was accepted");
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "failed finalised call event requires a failure reason"
        ) {
          throw error;
        }
      }
      if (called) throw new Error("opaque terminal failure reached the database");
    },
  );

  testFn(
    "rejects a materialised event that names no slot or instant",
    async () => {
      const deps = {
        apiUrl: "https://orma-api.nryn.dev",
        serviceRoleKey: "service-key",
        fetch: async () => {
          throw new Error("an unreadable materialised row reached the database");
        },
      };
      try {
        await recordCallEvent("run-1", "materialised", { slot_id: "slot-1" }, deps);
        throw new Error("a materialised row without an instant was accepted");
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "materialised call event requires the scheduled instant"
        ) {
          throw error;
        }
      }
      try {
        await recordCallEvent(
          "run-1",
          "materialised",
          { scheduled_for: "2026-09-14T02:30:00.000Z" },
          deps,
        );
        throw new Error("a materialised row without a slot was accepted");
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "materialised call event requires a slot id"
        ) {
          throw error;
        }
      }
    },
  );

  testFn(
    "retries one lost append and lands the row",
    async () => {
      const bodies: string[] = [];
      await recordCallEvent(
        "run-1",
        "claimed",
        { state: "claimed" },
        {
          apiUrl: "https://orma-api.nryn.dev",
          serviceRoleKey: "service-key",
          fetch: async (_input, init) => {
            bodies.push(String(init?.body));
            return new Response(null, { status: bodies.length === 1 ? 500 : 201 });
          },
        },
        async () => {},
      );
      if (bodies.length !== 2) {
        throw new Error(`a transient failure must be retried once, saw ${bodies.length} attempt(s)`);
      }
      if (bodies[1] !== bodies[0]) throw new Error("the retry posted a different row");
    },
  );

  testFn(
    "throws once the append attempts are spent",
    async () => {
      let attempts = 0;
      try {
        await recordCallEvent(
          "run-1",
          "claimed",
          { state: "claimed" },
          {
            apiUrl: "https://orma-api.nryn.dev",
            serviceRoleKey: "service-key",
            fetch: async () => {
              attempts += 1;
              return new Response(null, { status: 500 });
            },
          },
          async () => {},
        );
        throw new Error("a spent append budget was reported as a write");
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "call event insert failed") throw error;
      }
      if (attempts !== EVENT_APPEND_ATTEMPTS) {
        throw new Error(`a lost append made ${attempts} attempt(s)`);
      }
    },
  );
}
