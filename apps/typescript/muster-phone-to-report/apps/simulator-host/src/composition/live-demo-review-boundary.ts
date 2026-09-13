import {
  createLiveDemoReviewCleanupOwner,
  type LiveDemoReviewCleanupOwnerInput,
  type LiveDemoReviewCleanupResult,
  type LiveDemoReviewCleanupTrigger,
} from "../live-runs/live-demo-review-session.js";

export const LIVE_DEMO_REVIEW_ROUTE_TABLE = Object.freeze([
  Object.freeze({
    kind: "operation" as const,
    method: "GET" as const,
    route: "GET /api/v1/live-simulator/operations/{operationId}" as const,
  }),
  Object.freeze({
    kind: "cleanup" as const,
    method: "DELETE" as const,
    route: "DELETE /api/v1/live-demo-review/sessions/{sessionId}" as const,
  }),
] as const);

export type LiveDemoReviewRoute = (typeof LIVE_DEMO_REVIEW_ROUTE_TABLE)[number]["route"];
export type LiveDemoReviewMethod = "GET" | "DELETE" | "OPTIONS" | "OTHER";
export type LiveDemoReviewRequestClassification =
  | Readonly<{ outcome: "not_found"; method: LiveDemoReviewMethod }>
  | Readonly<{
      outcome: "operation" | "cleanup" | "options" | "method_not_allowed";
      method: LiveDemoReviewMethod;
      route: LiveDemoReviewRoute;
    }>;

function normalizeMethod(method: string | undefined): LiveDemoReviewMethod {
  return method === "GET" || method === "DELETE" || method === "OPTIONS" ? method : "OTHER";
}

export function classifyLiveDemoReviewRequest(
  input: Readonly<{
    method: string | undefined;
    path: string;
    exactOperationPath: string;
    exactCleanupPath: string;
  }>,
): LiveDemoReviewRequestClassification {
  const method = normalizeMethod(input.method);
  const operation = LIVE_DEMO_REVIEW_ROUTE_TABLE[0];
  const cleanup = LIVE_DEMO_REVIEW_ROUTE_TABLE[1];
  const selected =
    input.path === input.exactOperationPath
      ? operation
      : input.path === input.exactCleanupPath
        ? cleanup
        : undefined;
  if (selected === undefined) return Object.freeze({ outcome: "not_found", method });
  if (method === "OPTIONS") {
    return Object.freeze({ outcome: "options", method, route: selected.route });
  }
  if (method !== selected.method) {
    return Object.freeze({ outcome: "method_not_allowed", method, route: selected.route });
  }
  return Object.freeze({ outcome: selected.kind, method, route: selected.route });
}

export interface LiveDemoReviewProtectedCleanupBinding {
  readonly cleanup: (trigger: LiveDemoReviewCleanupTrigger) => Promise<LiveDemoReviewCleanupResult>;
  readonly establishDatabaseLease: () => void;
}

export function createLiveDemoReviewProtectedCleanupBinding(
  input: Readonly<{
    cleanupOwner: LiveDemoReviewCleanupOwnerInput;
    readReviewCleanupState: () => Promise<
      "ready" | "cleanup_pending" | "cleanup_blocked" | "deleted" | null | undefined
    >;
    transitionReviewCleanup: (
      from: "ready" | "cleanup_pending" | "cleanup_blocked",
      to: "cleanup_pending" | "cleanup_blocked",
    ) => Promise<Readonly<{ outcome: string }>>;
  }>,
): LiveDemoReviewProtectedCleanupBinding {
  const cleanupOwner = createLiveDemoReviewCleanupOwner(input.cleanupOwner);
  let databaseLeaseEstablished = false;
  const establishDatabaseLease = (): void => {
    databaseLeaseEstablished = true;
  };
  const cleanup = async (
    trigger: LiveDemoReviewCleanupTrigger,
  ): Promise<LiveDemoReviewCleanupResult> => {
    if (databaseLeaseEstablished) {
      const from = await input.readReviewCleanupState();
      if (from === "ready" || from === "cleanup_blocked") {
        const transition = await input.transitionReviewCleanup(from, "cleanup_pending");
        if (transition.outcome !== "advanced" && transition.outcome !== "replayed") {
          return Object.freeze({
            outcome: "blocked" as const,
            message: "Cleanup requires attention" as const,
            recoveryIdentity: input.cleanupOwner.session,
          });
        }
      }
    }
    const result = await cleanupOwner.cleanup(trigger);
    if (result.outcome === "blocked" && databaseLeaseEstablished) {
      try {
        await input.transitionReviewCleanup("cleanup_pending", "cleanup_blocked");
      } catch {
        // The cleanup-owner checkpoint and returned recovery identity remain authoritative.
      }
    }
    return result;
  };
  return Object.freeze({ cleanup, establishDatabaseLease });
}
