import { describe, expect, it } from "vitest";

import { CallQueue } from "../lib/calle-v4/queue";
import {
  CalleAuthError,
  CalleNetworkError,
  CalleRateLimitError,
  CalleRemoteError,
  CalleTimeoutError,
  CalleValidationError,
  toCallFailureCode,
} from "../server/calle/errors";
import { mapErrorToUserMessage } from "../server/calle/error-taxonomy";
import { createFailoverCalleAdapter } from "../server/calle/provider-failover";
import type { CalleAdapter, PlaceCallCommand } from "../server/calle/adapter";
import { MobileCalleClient } from "../shared/calleClient";
import {
  describeNetworkError,
  errorMessageFromBody,
  isE164Phone,
  isTransientPollFailure,
  nextPollFailureState,
  parseJsonText,
} from "../shared/http-json";

const command: PlaceCallCommand = {
  workflowId: "wf_cancel",
  idempotencyKey: "idem-cancel",
  recipientE164: "+15555550123",
  recipientRegion: "US",
  purpose: "follow_up_after_check_in",
  callLanguage: "en",
  dryRun: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CALL-E error mapping", () => {
  it("maps timeout, auth, rate limit, and validation onto workflow codes", () => {
    expect(toCallFailureCode(new CalleTimeoutError())).toBe("timeout");
    expect(toCallFailureCode(new CalleAuthError())).toBe("provider_unavailable");
    expect(toCallFailureCode(new CalleRateLimitError())).toBe("provider_unavailable");
    expect(toCallFailureCode(new CalleValidationError("bad"))).toBe("result_invalid");
    expect(toCallFailureCode(new CalleRemoteError("oops", 502))).toBe("provider_unavailable");
    expect(toCallFailureCode(new CalleRemoteError("oops", 400))).toBe("call_failed");
    expect(toCallFailureCode(new CalleNetworkError(new TypeError("Failed to fetch")))).toBe("provider_unavailable");
    expect(toCallFailureCode(new Error("fetch failed: ECONNREFUSED"))).toBe("provider_unavailable");
    expect(toCallFailureCode(new Error("aborted by timeout"))).toBe("timeout");
  });

  it("exposes user-facing copy for timeout and invalid recipient", () => {
    expect(mapErrorToUserMessage("timeout").userMessage).toContain("timed out");
    expect(mapErrorToUserMessage("invalid_recipient").userMessage).toContain("international");
    expect(mapErrorToUserMessage("CALLE_RATE_LIMIT").userMessage).toContain("busy");
    expect(mapErrorToUserMessage("CALLE_NETWORK").userMessage).toContain("connection");
  });
});

describe("HTTP JSON helpers", () => {
  it("rejects empty and invalid JSON", () => {
    expect(() => parseJsonText("", "Fetch failed")).toThrow(/empty response/);
    expect(() => parseJsonText("<html>", "Fetch failed")).toThrow(/invalid JSON/);
    expect(parseJsonText('{"ok":true}', "Fetch failed")).toEqual({ ok: true });
  });

  it("reads provider error bodies without crashing on HTML", () => {
    expect(errorMessageFromBody('{"error":"missing consent"}', 400, "Create failed")).toBe("missing consent");
    expect(errorMessageFromBody("<html>nope</html>", 502, "Create failed")).toBe("<html>nope</html>");
    expect(errorMessageFromBody("", 503, "Create failed")).toBe("Create failed (503)");
  });

  it("classifies network errors and poll retry budget", () => {
    expect(describeNetworkError(new TypeError("Failed to fetch"), "x")).toContain("Network error");
    expect(isTransientPollFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientPollFailure(new Error("bad request"))).toBe(false);
    expect(nextPollFailureState(0, new TypeError("Failed to fetch"))).toEqual({
      consecutiveFailures: 1,
      fatal: false,
    });
    expect(nextPollFailureState(2, new TypeError("Failed to fetch")).fatal).toBe(true);
    expect(nextPollFailureState(0, new Error("unauthorized")).fatal).toBe(true);
  });

  it("validates E.164 phones", () => {
    expect(isE164Phone("+15551234567")).toBe(true);
    expect(isE164Phone("5551234567")).toBe(false);
    expect(isE164Phone("+")).toBe(false);
  });
});

describe("mobile CALL-E clients", () => {
  it("surfaces JSON error bodies", async () => {
    const client = new MobileCalleClient("http://calle.test", async () =>
      jsonResponse({ ok: false, error: "missing consent" }, 400),
    );
    await expect(client.getCall("call_1")).rejects.toThrow("missing consent");
  });

  it("does not treat HTML error pages as JSON", async () => {
    const client = new MobileCalleClient("http://calle.test", async () =>
      new Response("<html>down</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    await expect(client.getCall("call_1")).rejects.toThrow(/invalid JSON/);
  });

  it("rejects empty ids before fetching", () => {
    const client = new MobileCalleClient("http://calle.test", async () => {
      throw new Error("should not fetch");
    });
    expect(() => client.getCall("  ")).toThrow(/call id is required/);
  });

  it("turns fetch failures into a network message", async () => {
    const client = new MobileCalleClient("http://calle.test", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(client.getCall("call_1")).rejects.toThrow(/Network error/);
  });

  it("rejects non-E.164 recipients before create", () => {
    const client = new MobileCalleClient("http://calle.test", async () => {
      throw new Error("should not fetch");
    });
    expect(() =>
      client.createCall({
        task: "Confirm availability",
        recipients: [{ phone: "5551234" }],
        idempotencyKey: "k1",
      }),
    ).toThrow(/E\.164/);
  });
});

describe("offline queue persist failures", () => {
  it("keeps queued items in memory when persist write fails", async () => {
    const queue = new CallQueue({
      read: async () => {
        throw new Error("disk");
      },
      write: async () => {
        throw new Error("disk");
      },
    });
    await queue.hydrate();
    queue.enqueue({
      localId: "1",
      task: "Confirm availability",
      phones: ["+15555550123"],
      clientRequestId: "q1",
      createdAt: Date.now(),
    });
    expect(queue.size()).toBe(1);
  });
});

describe("failover cancel", () => {
  it("returns provider_unavailable instead of throwing when cancel fails", async () => {
    const throwing: CalleAdapter = {
      async placeFollowUpCall(cmd) {
        return {
          providerCallId: `run_${cmd.workflowId}`,
          status: "in_progress",
          structuredResult: null,
          failureCode: null,
        };
      },
      async getStatus() {
        return {
          providerCallId: "run_x",
          status: "in_progress",
          structuredResult: null,
          failureCode: null,
        };
      },
      async cancel() {
        throw new Error("cancel transport down");
      },
    };
    const adapter = createFailoverCalleAdapter({
      providers: [{ id: "call-e", adapter: throwing }],
    });
    const placed = await adapter.placeFollowUpCall(command);
    const cancelled = await adapter.cancel(placed.providerCallId);
    expect(cancelled.status).toBe("failed");
    expect(cancelled.failureCode).toBe("provider_unavailable");
  });
});
