import { describe, expect, it, beforeEach } from "vitest";

import { resetCallEventStore, recordCallEvent, callEventSchema } from "../server/calle/call-events";
import { resetClock, setClock, nowIso, isoFromMs } from "../server/calle/clock";
import { validateCalleConfig } from "../server/calle/config-validator";
import {
  createCorrelationBundle,
  getCorrelationBundle,
  resetCorrelationStore,
} from "../server/calle/correlation";
import { mapErrorToUserMessage } from "../server/calle/error-taxonomy";
import { normalizeCallStatus, phoneStatusToWorkflowCompat } from "../server/calle/status-normalize";
import { loadV5FeatureFlags } from "../server/calle/v5-flags";
import { createCalleService } from "../server/calle/service";

describe("CALL-E V5 feature flags", () => {
  it("defaults to safe demo developer mode", () => {
    const flags = loadV5FeatureFlags({
      calleEnabled: true,
      aiEnabled: true,
      calleDemoMode: true,
      calleLiveCalls: false,
      calleKillSwitch: false,
      calleApiKey: "",
      calleReplayEnabled: true,
      calleAdvancedReview: true,
    } as never);
    expect(flags.safeDefault).toBe(true);
    expect(flags.simulatorMode).toBe(true);
    expect(flags.liveCalling).toBe(false);
  });
});

describe("CALL-E V5 config validation", () => {
  it("flags demo/live conflict without exposing secrets", () => {
    const result = validateCalleConfig({
      calleEnabled: true,
      aiEnabled: true,
      calleDemoMode: true,
      calleLiveCalls: true,
      calleKillSwitch: false,
      calleApiKey: "",
    } as never);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "demo_live_conflict")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("CALL-E V5 call events", () => {
  beforeEach(() => resetCallEventStore());

  it("validates persisted event schema", () => {
    const event = recordCallEvent({
      eventId: "evt_test_001",
      eventType: "intent_created",
      correlationId: "corr_test_001234567890",
      workflowId: "wf_test",
      at: new Date().toISOString(),
      actor: "chw",
      summary: "Synthetic demo intent",
    });
    expect(callEventSchema.safeParse(event).success).toBe(true);
  });
});

describe("CALL-E V5 correlation IDs", () => {
  beforeEach(() => resetCorrelationStore());

  it("links workflow to correlation bundle", () => {
    const bundle = createCorrelationBundle({ chwTaskId: "task-1", workflowId: "wf-1" });
    expect(getCorrelationBundle("wf-1")?.correlationId).toBe(bundle.correlationId);
    expect(bundle.conversationSessionId).toMatch(/^sess_/);
  });
});

describe("CALL-E V5 clock", () => {
  it("supports deterministic time in tests", () => {
    setClock(() => 1_700_000_000_000);
    expect(nowIso()).toBe(isoFromMs(1_700_000_000_000));
    resetClock();
  });
});

describe("CALL-E V5 status normalization", () => {
  it("maps workflow status to command bucket", () => {
    expect(normalizeCallStatus("prepared").commandBucket).toBe("pending");
    expect(normalizeCallStatus("dry_run_completed").commandBucket).toBe("completed");
    expect(phoneStatusToWorkflowCompat("queued")).toBe("prepared");
  });
});

describe("CALL-E V5 error taxonomy", () => {
  it("maps codes to user-facing messages", () => {
    expect(mapErrorToUserMessage("missing_consent").category).toBe("policy");
  });
});

describe("CALL-E V5 release report", () => {
  it("exposes hackathon release metadata", () => {
    const service = createCalleService();
    const report = service.getReleaseReport();
    expect(report.heroDemoBeneficiary).toBe("demo-ben-001");
    expect(report.testCommands.length).toBeGreaterThan(0);
  });
});
