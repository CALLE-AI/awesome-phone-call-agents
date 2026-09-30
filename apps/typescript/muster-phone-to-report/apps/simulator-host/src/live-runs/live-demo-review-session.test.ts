import { describe, expect, it } from "vitest";

import {
  LIVE_DEMO_REVIEW_LIFECYCLE_STATES,
  LIVE_DEMO_REVIEW_TTL_MS,
  establishLiveDemoReviewLease,
  isExactLiveDemoViewerReadiness,
  isLiveDemoReviewExpired,
  restoreLiveDemoReviewLease,
} from "./live-demo-review-session.js";

const identity = Object.freeze({
  operationId: "operation-recording-safe-review",
  scenarioId: "synthetic-normal",
  scenarioRevision: 2,
});

describe("recording-safe live demo review session contract", () => {
  it("defines the approved monotonic review lifecycle", () => {
    expect(LIVE_DEMO_REVIEW_LIFECYCLE_STATES).toEqual([
      "prepared",
      "viewer_attached",
      "dispatch_reserved",
      "call_terminal",
      "external_cleanup_pending",
      "external_cleanup_complete",
      "review_ready",
      "review_cleanup_pending",
      "review_deleted",
      "review_cleanup_blocked",
    ]);
  });

  it("accepts readiness only from a successful server-observed GET of the exact projection", () => {
    expect(
      isExactLiveDemoViewerReadiness(identity, {
        source: "server_http_runtime",
        method: "GET",
        route: "/api/v1/live-simulator/operations/operation-recording-safe-review",
        statusCode: 200,
        projectionIdentity: identity,
      }),
    ).toBe(true);
  });

  it.each([
    ["browser-local acknowledgment", { source: "browser_local" }],
    ["POST acknowledgment", { method: "POST" }],
    ["query-only acknowledgment", { route: "/simulator.html?ready=true" }],
    ["unsuccessful GET", { statusCode: 404 }],
    [
      "wrong operation",
      { projectionIdentity: { ...identity, operationId: "operation-different" } },
    ],
    ["wrong scenario", { projectionIdentity: { ...identity, scenarioId: "synthetic-other" } }],
    ["wrong revision", { projectionIdentity: { ...identity, scenarioRevision: 3 } }],
  ])("rejects %s as viewer readiness", (_label, mutation) => {
    const observation = {
      source: "server_http_runtime",
      method: "GET",
      route: "/api/v1/live-simulator/operations/operation-recording-safe-review",
      statusCode: 200,
      projectionIdentity: identity,
      ...mutation,
    };
    expect(isExactLiveDemoViewerReadiness(identity, observation)).toBe(false);
  });

  it("persists one immutable 30-minute review deadline", () => {
    const lease = establishLiveDemoReviewLease({
      identity,
      reviewReadyAt: "2026-08-31T20:00:00.000Z",
    });

    expect(LIVE_DEMO_REVIEW_TTL_MS).toBe(30 * 60 * 1_000);
    expect(lease).toEqual({
      identity,
      reviewReadyAt: "2026-08-31T20:00:00.000Z",
      reviewExpiresAt: "2026-08-31T20:30:00.000Z",
    });
    expect(Object.isFrozen(lease)).toBe(true);
    expect(Object.isFrozen(lease.identity)).toBe(true);
  });

  it("rejects persisted expiry drift instead of extending a review lease", () => {
    expect(() =>
      restoreLiveDemoReviewLease({
        identity,
        reviewReadyAt: "2026-08-31T20:00:00.000Z",
        reviewExpiresAt: "2026-08-31T20:31:00.000Z",
      }),
    ).toThrow("Live demo review expiry is invalid");
  });

  it("expires immediately at the fixed deadline without wall-clock waiting", () => {
    const lease = establishLiveDemoReviewLease({
      identity,
      reviewReadyAt: "2026-08-31T20:00:00.000Z",
    });

    expect(isLiveDemoReviewExpired(lease, new Date("2026-08-31T20:29:59.999Z"))).toBe(false);
    expect(isLiveDemoReviewExpired(lease, new Date("2026-08-31T20:30:00.000Z"))).toBe(true);
    expect(isLiveDemoReviewExpired(lease, new Date("2026-08-31T20:30:00.001Z"))).toBe(true);
  });
});
