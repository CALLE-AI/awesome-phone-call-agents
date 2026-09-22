import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalleService } from "../../server/calle/api-service";
import { CalleError, CalleNetworkError } from "../../server/calle/errors";
import { withHttpMethodRetry } from "../../server/calle/http-retry-policy";
import { resetIdempotencyStore } from "../../server/calle/idempotency";
import { hardenedCalleRouter } from "../../server/calle/router-hardened";
import { CalleManualReviewError } from "../../server/calle/uncertain-state";
import { publicError, redactObject } from "../../server/calle/utilities";

function manualCreateError() {
  return new CalleManualReviewError({
    state: "unknown",
    manualReviewRequired: true,
    operation: "create",
    callId: null,
    idempotencyKeyFingerprint: "not-a-secret",
    reason: "transport_failure_after_submission",
    providerStatus: null,
    retryAttempted: false,
    remediation: "manual_review_before_retry",
  });
}

function listen(app: express.Express) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No listener address");
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

describe("CALL-E retry, idempotency, and privacy boundaries", () => {
  beforeEach(() => resetIdempotencyStore());
  afterEach(() => vi.restoreAllMocks());

  it("performs exactly one POST attempt while allowing bounded GET retries", async () => {
    const post = vi.fn(async () => { throw new CalleNetworkError(); });
    await expect(withHttpMethodRetry(post, {
      method: "POST", retries: 10, baseDelayMs: 0, sleep: async () => undefined,
    })).rejects.toBeInstanceOf(CalleNetworkError);
    expect(post).toHaveBeenCalledTimes(1);

    const get = vi.fn(async () => { throw new CalleNetworkError(); });
    await expect(withHttpMethodRetry(get, {
      method: "GET", retries: 2, baseDelayMs: 0, sleep: async () => undefined,
    })).rejects.toBeInstanceOf(CalleNetworkError);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("locks an ambiguous idempotency key and never invokes a second create", async () => {
    const gateway = {
      createCall: vi.fn(async () => { throw manualCreateError(); }),
      getCall: vi.fn(),
      listEvents: vi.fn(),
    };
    const service = new CalleService(gateway);
    const input = {
      task: "Call +14165551234 about a routine check-in",
      recipients: [{ phones: ["+14165551234"], region: "CA" }],
      idempotencyKey: "ambiguity-lock-123456",
    };

    await expect(service.createCall(input)).rejects.toMatchObject({ code: "CALLE_MANUAL_REVIEW", status: 409 });
    await expect(service.createCall(input)).rejects.toMatchObject({ code: "CALLE_MANUAL_REVIEW", status: 409 });
    expect(gateway.createCall).toHaveBeenCalledTimes(1);
  });

  it("redacts public copies without changing private task, recipient, transcript, or credentials", () => {
    const privateInput = {
      task: "Call +14165551234 and explain the next visit.",
      recipients: [{ phones: ["+14165551234"] }],
      transcript: "Caller confirmed +14165551234.",
      evidence: ["Spoke with +14165551234"],
      error: { message: "Bearer super-secret-token; recipient +14165551234 unavailable" },
      authorization: "Bearer super-secret-token",
    };
    const snapshot = JSON.stringify(privateInput);
    const output = redactObject(privateInput);
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain("14165551234");
    expect(serialized).not.toContain("super-secret-token");
    expect(JSON.stringify(privateInput)).toBe(snapshot);
    expect(output).not.toBe(privateInput);
  });

  it("redacts manual-review error details before public serialization", () => {
    const error = new CalleError("provider could not dial +14165551234", {
      code: "CALLE_MANUAL_REVIEW",
      status: 409,
      details: {
        task: "Call +14165551234",
        recipients: ["+14165551234"],
        authorization: "Bearer super-secret-token",
      },
    });
    const response = publicError(error);
    expect(JSON.stringify(response)).not.toContain("14165551234");
    expect(JSON.stringify(response)).not.toContain("super-secret-token");
  });

  it("masks phone-bearing direct gateway responses at the router boundary", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/calle", hardenedCalleRouter);
    const { url, close } = await listen(app);
    try {
      const response = await fetch(`${url}/api/calle/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "Call +14165551234 for an authorized mock check-in",
          recipients: [{ phones: ["+14165551234"], region: "CA" }],
          idempotencyKey: "router-privacy-123456",
        }),
      });
      expect(response.status).toBe(201);
      const body = await response.text();
      expect(body).not.toContain("14165551234");
      expect(body).toContain("call_mock_");
    } finally {
      await close();
    }
  });
});
