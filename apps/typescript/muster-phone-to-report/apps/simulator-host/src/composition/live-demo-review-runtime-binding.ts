import type { LiveDemoReviewIdentity } from "../live-runs/live-demo-review-session.js";
import type { LiveDemoReviewProtectedCleanupBinding } from "./live-demo-review-boundary.js";
import {
  startLiveDemoReviewRuntime,
  type LiveDemoReviewProjection,
  type LiveDemoReviewRuntime,
} from "./start-live-demo-review-runtime.js";

type ReviewRuntimeInput = Parameters<typeof startLiveDemoReviewRuntime>[0];

export interface LiveDemoReviewRuntimeBindingInput {
  readonly host: ReviewRuntimeInput["host"];
  readonly port: ReviewRuntimeInput["port"];
  readonly allowedBrowserOrigin: ReviewRuntimeInput["allowedBrowserOrigin"];
  readonly sessionId: ReviewRuntimeInput["sessionId"];
  readonly lease: ReviewRuntimeInput["lease"];
  readonly identity: LiveDemoReviewIdentity;
  readonly now: ReviewRuntimeInput["now"];
  readonly readRetainedProjection: () =>
    LiveDemoReviewProjection | undefined | Promise<LiveDemoReviewProjection | undefined>;
  readonly protectedCleanup: Pick<LiveDemoReviewProtectedCleanupBinding, "cleanup">;
  readonly revokeProjection: NonNullable<ReviewRuntimeInput["revokeProjection"]>;
  readonly closeObservability: NonNullable<ReviewRuntimeInput["closeObservability"]>;
  readonly runCleanupSpan: NonNullable<ReviewRuntimeInput["runCleanupSpan"]>;
  readonly establishTraceContext: NonNullable<ReviewRuntimeInput["establishTraceContext"]>;
  readonly runRequestSpan: NonNullable<ReviewRuntimeInput["runRequestSpan"]>;
  readonly recordHttpRequest: NonNullable<ReviewRuntimeInput["recordHttpRequest"]>;
}

export async function startBoundLiveDemoReviewRuntime(
  input: LiveDemoReviewRuntimeBindingInput,
): Promise<LiveDemoReviewRuntime> {
  return await startLiveDemoReviewRuntime({
    host: input.host,
    port: input.port,
    allowedBrowserOrigin: input.allowedBrowserOrigin,
    sessionId: input.sessionId,
    lease: input.lease,
    now: input.now,
    readExactProjection: async (identity) => {
      if (
        identity.operationId !== input.identity.operationId ||
        identity.scenarioId !== input.identity.scenarioId ||
        identity.scenarioRevision !== input.identity.scenarioRevision
      ) {
        return undefined;
      }
      return await input.readRetainedProjection();
    },
    cleanup: input.protectedCleanup.cleanup,
    revokeProjection: input.revokeProjection,
    closeObservability: input.closeObservability,
    runCleanupSpan: input.runCleanupSpan,
    establishTraceContext: input.establishTraceContext,
    runRequestSpan: input.runRequestSpan,
    recordHttpRequest: input.recordHttpRequest,
  });
}
